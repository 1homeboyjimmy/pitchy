from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_async_current_user
from db_async import get_async_db
from models import ChatMessage, ChatSession, ResearchClaim, ResearchJob, User
from plan_limits import get_limits_for
from research_service import run_research_job
from subscription_service import consume_quota, get_subscription, is_active

router = APIRouter(prefix="/api/research", tags=["research"])


class ResearchCreate(BaseModel):
    session_id: int
    query: str = Field(..., min_length=3, max_length=12000)
    client_id: str | None = None
    assistant_client_id: str | None = None


def serialize(job: ResearchJob, include_claims: list[ResearchClaim] | None = None) -> dict:
    data = {"id":job.id,"session_id":job.session_id,"query":job.query,"status":job.status,"phase":job.phase,"progress":job.progress,"blueprint":job.blueprint,"report":job.report,"sources":job.sources or [],"events":job.events or [],"error":job.error,"created_at":job.created_at,"started_at":job.started_at,"completed_at":job.completed_at}
    if include_claims is not None:
        data["claims"]=[{"id":c.id,"claim":c.claim,"value_text":c.value_text,"unit":c.unit,"period":c.period,"geography":c.geography,"status":c.status,"confidence":float(c.confidence or 0),"is_estimate":c.is_estimate} for c in include_claims]
    return data


@router.post("")
async def create_research(payload: ResearchCreate, user: User = Depends(get_async_current_user), db: AsyncSession = Depends(get_async_db)):
    limits = get_limits_for(user.subscription_tier, user.subscription_expires_at)
    session = (await db.execute(select(ChatSession).where(
        ChatSession.id == payload.session_id, ChatSession.user_id == user.id
    ))).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    active = (await db.execute(select(ResearchJob).where(
        ResearchJob.user_id == user.id,
        ResearchJob.status.in_(["queued", "running", "cancelling"]),
    ))).scalars().first()
    if active:
        raise HTTPException(status_code=409, detail="Дождитесь завершения текущего исследования.")

    custom_subscription = await get_subscription(db, user.id)
    if not user.is_admin and custom_subscription is not None:
        if not is_active(custom_subscription):
            raise HTTPException(status_code=402, detail="Подписка не активна или срок действия закончился.")
        await consume_quota(
            db, user, "messages",
            idempotency_key=f"research:{user.id}:{payload.assistant_client_id or payload.client_id or payload.query[:80]}",
            reference_type="research",
        )
    elif not user.is_admin and not limits.can_use_research:
        raise HTTPException(status_code=403, detail="Полное исследование доступно на тарифах Starter и Pro.")
    user_message=ChatMessage(session_id=session.id,role="user",content=payload.query,client_id=payload.client_id)
    db.add(user_message)
    job=ResearchJob(user_id=user.id,session_id=session.id,query=payload.query,status="queued",phase="planning",progress=0,events=[])
    db.add(job); await db.flush()
    assistant=ChatMessage(session_id=session.id,role="assistant",content="",thoughts="› Исследование поставлено в очередь",client_id=payload.assistant_client_id,research_job_id=job.id)
    db.add(assistant); await db.commit(); await db.refresh(job)
    asyncio.create_task(run_research_job(job.id))
    return serialize(job)


@router.get("/{job_id}")
async def get_research(job_id:int,user:User=Depends(get_async_current_user),db:AsyncSession=Depends(get_async_db)):
    job=(await db.execute(select(ResearchJob).where(ResearchJob.id==job_id,ResearchJob.user_id==user.id))).scalar_one_or_none()
    if not job: raise HTTPException(status_code=404,detail="Research not found")
    claims=(await db.execute(select(ResearchClaim).where(ResearchClaim.job_id==job.id))).scalars().all() if job.status=="completed" else None
    return serialize(job,claims)


@router.get("/session/{session_id}/active")
async def get_active_research(session_id:int,user:User=Depends(get_async_current_user),db:AsyncSession=Depends(get_async_db)):
    job=(await db.execute(select(ResearchJob).where(ResearchJob.session_id==session_id,ResearchJob.user_id==user.id).order_by(ResearchJob.created_at.desc()))).scalars().first()
    return serialize(job) if job else None


@router.post("/{job_id}/cancel")
async def cancel_research(job_id:int,user:User=Depends(get_async_current_user),db:AsyncSession=Depends(get_async_db)):
    job=(await db.execute(select(ResearchJob).where(ResearchJob.id==job_id,ResearchJob.user_id==user.id))).scalar_one_or_none()
    if not job: raise HTTPException(status_code=404,detail="Research not found")
    if job.status in ("completed","failed","cancelled"): return serialize(job)
    job.cancel_requested=True; job.status="cancelling"; job.updated_at=datetime.utcnow(); await db.commit(); await db.refresh(job)
    return serialize(job)
