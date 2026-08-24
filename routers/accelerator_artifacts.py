"""Contextual Pitchy actions and permissioned accelerator artifact references."""
from __future__ import annotations

from datetime import datetime
import os
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_artifact_service import (
    artifact_visibility,
    can_view_artifact_details,
    validate_artifact_source,
)
from auth import get_async_current_user
from db_async import get_async_db
from models import (
    AcceleratorArtifact,
    AcceleratorMembership,
    AcceleratorProgramAction,
    AcceleratorProgramStage,
    AcceleratorProgramStageProgress,
    ChatMessage,
    ChatSession,
    GrantApplication,
    Project,
    ResearchJob,
    User,
)
from routers.accelerators import (
    add_audit,
    artifact_dict,
    get_cohort_or_404,
    get_resident_membership,
    require_cohort_reader,
    require_pitchy_artifacts_module,
    resident_program_rows,
    tracker_membership_ids,
)
from schemas.accelerators import AcceleratorArtifactUpdate


router = APIRouter(prefix="/api/accelerators", tags=["accelerator-artifacts"])


async def get_action_context(
    db: AsyncSession, action_id: int, user: User
) -> tuple[AcceleratorProgramAction, AcceleratorProgramStage, AcceleratorMembership, Project]:
    action = await db.get(AcceleratorProgramAction, action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Действие программы не найдено")
    stage = await db.get(AcceleratorProgramStage, action.stage_id)
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.cohort_id == stage.cohort_id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalar_one_or_none()
    if not membership or not membership.project_id:
        raise HTTPException(status_code=404, detail="Действие программы не найдено")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_pitchy_artifacts_module(db, cohort)
    state = next(
        (row["state"] for row in await resident_program_rows(db, membership) if row["id"] == stage.id),
        None,
    )
    if state not in ("available", "completed"):
        raise HTTPException(status_code=409, detail="Этап программы пока закрыт")
    project = await db.get(Project, membership.project_id)
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=409, detail="Проект резидента недоступен")
    return action, stage, membership, project


def launch_url(action: AcceleratorProgramAction, membership: AcceleratorMembership, project: Project) -> str:
    context = urlencode({
        "project": project.id,
        "accelerator_membership": membership.id,
        "accelerator_action": action.id,
    })
    if action.action_type == "roadmap":
        return f"/dashboard?tab=tree&{context}"
    if action.action_type == "grants":
        return f"/grants?{context}"
    if action.action_type == "custdev":
        return os.getenv("CUSTDEV_URL", "https://custdev.pitchy.pro/").rstrip("/") + "/"
    return f"/dashboard?tab=chat&{context}"


@router.post("/program/actions/{action_id}/launch")
async def launch_program_action(
    action_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    action, stage, membership, project = await get_action_context(db, action_id, user)
    # Serialize launches for one resident so parallel browser retries cannot
    # create a second artifact or a second contextual chat before the unique
    # constraint becomes visible.
    await db.execute(select(AcceleratorMembership.id).where(
        AcceleratorMembership.id == membership.id
    ).with_for_update())
    row = (await db.execute(select(AcceleratorArtifact).where(
        AcceleratorArtifact.action_id == action.id,
        AcceleratorArtifact.membership_id == membership.id,
    ).with_for_update())).scalar_one_or_none()
    if not row:
        completed_progress = (await db.execute(select(
            AcceleratorProgramStageProgress.id
        ).where(
            AcceleratorProgramStageProgress.membership_id == membership.id,
            AcceleratorProgramStageProgress.stage_id == stage.id,
        ))).scalar_one_or_none()
        if completed_progress is not None:
            raise HTTPException(status_code=409, detail="Этап уже завершён")
        row = AcceleratorArtifact(
            action_id=action.id,
            membership_id=membership.id,
            project_id=project.id,
            artifact_type=action.action_type,
            status="started",
            title=action.title,
            visibility=artifact_visibility(organizer=False, tracker=False),
        )
        db.add(row)
        await db.flush()

    target_url = launch_url(action, membership, project)
    if action.action_type in ("chat", "research", "presentation") and not row.source_type:
        session = ChatSession(
            user_id=user.id,
            project_id=project.id,
            title=f"{action.title} — {project.name}",
            accelerator_membership_id=membership.id,
            accelerator_action_id=action.id,
        )
        db.add(session)
        await db.flush()
        db.add(ChatMessage(
            session_id=session.id,
            role="assistant",
            content=(
                f"Контекст программы: «{stage.title}». Действие: «{action.title}». "
                "Результат останется приватным, пока вы явно не поделитесь им с организатором или трекером."
            ),
        ))
        row.source_type = "chat_session"
        row.source_id = str(session.id)
        row.url = f"/dashboard?tab=chat&session={session.id}"
        target_url = row.url
    elif action.action_type in ("chat", "research", "presentation"):
        target_url = row.url or target_url
    elif action.action_type == "roadmap":
        resolved = await validate_artifact_source(
            db,
            membership=membership,
            source_type="roadmap",
            source_id=str(project.id),
            submitted_url=None,
        )
        row.source_type = resolved["source_type"]
        row.source_id = resolved["source_id"]
        row.url = target_url
        row.summary = resolved.get("summary")
        row.status = resolved.get("status", "started")
    elif not row.url:
        row.url = target_url

    cohort = await get_cohort_or_404(db, membership.cohort_id)
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="artifact.launched",
        target_type="accelerator_artifact",
        target_id=row.id,
        details={"action_id": action.id, "action_type": action.action_type},
    )
    await db.commit()
    return {"artifact": artifact_dict(row), "launch_url": target_url}


