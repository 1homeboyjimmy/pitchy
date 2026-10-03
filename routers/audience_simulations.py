from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from audience_simulation_service import PERSONA_MODEL, SEARCH_MODEL, generate_json, search_evidence
from auth import get_async_current_user, require_async_admin
from db_async import AsyncSessionLocal, get_async_db
from models import (
    AudienceSimulationAccessToken,
    AudienceSimulationCampaign,
    AudienceSimulationParticipant,
    AudienceSimulationRun,
    AdminAuditLog,
    User,
    CustomSubscription,
)
from subscription_service import BASE_CONFIG, empty_usage, get_subscription

router = APIRouter(prefix="/api/audience-simulations", tags=["audience-simulations"])
_interview_limit = asyncio.Semaphore(10)
logger = logging.getLogger("app.audience_simulation")


class CampaignCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    code: str = Field(min_length=16, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    settings: dict = Field(default_factory=dict)


class CampaignSettingsUpdate(BaseModel):
    settings: dict


class RunCreate(BaseModel):
    idea: str = Field(min_length=20, max_length=6000)
    audience: str | None = Field(default=None, max_length=1200)
    price: str | None = Field(default=None, max_length=300)


class SelectionUpdate(BaseModel):
    selection_version: int = Field(ge=1)
    size: int = Field(ge=5, le=30)
    include_groups: list[str] = Field(default_factory=list, max_length=12)
    constraints: str | None = Field(default=None, max_length=1200)


class ClaimAccept(BaseModel):
    consent: bool
    consent_version: str = Field(min_length=1, max_length=40)


def _token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _validate_campaign_settings(settings: dict) -> None:
    minimum = settings.get("min_valid_responses", 8)
    if isinstance(minimum, bool) or not isinstance(minimum, int) or not 5 <= minimum <= 12:
        raise HTTPException(status_code=422, detail="Минимум ответов должен быть от 5 до 12")
    if settings.get("competition_enabled"):
        formula = settings.get("score_formula") or {}
        if formula.get("weights") != {"problem_relevance": 40, "interest": 35, "willingness_to_try": 25}:
            raise HTTPException(status_code=422, detail="Укажите формулу конкурса 40/35/25")
        if not formula.get("version"):
            raise HTTPException(status_code=422, detail="Для формулы нужна версия")


def _event(run: AudienceSimulationRun, kind: str, payload: dict | None = None) -> None:
    events = list(run.events or [])
    events.append({
        "event_id": secrets.token_hex(8),
        "sequence": len(events) + 1,
        "type": kind,
        "occurred_at": datetime.utcnow().isoformat() + "Z",
        "payload": payload or {},
    })
    run.events = events


async def _get_campaign(db: AsyncSession, code: str, *, active: bool = True) -> AudienceSimulationCampaign:
    campaign = (await db.execute(select(AudienceSimulationCampaign).where(
        AudienceSimulationCampaign.code == code,
    ))).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    now = datetime.utcnow()
    starts_at = campaign.starts_at
    ends_at = campaign.ends_at
    if starts_at and starts_at.tzinfo:
        starts_at = starts_at.astimezone(timezone.utc).replace(tzinfo=None)
    if ends_at and ends_at.tzinfo:
        ends_at = ends_at.astimezone(timezone.utc).replace(tzinfo=None)
    if active and (
        campaign.status != "active"
        or (starts_at and starts_at > now)
        or (ends_at and ends_at <= now)
    ):
        raise HTTPException(status_code=403, detail="Кампания сейчас недоступна")
    return campaign


async def _get_run(
    db: AsyncSession,
    run_id: int,
    access_token: str | None,
) -> AudienceSimulationRun:
    run = await db.get(AudienceSimulationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Запуск не найден")
    if not access_token or not secrets.compare_digest(run.access_token_hash or "", _token_hash(access_token)):
        raise HTTPException(status_code=404, detail="Запуск не найден")
    return run


def _serialize(run: AudienceSimulationRun) -> dict:
    return {
        "id": run.id,
        "campaign_id": run.campaign_id,
        "status": run.status,
        "revision": run.revision,
        "idea": run.idea,
        "audience": run.audience,
        "price": run.price,
        "evidence": run.evidence or [],
        "findings": run.findings or [],
        "selection": run.selection or {},
        "responses": run.responses or [],
        "aggregate": run.aggregate,
        "summary": run.summary,
        "events": run.events or [],
        "updated_at": run.updated_at,
    }


@router.post("/admin/campaigns")
async def create_campaign(
    payload: CampaignCreate,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    _validate_campaign_settings(payload.settings)
    if payload.starts_at and payload.ends_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="Дата окончания должна быть позже даты начала")
    if await db.scalar(select(AudienceSimulationCampaign.id).where(AudienceSimulationCampaign.code == payload.code)):
        raise HTTPException(status_code=409, detail="Код кампании уже занят")
    campaign = AudienceSimulationCampaign(
        name=payload.name.strip(),
        code=payload.code,
        status="draft",
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        settings=payload.settings,
        created_by_user_id=admin.id,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)
    return {"id": campaign.id, "name": campaign.name, "code": campaign.code, "status": campaign.status}


@router.patch("/admin/campaigns/{campaign_id}/status")
async def set_campaign_status(
    campaign_id: int,
    status: str,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    if status not in {"draft", "active", "closed"}:
        raise HTTPException(status_code=422, detail="Недопустимый статус кампании")
    campaign = await db.get(AudienceSimulationCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    if status == "active" and (campaign.settings or {}).get("competition_enabled"):
        try:
            _validate_campaign_settings(campaign.settings or {})
        except HTTPException as exc:
            raise HTTPException(status_code=409, detail="Сначала зафиксируйте корректные правила конкурса") from exc
    campaign.status = status
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": campaign.id, "status": campaign.status}


@router.get("/admin/campaigns")
async def list_campaigns(
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    campaigns = (await db.execute(select(AudienceSimulationCampaign).order_by(AudienceSimulationCampaign.created_at.desc()))).scalars().all()
    return [{
        "id": campaign.id,
        "name": campaign.name,
        "code": campaign.code,
        "status": campaign.status,
        "starts_at": campaign.starts_at,
        "ends_at": campaign.ends_at,
        "settings": campaign.settings,
    } for campaign in campaigns]


@router.patch("/admin/campaigns/{campaign_id}/settings")
async def update_campaign_settings(
    campaign_id: int,
    payload: CampaignSettingsUpdate,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    campaign = await db.get(AudienceSimulationCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    if campaign.status != "draft":
        raise HTTPException(status_code=409, detail="Правила кампании фиксируются до её активации")
    settings = payload.settings
    _validate_campaign_settings(settings)
    campaign.settings = settings
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": campaign.id, "settings": campaign.settings}


@router.get("/campaigns/{code}/config")
async def campaign_config(
    code: str,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    campaign = await _get_campaign(db, code)
    return {
        "name": campaign.name,
        "limits": {"min_audience": 5, "max_audience": 12, "default_audience": 12},
        "audience_model": PERSONA_MODEL,
        "search_model": SEARCH_MODEL,
        "min_valid_responses": int((campaign.settings or {}).get("min_valid_responses", 8)),
        "disclaimer": "Ответы виртуальных респондентов смоделированы и не являются статистически репрезентативным прогнозом.",
        "competition_enabled": bool((campaign.settings or {}).get("competition_enabled")),
    }


@router.post("/campaigns/{code}/runs", status_code=202)
async def create_run(
    code: str,
    payload: RunCreate,
    background_tasks: BackgroundTasks,
    operator: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    campaign = await _get_campaign(db, code)
    raw_token = secrets.token_urlsafe(32)
    run = AudienceSimulationRun(
        campaign_id=campaign.id,
        owner_user_id=None,
        access_token_hash=_token_hash(raw_token),
        status="preparing",
        idea=payload.idea.strip(),
        audience=payload.audience.strip() if payload.audience and payload.audience.strip() else None,
        price=payload.price.strip() if payload.price and payload.price.strip() else None,
        input_data={"operator_id": operator.id, "price_was_provided": bool(payload.price and payload.price.strip())},
        config_snapshot={
            "persona_model": PERSONA_MODEL,
            "search_model": SEARCH_MODEL,
            "audience_size": 12,
            "interview_version": "v1",
        },
        events=[],
    )
    _event(run, "run_created")
    _event(run, "search_started", {"model": SEARCH_MODEL})
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_prepare_run, run.id)
    return {"run_id": run.id, "access_token": raw_token, "status": run.status}


@router.get("/runs/{run_id}")
async def get_run(
    run_id: int,
    x_audience_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_db),
):
    return _serialize(await _get_run(db, run_id, x_audience_token))


@router.post("/runs/{run_id}/continue-without-search", status_code=202)
async def continue_without_search(
    run_id: int,
    background_tasks: BackgroundTasks,
    x_audience_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_db),
):
    run = await _get_run(db, run_id, x_audience_token)
    if run.status != "awaiting_search_fallback":
        raise HTTPException(status_code=409, detail="Этот запуск не ожидает решения о продолжении")
    run.status = "preparing"
    run.input_data = {**(run.input_data or {}), "continue_without_search": True}
    run.revision += 1
    run.updated_at = datetime.utcnow()
    _event(run, "search_skipped_by_user")
    await db.commit()
    background_tasks.add_task(_prepare_run, run.id)
    return {"run_id": run.id, "status": run.status}


@router.post("/runs/{run_id}/cancel")
async def cancel_run(
    run_id: int,
    x_audience_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_db),
):
    run = await _get_run(db, run_id, x_audience_token)
    if run.status not in {"preparing", "awaiting_search_fallback", "awaiting_audience_confirmation", "interviewing"}:
        raise HTTPException(status_code=409, detail="Этот запуск уже нельзя остановить")
    run.status = "cancelled"
    run.updated_at = datetime.utcnow()
    _event(run, "run_cancelled")
    await db.commit()
    return {"run_id": run.id, "status": run.status}


@router.patch("/runs/{run_id}/selection")
async def update_selection(
    run_id: int,
    payload: SelectionUpdate,
    x_audience_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_db),
):
    run = await _get_run(db, run_id, x_audience_token)
    if run.status != "awaiting_audience_confirmation":
        raise HTTPException(status_code=409, detail="Состав аудитории сейчас нельзя изменить")
    selection = run.selection or {}
    if payload.selection_version != selection.get("version"):
        raise HTTPException(status_code=409, detail="Версия аудитории устарела")
    members = list(selection.get("members") or [])
    if payload.size > len(members):
        raise HTTPException(status_code=422, detail=f"Доступно только {len(members)} проверенных профилей")
    allowed = set(payload.include_groups) if payload.include_groups else {p.get("group") for p in members}
    if payload.constraints:
        revised, _ = await generate_json(
            "Ты обновляешь состав синтетической аудитории. Сохраняй только явно заданные пользователем условия. "
            "Верни JSON с members, содержащим выбранные профили с id, group, profile и selection_reason. Не выдумывай характеристики из внешних источников.",
            f"Условия пользователя: {payload.constraints}\nГруппы: {sorted(g for g in allowed if g)}\n"
            f"Нужно профилей: {payload.size}\nИсходные профили: {members}",
        )
        members = revised.get("members", [])
    members = [item for item in members if item.get("group") in allowed][: payload.size]
    if len(members) < 5:
        raise HTTPException(status_code=422, detail="По этим условиям не набирается минимальная аудитория")
    run.selection = {**selection, "version": selection.get("version", 0) + 1, "members": members, "constraints": payload.constraints}
    run.revision += 1
    run.updated_at = datetime.utcnow()
    _event(run, "selection_ready", {"version": run.selection["version"], "count": len(members)})
    await db.commit()
    return run.selection


@router.post("/runs/{run_id}/start", status_code=202)
async def start_interviews(
    run_id: int,
    selection_version: int,
    background_tasks: BackgroundTasks,
    x_audience_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_db),
):
    run = await _get_run(db, run_id, x_audience_token)
    selection = run.selection or {}
    if run.status != "awaiting_audience_confirmation" or selection_version != selection.get("version"):
        raise HTTPException(status_code=409, detail="Подтвердите актуальный состав аудитории")
    run.status = "interviewing"
    _event(run, "interviews_started", {"count": len(selection.get("members") or [])})
    await db.commit()
    background_tasks.add_task(_interview_run, run.id)
    return {"run_id": run.id, "status": run.status}


@router.get("/runs/{run_id}/result")
async def get_result(
    run_id: int,
    x_audience_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_db),
):
    run = await _get_run(db, run_id, x_audience_token)
    if run.status not in {"completed", "partial"}:
        raise HTTPException(status_code=409, detail="Результат ещё готовится")
    return {"run_id": run.id, "status": run.status, "aggregate": run.aggregate, "summary": run.summary, "responses": run.responses, "evidence": run.evidence}


@router.post("/runs/{run_id}/claim-links")
async def create_claim_link(
    run_id: int,
    x_audience_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_db),
):
    run = await _get_run(db, run_id, x_audience_token)
    if run.status not in {"completed", "partial"}:
        raise HTTPException(status_code=409, detail="Ссылка появится после завершения исследования")
    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(days=7)
    db.add(AudienceSimulationAccessToken(
        run_id=run.id,
        token_hash=_token_hash(raw_token),
        purpose="claim",
        expires_at=expires_at,
    ))
    await db.commit()
    return {"token": raw_token, "expires_at": expires_at, "campaign_name": (await db.get(AudienceSimulationCampaign, run.campaign_id)).name}


async def _claim_token(db: AsyncSession, raw_token: str) -> AudienceSimulationAccessToken:
    token = (await db.execute(select(AudienceSimulationAccessToken).where(
        AudienceSimulationAccessToken.token_hash == _token_hash(raw_token),
        AudienceSimulationAccessToken.purpose == "claim",
    ))).scalar_one_or_none()
    if not token or token.revoked_at or token.expires_at <= datetime.utcnow() or token.claimed_by_user_id:
        raise HTTPException(status_code=404, detail="Ссылка недоступна или уже использована")
    return token


@router.get("/claims/{raw_token}/preview")
async def claim_preview(raw_token: str, db: AsyncSession = Depends(get_async_db)):
    token = await _claim_token(db, raw_token)
    run = await db.get(AudienceSimulationRun, token.run_id)
    campaign = await db.get(AudienceSimulationCampaign, run.campaign_id) if run else None
    if not run or not campaign:
        raise HTTPException(status_code=404, detail="Результат не найден")
    return {
        "campaign_name": campaign.name,
        "campaign_code": campaign.code,
        "badge": (campaign.settings or {}).get("badge", "Форум «Цифровые решения»"),
        "competition_enabled": bool((campaign.settings or {}).get("competition_enabled")),
        "score_formula": (campaign.settings or {}).get("score_formula"),
        "min_valid_responses": int((campaign.settings or {}).get("min_valid_responses", 8)),
        "run_id": run.id,
        "idea": run.idea,
        "status": run.status,
        "aggregate": run.aggregate,
        "summary": run.summary,
        "evidence": run.evidence,
        "responses": run.responses,
    }


@router.get("/claims/{raw_token}/qr")
async def claim_qr(raw_token: str, db: AsyncSession = Depends(get_async_db)):
    await _claim_token(db, raw_token)
    try:
        import qrcode
        import qrcode.image.svg
        from io import BytesIO

        base = os.getenv("PUBLIC_SITE_URL", "https://pitchy.pro").rstrip("/")
        claim_url = f"{base}/audience-simulation/claim/{raw_token}"
        image = qrcode.make(claim_url, image_factory=qrcode.image.svg.SvgPathImage, border=2)
        output = BytesIO()
        image.save(output)
        return Response(
            content=output.getvalue(),
            media_type="image/svg+xml",
            headers={"Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"},
        )
    except Exception:
        logger.exception("Audience simulation QR rendering failed")
        raise HTTPException(status_code=503, detail="Не удалось подготовить QR-код")


@router.post("/claims/{raw_token}/accept")
async def accept_claim(
    raw_token: str,
    payload: ClaimAccept,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    if not payload.consent or payload.consent_version != "forum-2026-v1":
        raise HTTPException(status_code=422, detail="Нужно подтвердить условия привязки результата")
    token = (await db.execute(select(AudienceSimulationAccessToken).where(
        AudienceSimulationAccessToken.token_hash == _token_hash(raw_token),
        AudienceSimulationAccessToken.purpose == "claim",
    ).with_for_update())).scalar_one_or_none()
    if not token or token.revoked_at or token.expires_at <= datetime.utcnow() or token.claimed_by_user_id:
        raise HTTPException(status_code=404, detail="Ссылка недоступна или уже использована")
    run = await db.get(AudienceSimulationRun, token.run_id)
    if not run or run.status not in {"completed", "partial"}:
        raise HTTPException(status_code=409, detail="Исследование ещё не готово")
    if await db.scalar(select(AudienceSimulationParticipant.id).where(
        AudienceSimulationParticipant.campaign_id == run.campaign_id,
        AudienceSimulationParticipant.user_id == user.id,
    )):
        raise HTTPException(status_code=409, detail="В этой кампании уже есть результат, привязанный к аккаунту")
    campaign = await db.get(AudienceSimulationCampaign, run.campaign_id)
    settings = campaign.settings or {}
    score_settings = settings.get("score_formula") or {}
    weights = score_settings.get("weights") or {}
    min_valid = int(settings.get("min_valid_responses", 8))
    score = None
    score_version = None
    averages = (run.aggregate or {}).get("averages") or {}
    required = {"problem_relevance": 40, "interest": 35, "willingness_to_try": 25}
    if (
        settings.get("competition_enabled")
        and
        weights == required
        and (run.aggregate or {}).get("valid_responses", 0) >= min_valid
        and all(isinstance(averages.get(key), (float, int)) for key in required)
    ):
        score = round(sum(float(averages[key]) * 10 * weight / 100 for key, weight in required.items()), 2)
        score_version = str(score_settings.get("version") or "40-35-25-v1")
    participant = AudienceSimulationParticipant(
        campaign_id=run.campaign_id,
        user_id=user.id,
        run_id=run.id,
        consent_at=datetime.utcnow(),
        consent_version=payload.consent_version,
        campaign_badge=settings.get("badge", "Форум «Цифровые решения»"),
        event_score=score,
        score_version=score_version,
    )
    db.add(participant)
    await db.flush()
    token.claimed_by_user_id = user.id
    token.revoked_at = datetime.utcnow()
    run.owner_user_id = user.id
    run.access_token_hash = None
    _event(run, "result_claimed", {"participant_id": participant.id})
    await db.commit()
    return {
        "status": "claimed",
        "campaign_badge": participant.campaign_badge,
        "event_score": float(score) if score is not None else None,
        "competition_enabled": bool(settings.get("competition_enabled")),
        "eligible": score is not None,
    }


@router.get("/events/{code}/me")
async def campaign_me(
    code: str,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    campaign = await _get_campaign(db, code, active=False)
    participant = (await db.execute(select(AudienceSimulationParticipant).where(
        AudienceSimulationParticipant.campaign_id == campaign.id,
        AudienceSimulationParticipant.user_id == user.id,
    ))).scalar_one_or_none()
    if not participant:
        raise HTTPException(status_code=404, detail="У вас пока нет результата этой кампании")
    return {
        "campaign_name": campaign.name,
        "campaign_badge": participant.campaign_badge,
        "run_id": participant.run_id,
        "event_score": float(participant.event_score) if participant.event_score is not None else None,
        "score_version": participant.score_version,
        "reward_status": participant.reward_status,
        "competition_enabled": bool((campaign.settings or {}).get("competition_enabled")),
        "score_status": (
            "not_in_competition"
            if not (campaign.settings or {}).get("competition_enabled")
            else "eligible" if participant.event_score is not None
            else "insufficient_answers"
        ),
        "min_valid_responses": int((campaign.settings or {}).get("min_valid_responses", 8)),
    }


@router.get("/events/{code}/me/result")
async def campaign_my_result(
    code: str,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    campaign = await _get_campaign(db, code, active=False)
    participant = (await db.execute(select(AudienceSimulationParticipant).where(
        AudienceSimulationParticipant.campaign_id == campaign.id,
        AudienceSimulationParticipant.user_id == user.id,
    ))).scalar_one_or_none()
    if not participant:
        raise HTTPException(status_code=404, detail="У вас пока нет результата этой кампании")
    run = await db.get(AudienceSimulationRun, participant.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Результат не найден")
    return {"run_id": run.id, "status": run.status, "idea": run.idea, "aggregate": run.aggregate, "summary": run.summary, "evidence": run.evidence}


@router.get("/admin/campaigns/{campaign_id}/participants")
async def campaign_participants(
    campaign_id: int,
    request: Request,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    rows = (await db.execute(
        select(AudienceSimulationParticipant, User.email, AudienceSimulationRun.created_at)
        .join(User, User.id == AudienceSimulationParticipant.user_id)
        .join(AudienceSimulationRun, AudienceSimulationRun.id == AudienceSimulationParticipant.run_id)
        .where(AudienceSimulationParticipant.campaign_id == campaign_id)
        .order_by(AudienceSimulationParticipant.event_score.desc().nullslast(), AudienceSimulationParticipant.created_at)
    )).all()
    db.add(AdminAuditLog(
        admin_id=admin.id,
        admin_email=admin.email,
        action="audience_simulation.participants.read",
        target_type="campaign",
        target_id=str(campaign_id),
        details={"participant_count": len(rows)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:500],
    ))
    await db.commit()
    return [{
        "id": participant.id,
        "email": email,
        "run_id": participant.run_id,
        "score": float(participant.event_score) if participant.event_score is not None else None,
        "score_version": participant.score_version,
        "reward_status": participant.reward_status,
        "registered_at": participant.created_at,
        "run_created_at": run_created_at,
    } for participant, email, run_created_at in rows]


@router.patch("/admin/participants/{participant_id}/winner")
async def set_reward_winner(
    participant_id: int,
    selected: bool,
    request: Request,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    participant = await db.get(AudienceSimulationParticipant, participant_id, with_for_update=True)
    if not participant:
        raise HTTPException(status_code=404, detail="Участник не найден")
    if participant.reward_status == "issued":
        raise HTTPException(status_code=409, detail="Приз уже выдан")
    participant.reward_status = "selected" if selected else "not_issued"
    db.add(AdminAuditLog(
        admin_id=admin.id, admin_email=admin.email,
        action="audience_simulation.reward_winner.selected" if selected else "audience_simulation.reward_winner.unselected",
        target_type="participant", target_id=str(participant_id), details={"campaign_id": participant.campaign_id},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:500],
    ))
    await db.commit()
    return {"participant_id": participant.id, "reward_status": participant.reward_status}


@router.post("/admin/participants/{participant_id}/reward")
async def issue_reward(
    participant_id: int,
    request: Request,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    participant = await db.get(AudienceSimulationParticipant, participant_id, with_for_update=True)
    if not participant:
        raise HTTPException(status_code=404, detail="Участник не найден")
    if participant.reward_status != "selected":
        raise HTTPException(status_code=409, detail="Сначала отметьте участника как победителя")
    if participant.reward_issued_at:
        raise HTTPException(status_code=409, detail="Приз уже выдан")
    user = await db.get(User, participant.user_id)
    now = datetime.utcnow()
    subscription = await get_subscription(db, user.id, for_update=True)
    # Never replace or shorten an existing entitlement. An organizer must resolve
    # an existing plan before the gift can be applied.
    if subscription is not None or (
        user.subscription_tier not in {"free", "tester"}
        and user.subscription_expires_at
        and user.subscription_expires_at > now
    ):
        raise HTTPException(status_code=409, detail="У участника уже есть подписка. Приз оставлен ожидающим выдачи.")
    config = {**BASE_CONFIG, "custdev": BASE_CONFIG["custdev"] + 3}
    subscription = CustomSubscription(
        user_id=user.id, status="active", auto_renew=False,
        current_period_start=now, current_period_end=now + relativedelta(months=1),
        current_config=config, next_config=config, used=empty_usage(),
    )
    db.add(subscription)
    participant.reward_status = "issued"
    participant.reward_issued_by_user_id = admin.id
    participant.reward_issued_at = now
    db.add(AdminAuditLog(
        admin_id=admin.id, admin_email=admin.email,
        action="audience_simulation.reward.issued", target_type="participant", target_id=str(participant_id),
        details={"user_id": user.id, "duration_months": 1, "config": config},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:500],
    ))
    await db.commit()
    return {"participant_id": participant.id, "reward_status": participant.reward_status, "expires_at": subscription.current_period_end, "config": config}


async def _prepare_run(run_id: int) -> None:
    try:
        async with AsyncSessionLocal() as db:
            run = await db.get(AudienceSimulationRun, run_id)
            if not run or run.status != "preparing":
                return
            snapshot = {
                "idea": run.idea,
                "audience": run.audience,
                "price": run.price,
                "input_data": dict(run.input_data or {}),
                "evidence": list(run.evidence or []),
            }
            await db.commit()

        if snapshot["input_data"].get("continue_without_search"):
            search = {"sources": snapshot["evidence"], "text": "Поиск не дал источников. Пользователь подтвердил продолжение без открытых сигналов."}
        elif snapshot["evidence"] and snapshot["input_data"].get("search_summary"):
            search = {"sources": snapshot["evidence"], "text": snapshot["input_data"]["search_summary"]}
        else:
            search = await search_evidence(snapshot["idea"], snapshot["audience"], snapshot["price"])
            snapshot["evidence"] = search["sources"]
            snapshot["input_data"]["search_summary"] = search["text"]
            async with AsyncSessionLocal() as db:
                run = await db.get(AudienceSimulationRun, run_id)
                if not run or run.status != "preparing":
                    return
                run.evidence = search["sources"]
                run.input_data = snapshot["input_data"]
                _event(run, "search_completed", {"source_count": len(run.evidence)})
                if not run.evidence:
                    run.status = "awaiting_search_fallback"
                    run.updated_at = datetime.utcnow()
                    _event(run, "search_empty")
                    await db.commit()
                    return
                await db.commit()

        finding_data, _ = await generate_json(
            "Выдели проверяемые темы проблемы, текущие альтернативы и группы аудитории из поискового обзора. "
            "Не добавляй факты о продукте, цене или демографии, которых нет во вводе/источниках. "
            "Верни JSON: pain_findings (массив объектов {text, source_ids, claim_type, limitation}), "
            "groups (массив {name, basis, source_ids}), uncertainty (массив). "
            "claim_type должен быть sourced_paraphrase, hypothesis или assumption. Не придумывай source_ids.",
            f"Описание идеи: {snapshot['idea']}\nЯвно указанная аудитория: {snapshot['audience'] or 'не задана'}\n"
            f"Цена: {snapshot['price'] or 'не задана'}\nПоисковый обзор: {search['text']}\n"
            f"Ссылки поиска: {snapshot['evidence']}",
        )
        if not isinstance(finding_data, dict):
            finding_data = {}
        raw_pains = finding_data.get("pain_findings")
        raw_groups = finding_data.get("groups")
        raw_uncertainty = finding_data.get("uncertainty")
        if not isinstance(raw_pains, list):
            raw_pains = []
        if not isinstance(raw_groups, list):
            raw_groups = []
        if not isinstance(raw_uncertainty, list):
            raw_uncertainty = []
        valid_source_ids = {source.get("id") for source in snapshot["evidence"]}
        findings = []
        for item in raw_pains[:12]:
            if isinstance(item, str):
                item = {"text": item, "source_ids": [], "claim_type": "assumption", "limitation": "Основание не связано с источником"}
            if not isinstance(item, dict) or not item.get("text"):
                continue
            refs = [source_id for source_id in (item.get("source_ids") or []) if source_id in valid_source_ids]
            claim_type = item.get("claim_type") if item.get("claim_type") in {"sourced_paraphrase", "hypothesis", "assumption"} else "assumption"
            if not refs and claim_type == "sourced_paraphrase":
                claim_type = "assumption"
            findings.append({
                "text": str(item["text"])[:400],
                "source_ids": refs,
                "claim_type": claim_type,
                "limitation": str(item.get("limitation") or "")[:300],
            })
        group_specs = []
        for group in raw_groups[:8]:
            if not isinstance(group, dict) or not group.get("name"):
                continue
            group_specs.append({
                "name": str(group["name"])[:160],
                "basis": str(group.get("basis") or "")[:300],
                "source_ids": [source_id for source_id in (group.get("source_ids") or []) if source_id in valid_source_ids],
            })
        requested = 12
        persona_data, _ = await generate_json(
            "Создай синтетические профили только для данного исследования. Это вымышленные профили, не реальные люди. "
            "Не выдумывай биографии, географию или возраст без основания. Пользовательские жёсткие ограничения обязательны. "
            "Ответ строго JSON: members — массив объектов {id, group, profile, selection_reason}. Профили различаются поведением и потребностями.",
            f"Идея: {snapshot['idea']}\nЯвно заданная аудитория: {snapshot['audience'] or 'не задана'}\n"
            f"Цена: {snapshot['price'] or 'не задана'}\nНайденные сигналы: {findings}\nГруппы-кандидаты: {group_specs}\n"
            f"Создай {requested} профилей.",
            max_tokens=3000,
        )
        members = persona_data.get("members", []) if isinstance(persona_data, dict) else []
        if not isinstance(members, list):
            members = []
        valid = []
        seen_profiles: set[str] = set()
        for candidate in members:
            if not isinstance(candidate, dict) or not candidate.get("profile") or not candidate.get("group"):
                continue
            profile = " ".join(str(candidate["profile"]).split())[:700]
            fingerprint = profile.casefold()
            if not profile or fingerprint in seen_profiles:
                continue
            seen_profiles.add(fingerprint)
            valid.append({
                "id": f"persona_{len(valid) + 1:02d}",
                "group": str(candidate["group"])[:100],
                "profile": profile,
                "selection_reason": str(candidate.get("selection_reason") or "Сформирован под заданную гипотезу")[:300],
            })
            if len(valid) >= requested:
                break
        async with AsyncSessionLocal() as db:
            run = await db.get(AudienceSimulationRun, run_id)
            if not run or run.status != "preparing":
                return
            run.findings = findings
            run.selection = {
                "version": 1,
                "members": valid[:requested],
                "groups": group_specs,
                "uncertainty": [str(item)[:300] for item in raw_uncertainty[:10]],
                "requested_size": requested,
            }
            run.status = "awaiting_audience_confirmation" if len(valid) >= 5 else "failed"
            run.revision += 1
            run.updated_at = datetime.utcnow()
            _event(run, "selection_ready", {"count": len(valid[:requested]), "version": 1})
            await db.commit()
    except Exception:
        logger.exception("Audience simulation preparation failed (run_id=%s)", run_id)
        async with AsyncSessionLocal() as db:
            run = await db.get(AudienceSimulationRun, run_id)
            if not run or run.status not in {"preparing", "interviewing"}:
                return
            run.status = "failed"
            run.aggregate = {"error": "SEARCH_OR_PERSONA_PROVIDER_FAILED", "retryable": True}
            run.updated_at = datetime.utcnow()
            _event(run, "run_failed", {"code": "SEARCH_OR_PERSONA_PROVIDER_FAILED"})
            await db.commit()


async def _ask_persona(run_snapshot: dict, persona: dict) -> dict:
    system = (
        "Ты синтетический респондент, созданный для проверки идеи. Ты не реальный человек. "
        "Отвечай только в рамках заданного профиля, признавай отсутствие опыта и недостаток сведений. "
        "Не придумывай цену и возможности продукта, не соглашайся из вежливости. "
        "Внешние сигналы — контекст обсуждений, а не твой личный опыт. Верни JSON с полями: "
        "persona_id, group, problem_relevance, problem_severity, solution_clarity, interest, willingness_to_try, "
        "price_assessment, current_alternative, motivators, barriers, reaction, insufficient_information. "
        "Шкалы — целые числа 0..10 либо null. reaction до 250 символов."
    )
    user = (
        f"Идея: {run_snapshot['idea']}\nЦена (если задана): {run_snapshot.get('price') or 'не задана'}\n"
        f"Ваш синтетический профиль: {persona}\nСигналы из открытых источников (это не ваш опыт): {run_snapshot.get('findings')}"
    )
    async with _interview_limit:
        data, _ = await generate_json(system, user, max_tokens=550)
    data["persona_id"] = str(persona["id"])
    data["group"] = persona["group"]
    return data


def _valid_response(item: dict, persona_id: str, price_was_provided: bool) -> bool:
    if item.get("persona_id") != persona_id:
        return False
    for key in ("problem_relevance", "problem_severity", "solution_clarity", "interest", "willingness_to_try"):
        value = item.get(key)
        if value is not None and (not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 10):
            return False
    if not price_was_provided:
        item.pop("price_assessment", None)
    item["reaction"] = str(item.get("reaction") or "")[:250]
    item["motivators"] = list(item.get("motivators") or [])[:3]
    item["barriers"] = list(item.get("barriers") or [])[:3]
    return True


async def _interview_run(run_id: int) -> None:
    async with AsyncSessionLocal() as db:
        run = await db.get(AudienceSimulationRun, run_id)
        if not run or run.status != "interviewing":
            return
        snapshot = {"idea": run.idea, "price": run.price, "findings": run.findings, "price_was_provided": bool((run.input_data or {}).get("price_was_provided"))}
        members = list((run.selection or {}).get("members") or [])
        answered_ids = {str(item.get("persona_id")) for item in (run.responses or [])}
    pending_members = [persona for persona in members if str(persona.get("id")) not in answered_ids]
    async def work(persona: dict):
        try:
            result = await _ask_persona(snapshot, persona)
            if not _valid_response(result, str(persona["id"]), snapshot["price_was_provided"]):
                return persona, None
            return persona, result
        except Exception:
            return persona, None
    tasks = [asyncio.create_task(work(persona)) for persona in pending_members]
    # Responses are written one at a time as tasks finish. This makes the
    # progress endpoint reflect saved answers and avoids concurrent lost JSON updates.
    for finished in asyncio.as_completed(tasks):
        persona, response = await finished
        if not response:
            continue
        async with AsyncSessionLocal() as progress_db:
            progress_run = await progress_db.get(AudienceSimulationRun, run_id)
            if not progress_run or progress_run.status != "interviewing":
                for task in tasks:
                    if not task.done():
                        task.cancel()
                return
            responses = list(progress_run.responses or [])
            if any(str(item.get("persona_id")) == str(persona["id"]) for item in responses):
                continue
            responses.append(response)
            progress_run.responses = responses
            progress_run.updated_at = datetime.utcnow()
            _event(progress_run, "persona_answered", {"persona_id": persona["id"], "valid_responses": len(responses), "requested_responses": len(members)})
            await progress_db.commit()
    async with AsyncSessionLocal() as db:
        run = await db.get(AudienceSimulationRun, run_id)
        if not run or run.status != "interviewing":
            return
        valid = list(run.responses or [])
        scores: dict[str, list[int]] = {key: [] for key in ("problem_relevance", "interest", "willingness_to_try", "problem_severity", "solution_clarity")}
        for response in valid:
            for key in scores:
                value = response.get(key)
                if isinstance(value, int) and not isinstance(value, bool):
                    scores[key].append(value)
        averages = {key: (round(sum(values) / len(values), 2) if values else None) for key, values in scores.items()}
        denominator = len(valid)
        percentages: dict[str, float | None] = {}
        score_denominators: dict[str, int] = {}
        for key in ("problem_relevance", "interest", "willingness_to_try"):
            answered = [r[key] for r in valid if isinstance(r.get(key), int) and not isinstance(r.get(key), bool)]
            score_denominators[key] = len(answered)
            percentages[key] = round(sum(1 for value in answered if value >= 7) / len(answered) * 100, 1) if answered else None
        run.aggregate = {
            "valid_responses": denominator,
            "requested_responses": len(members),
            "averages": averages,
            "percent_at_least_7": percentages,
            "denominators": score_denominators,
        }
        run.status = "completed" if denominator >= 5 else "partial"
        run.updated_at = datetime.utcnow()
        _event(run, "result_ready", {"valid_responses": denominator, "requested_responses": len(members)})
        await db.commit()
        try:
            summary, _ = await generate_json(
                "Сделай краткие выводы только по переданным агрегатам и частым мотиваторам/барьерам. "
                "Не утверждай статистическую точность или прогноз продаж. JSON: headline, observations (массив), next_checks (массив).",
                f"Агрегаты: {run.aggregate}\nОтветы: {valid}",
                max_tokens=700,
            )
            run = await db.get(AudienceSimulationRun, run_id)
            if run:
                run.summary = summary
                _event(run, "summary_ready")
                await db.commit()
        except Exception:
            # The calculated result remains available if narrative generation fails.
            pass


async def resume_pending_runs() -> None:
    """Resume persisted work after a process restart without repeating saved answers."""
    async with AsyncSessionLocal() as db:
        run_ids = (await db.execute(select(AudienceSimulationRun.id).where(
            AudienceSimulationRun.status.in_(["preparing", "interviewing"]),
        ))).scalars().all()
    for run_id in run_ids:
        async with AsyncSessionLocal() as db:
            run = await db.get(AudienceSimulationRun, run_id)
            if not run:
                continue
            worker = _prepare_run if run.status == "preparing" else _interview_run
        asyncio.create_task(worker(run_id))