@router.patch("/program/artifacts/{artifact_id}")
async def update_program_artifact(
    artifact_id: int,
    payload: AcceleratorArtifactUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = (await db.execute(select(AcceleratorArtifact).where(
        AcceleratorArtifact.id == artifact_id
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Результат не найден")
    membership = await db.get(AcceleratorMembership, row.membership_id)
    if not membership or membership.user_id != user.id or membership.status != "enrolled":
        raise HTTPException(status_code=404, detail="Результат не найден")
    action = await db.get(AcceleratorProgramAction, row.action_id)
    stage = await db.get(AcceleratorProgramStage, action.stage_id)
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_pitchy_artifacts_module(db, cohort)

    fields = payload.model_fields_set
    completed_progress = (await db.execute(select(
        AcceleratorProgramStageProgress.id
    ).where(
        AcceleratorProgramStageProgress.membership_id == membership.id,
        AcceleratorProgramStageProgress.stage_id == stage.id,
    ))).scalar_one_or_none()
    if completed_progress is not None and fields.intersection(
        {"status", "source_type", "source_id", "url"}
    ):
        raise HTTPException(
            status_code=409,
            detail="После завершения этапа можно менять только описание и доступ",
        )
    source_type = payload.source_type if "source_type" in fields else row.source_type
    source_id = payload.source_id if "source_id" in fields else row.source_id
    submitted_url = payload.url if "url" in fields else row.url
    requested_status = payload.status or row.status
    resolved = await validate_artifact_source(
        db,
        membership=membership,
        source_type=source_type,
        source_id=source_id,
        submitted_url=submitted_url,
    )
    allowed_ready_sources = {
        "chat": {"chat_session"},
        "research": {"research_job"},
        "roadmap": {"roadmap"},
        "grants": {"grant_application"},
        "custdev": {"external"},
        "presentation": {"external"},
    }
    resolved_status = resolved.get("status", requested_status)
    if requested_status == "ready" and resolved.get("source_type") not in allowed_ready_sources[action.action_type]:
        raise HTTPException(status_code=422, detail="Этот источник не подтверждает результат действия")
    if requested_status == "ready" and resolved_status != "ready" and action.action_type in ("research", "roadmap", "grants"):
        raise HTTPException(status_code=409, detail="Результат в основном Pitchy ещё не готов")
    if requested_status == "ready" and action.action_type == "chat":
        try:
            session_id = int(resolved.get("source_id") or 0)
        except (TypeError, ValueError):
            session_id = 0
        has_user_message = (await db.execute(select(ChatMessage.id).where(
            ChatMessage.session_id == session_id,
            ChatMessage.role == "user",
        ).limit(1))).scalar_one_or_none()
        if has_user_message is None:
            raise HTTPException(status_code=409, detail="Сначала поработайте в чате")

    row.status = requested_status if resolved_status == "ready" else resolved_status
    row.title = (payload.title or resolved.get("title") or row.title or action.title).strip()
    if "summary" in fields:
        row.summary = (payload.summary or "").strip() or None
    elif resolved.get("summary"):
        row.summary = resolved["summary"]
    resolved_url = resolved.get("url")
    if action.action_type == "roadmap":
        row.url = launch_url(action, membership, await db.get(Project, membership.project_id))
    elif action.action_type == "grants" and resolved_url:
        separator = "&" if "?" in resolved_url else "?"
        row.url = (
            f"{resolved_url}{separator}accelerator_membership={membership.id}"
            f"&accelerator_action={action.id}"
        )
    else:
        row.url = resolved_url
    row.source_type = resolved.get("source_type")
    row.source_id = resolved.get("source_id")
    current_visibility = row.visibility or {}
    row.visibility = artifact_visibility(
        organizer=(
            payload.share_with_organizer
            if payload.share_with_organizer is not None
            else bool(current_visibility.get("organizer"))
        ),
        tracker=(
            payload.share_with_tracker
            if payload.share_with_tracker is not None
            else bool(current_visibility.get("tracker"))
        ),
    )
    row.shared_at = datetime.utcnow() if any(row.visibility.values()) else None
    row.completed_at = datetime.utcnow() if row.status == "ready" else None
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="artifact.updated",
        target_type="accelerator_artifact",
        target_id=row.id,
        details={"status": row.status, "visibility": row.visibility, "stage_id": stage.id},
    )
    await db.commit()
    return artifact_dict(row)


@router.post("/program/artifacts/{artifact_id}/sync")
async def sync_program_artifact(
    artifact_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Refresh a result from its canonical Pitchy source without asking for IDs."""
    row = (await db.execute(select(AcceleratorArtifact).where(
        AcceleratorArtifact.id == artifact_id
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Результат не найден")
    membership = await db.get(AcceleratorMembership, row.membership_id)
    if not membership or membership.user_id != user.id or membership.status != "enrolled":
        raise HTTPException(status_code=404, detail="Результат не найден")
    action = await db.get(AcceleratorProgramAction, row.action_id)
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_pitchy_artifacts_module(db, cohort)
    completed_progress = (await db.execute(select(
        AcceleratorProgramStageProgress.id
    ).where(
        AcceleratorProgramStageProgress.membership_id == membership.id,
        AcceleratorProgramStageProgress.stage_id == action.stage_id,
    ))).scalar_one_or_none()
    if completed_progress is not None:
        raise HTTPException(status_code=409, detail="Завершённый этап уже зафиксирован")

    source_type = row.source_type
    source_id = row.source_id
    if action.action_type == "chat":
        if source_type != "chat_session" or not source_id:
            raise HTTPException(status_code=409, detail="Сначала откройте чат из программы")
        try:
            session_id = int(source_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=409, detail="Чат программы недоступен") from exc
        user_message = (await db.execute(select(ChatMessage.id).where(
            ChatMessage.session_id == session_id,
            ChatMessage.role == "user",
        ).limit(1))).scalar_one_or_none()
        resolved = await validate_artifact_source(
            db,
            membership=membership,
            source_type=source_type,
            source_id=source_id,
            submitted_url=row.url,
        )
        resolved["status"] = "ready" if user_message is not None else "started"
    elif action.action_type == "research":
        job = None
        if source_type == "research_job" and source_id:
            try:
                job = await db.get(ResearchJob, int(source_id))
            except (TypeError, ValueError):
                job = None
        elif source_type == "chat_session" and source_id:
            try:
                session_id = int(source_id)
            except (TypeError, ValueError):
                session_id = 0
            job = (await db.execute(select(ResearchJob).where(
                ResearchJob.user_id == user.id,
                ResearchJob.session_id == session_id,
            ).order_by(ResearchJob.created_at.desc()).limit(1))).scalar_one_or_none()
        if not job:
            raise HTTPException(status_code=409, detail="В этом чате ещё нет исследования")
        resolved = await validate_artifact_source(
            db,
            membership=membership,
            source_type="research_job",
            source_id=str(job.id),
            submitted_url=None,
        )
    elif action.action_type == "roadmap":
        resolved = await validate_artifact_source(
            db,
            membership=membership,
            source_type="roadmap",
            source_id=str(membership.project_id),
            submitted_url=None,
        )
    elif action.action_type == "grants":
        application = (await db.execute(select(GrantApplication).where(
            GrantApplication.user_id == user.id,
            GrantApplication.project_id == membership.project_id,
        ).order_by(GrantApplication.updated_at.desc()).limit(1))).scalar_one_or_none()
        if not application:
            raise HTTPException(status_code=409, detail="Для проекта ещё нет грантовой заявки")
        resolved = await validate_artifact_source(
            db,
            membership=membership,
            source_type="grant_application",
            source_id=str(application.id),
            submitted_url=None,
        )
    else:
        raise HTTPException(
            status_code=409,
            detail="Для внешнего результата добавьте ссылку вручную",
        )

    row.source_type = resolved.get("source_type")
    row.source_id = resolved.get("source_id")
    row.url = resolved.get("url")
    row.title = resolved.get("title") or row.title or action.title
    row.summary = resolved.get("summary") or row.summary
    row.status = resolved.get("status", "started")
    row.completed_at = datetime.utcnow() if row.status == "ready" else None
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="artifact.synced",
        target_type="accelerator_artifact",
        target_id=row.id,
        details={"status": row.status, "source_type": row.source_type},
    )
    await db.commit()
    return artifact_dict(row)


@router.delete("/program/artifacts/{artifact_id}", status_code=204)
async def unlink_program_artifact(
    artifact_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = await db.get(AcceleratorArtifact, artifact_id)
    if not row:
        raise HTTPException(status_code=404, detail="Результат не найден")
    membership = await db.get(AcceleratorMembership, row.membership_id)
    if not membership or membership.user_id != user.id:
        raise HTTPException(status_code=404, detail="Результат не найден")
    action = await db.get(AcceleratorProgramAction, row.action_id)
    progress = (await db.execute(select(AcceleratorProgramStageProgress.id).where(
        AcceleratorProgramStageProgress.membership_id == membership.id,
        AcceleratorProgramStageProgress.stage_id == action.stage_id,
    ))).scalar_one_or_none()
    if progress is not None:
        raise HTTPException(status_code=409, detail="Нельзя убрать результат завершённого этапа")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="artifact.unlinked",
        target_type="accelerator_artifact", target_id=row.id,
    )
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)


@router.get("/memberships/{membership_id}/artifacts")
async def list_my_program_artifacts(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await get_resident_membership(db, membership_id, user)
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_pitchy_artifacts_module(db, cohort)
    rows = list((await db.execute(select(AcceleratorArtifact).where(
        AcceleratorArtifact.membership_id == membership.id
    ).order_by(AcceleratorArtifact.updated_at.desc()))).scalars().all())
    return [artifact_dict(row) for row in rows]


@router.get("/cohorts/{cohort_id}/artifacts")
async def list_cohort_program_artifacts(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    access_role = await require_cohort_reader(db, user, cohort)
    await require_pitchy_artifacts_module(db, cohort)
    query = (
        select(
            AcceleratorArtifact,
            AcceleratorMembership,
            AcceleratorProgramAction,
            AcceleratorProgramStage,
            User,
            Project,
        )
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorArtifact.membership_id)
        .join(AcceleratorProgramAction, AcceleratorProgramAction.id == AcceleratorArtifact.action_id)
        .join(AcceleratorProgramStage, AcceleratorProgramStage.id == AcceleratorProgramAction.stage_id)
        .join(User, User.id == AcceleratorMembership.user_id)
        .join(Project, Project.id == AcceleratorArtifact.project_id)
        .where(AcceleratorMembership.cohort_id == cohort.id)
    )
    if access_role == "tracker":
        allowed_ids = await tracker_membership_ids(db, user.id, cohort.id)
        query = query.where(AcceleratorMembership.id.in_(allowed_ids))
    rows = (await db.execute(query.order_by(AcceleratorArtifact.updated_at.desc()))).all()
    result = []
    for artifact, membership, action, stage, resident, project in rows:
        details_visible = can_view_artifact_details(artifact.visibility, access_role)
        safe_artifact = artifact_dict(artifact, include_private=False)
        if details_visible:
            # Sharing publishes only the resident-authored summary. Canonical
            # chats, research and project tools keep their original ownership.
            safe_artifact["summary"] = artifact.summary
        else:
            safe_artifact["title"] = action.title
        result.append({
            **safe_artifact,
            "resident": {"id": resident.id, "name": resident.name},
            "project": {"id": project.id, "name": project.name},
            "action": {"id": action.id, "title": action.title, "action_type": action.action_type},
            "stage": {"id": stage.id, "title": stage.title},
            "details_visible": details_visible,
        })
    return {"access_role": access_role, "artifacts": result}
