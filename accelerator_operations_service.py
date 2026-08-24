"""Aggregate operations telemetry and runtime module kill switches."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_service import add_audit, require_cohort_manager
from models import (
    Accelerator,
    AcceleratorAlumniProfile,
    AcceleratorApplication,
    AcceleratorArtifact,
    AcceleratorAttendanceRecord,
    AcceleratorCohort,
    AcceleratorCohortClosure,
    AcceleratorDemoDay,
    AcceleratorDemoDayProject,
    AcceleratorEvent,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission,
    AcceleratorMembership,
    AcceleratorModuleRuntimeOverride,
    AcceleratorNotificationOutbox,
    AcceleratorProgramStage,
    AcceleratorProgramStageProgress,
    AcceleratorProgressCheckin,
    AcceleratorProgramConfig,
    AcceleratorQuotaUsageEvent,
    AcceleratorTeam,
    AcceleratorTeamInvitation,
    AcceleratorTeamMember,
    AcceleratorTrackerAssignment,
    User,
)
from schemas.accelerator_operations import RuntimeOverrideUpdate


RUNTIME_MODULES = {
    "homework",
    "attendance",
    "progress_tracking",
    "matchmaking",
    "project_audit",
    "demo_day",
    "pitchy_artifacts",
    "alumni",
}


def scope_key(scope_type: str, scope_id: int | None) -> str:
    if scope_type == "global":
        return "global"
    return f"{scope_type}:{scope_id}"


async def active_runtime_override(
    db: AsyncSession,
    *,
    module_key: str,
    cohort: AcceleratorCohort,
) -> AcceleratorModuleRuntimeOverride | None:
    now = datetime.utcnow()
    keys = ["global", f"accelerator:{cohort.accelerator_id}", f"cohort:{cohort.id}"]
    rows = list((await db.execute(select(AcceleratorModuleRuntimeOverride).where(
        AcceleratorModuleRuntimeOverride.module_key == module_key,
        AcceleratorModuleRuntimeOverride.scope_key.in_(keys),
        or_(
            AcceleratorModuleRuntimeOverride.expires_at.is_(None),
            AcceleratorModuleRuntimeOverride.expires_at > now,
        ),
    ))).scalars().all())
    priority = {"global": 0, f"accelerator:{cohort.accelerator_id}": 1, f"cohort:{cohort.id}": 2}
    return min(rows, key=lambda row: priority.get(row.scope_key, 99)) if rows else None


async def ensure_module_runtime_enabled(
    db: AsyncSession, *, module_key: str, cohort: AcceleratorCohort
) -> None:
    override = await active_runtime_override(
        db, module_key=module_key, cohort=cohort
    )
    if override:
        raise HTTPException(
            status_code=503,
            detail="Функция временно недоступна. Попробуйте позже.",
        )


async def runtime_disabled_modules(
    db: AsyncSession, *, cohort: AcceleratorCohort
) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for module_key in sorted(RUNTIME_MODULES):
        row = await active_runtime_override(
            db, module_key=module_key, cohort=cohort
        )
        if row:
            result[module_key] = {
                "scope_type": row.scope_type,
                "expires_at": row.expires_at,
            }
    return result


async def _group_counts(db: AsyncSession, model, field, *conditions) -> dict[str, int]:
    rows = (await db.execute(
        select(field, func.count()).select_from(model).where(*conditions).group_by(field)
    )).all()
    return {str(key): int(value) for key, value in rows}


async def _count(db: AsyncSession, model, *conditions) -> int:
    return int((await db.execute(
        select(func.count()).select_from(model).where(*conditions)
    )).scalar_one() or 0)


async def cohort_analytics(
    db: AsyncSession, *, cohort: AcceleratorCohort, user: User
) -> dict:
    await require_cohort_manager(db, user, cohort)
    applications = await _group_counts(
        db, AcceleratorApplication, AcceleratorApplication.status,
        AcceleratorApplication.cohort_id == cohort.id,
    )
    residents = await _group_counts(
        db, AcceleratorMembership, AcceleratorMembership.status,
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == "resident",
    )
    published_stages = await _count(
        db, AcceleratorProgramStage,
        AcceleratorProgramStage.cohort_id == cohort.id,
        AcceleratorProgramStage.status == "published",
    )
    program_completions = int((await db.execute(
        select(func.count())
        .select_from(AcceleratorProgramStageProgress)
        .join(AcceleratorProgramStage, AcceleratorProgramStage.id == AcceleratorProgramStageProgress.stage_id)
        .where(AcceleratorProgramStage.cohort_id == cohort.id)
    )).scalar_one() or 0)
    participating = sum(residents.get(status, 0) for status in ("enrolled", "completed"))
    program_denominator = published_stages * participating
    homework = await _group_counts(
        db, AcceleratorHomeworkSubmission, AcceleratorHomeworkSubmission.status,
        AcceleratorHomeworkSubmission.membership_id.in_(
            select(AcceleratorMembership.id).where(AcceleratorMembership.cohort_id == cohort.id)
        ),
    )
    homework_published = await _count(
        db, AcceleratorHomeworkAssignment,
        AcceleratorHomeworkAssignment.cohort_id == cohort.id,
        AcceleratorHomeworkAssignment.status == "published",
    )
    event_count = await _count(
        db, AcceleratorEvent,
        AcceleratorEvent.cohort_id == cohort.id,
        AcceleratorEvent.status == "published",
    )
    present = int((await db.execute(
        select(func.count())
        .select_from(AcceleratorAttendanceRecord)
        .join(AcceleratorEvent, AcceleratorEvent.id == AcceleratorAttendanceRecord.event_id)
        .where(
            AcceleratorEvent.cohort_id == cohort.id,
            AcceleratorAttendanceRecord.status == "present",
        )
    )).scalar_one() or 0)
    quota_rows = (await db.execute(
        select(
            AcceleratorQuotaUsageEvent.resource,
            func.coalesce(func.sum(AcceleratorQuotaUsageEvent.quantity), 0),
        )
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorQuotaUsageEvent.membership_id)
        .where(AcceleratorMembership.cohort_id == cohort.id)
        .group_by(AcceleratorQuotaUsageEvent.resource)
    )).all()
    artifacts = await _group_counts(
        db, AcceleratorArtifact, AcceleratorArtifact.status,
        AcceleratorArtifact.membership_id.in_(
            select(AcceleratorMembership.id).where(AcceleratorMembership.cohort_id == cohort.id)
        ),
    )
    active_teams = await _count(
        db, AcceleratorTeam,
        AcceleratorTeam.cohort_id == cohort.id,
        AcceleratorTeam.status == "active",
    )
    active_team_members = int((await db.execute(
        select(func.count())
        .select_from(AcceleratorTeamMember)
        .join(AcceleratorTeam, AcceleratorTeam.id == AcceleratorTeamMember.team_id)
        .where(
            AcceleratorTeam.cohort_id == cohort.id,
            AcceleratorTeamMember.status == "active",
        )
    )).scalar_one() or 0)
    demo_projects = int((await db.execute(
        select(func.count())
        .select_from(AcceleratorDemoDayProject)
        .join(AcceleratorDemoDay, AcceleratorDemoDay.id == AcceleratorDemoDayProject.demo_day_id)
        .where(AcceleratorDemoDay.cohort_id == cohort.id)
    )).scalar_one() or 0)
    demo_outcomes = dict((await db.execute(
        select(AcceleratorDemoDayProject.outcome, func.count())
        .join(AcceleratorDemoDay, AcceleratorDemoDay.id == AcceleratorDemoDayProject.demo_day_id)
        .where(AcceleratorDemoDay.cohort_id == cohort.id)
        .group_by(AcceleratorDemoDayProject.outcome)
    )).all())
    alumni_active = int((await db.execute(
        select(func.count())
        .select_from(AcceleratorAlumniProfile)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorAlumniProfile.membership_id)
        .where(
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorAlumniProfile.active.is_(True),
        )
    )).scalar_one() or 0)
    return {
        "cohort_id": cohort.id,
        "generated_at": datetime.utcnow(),
        "applications": applications,
        "residents": residents,
        "program": {
            "published_stages": published_stages,
            "completed_stage_records": program_completions,
            "completion_percent": round(program_completions * 100 / program_denominator, 1) if program_denominator else 0,
        },
        "homework": {"published": homework_published, "submissions": homework},
        "attendance": {
            "published_events": event_count,
            "present_records": present,
            "attendance_percent": round(present * 100 / (event_count * participating), 1) if event_count and participating else 0,
        },
        "quota_usage": {str(resource): int(quantity) for resource, quantity in quota_rows},
        "artifacts": artifacts,
        "teams": {
            "active": active_teams,
            "active_members": active_team_members,
            "average_size": round(active_team_members / active_teams, 1) if active_teams else 0,
        },
        "demo_day": {
            "projects": demo_projects,
            "outcomes": {str(key): int(value) for key, value in demo_outcomes.items()},
        },
        "alumni": {"published_profiles": alumni_active},
        "runtime_disabled_modules": await runtime_disabled_modules(db, cohort=cohort),
    }


async def cohort_health(
    db: AsyncSession, *, cohort: AcceleratorCohort, user: User
) -> dict:
    await require_cohort_manager(db, user, cohort)
    now = datetime.utcnow()
    issues: list[dict] = []
    program_config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    configured_modules = (program_config.modules or {}) if program_config else {}

    async def issue(code: str, severity: str, count: int, message: str, action: str):
        if count:
            issues.append({
                "code": code,
                "severity": severity,
                "count": count,
                "message": message,
                "recommended_action": action,
            })

    stale_applications = await _count(
        db, AcceleratorApplication,
        AcceleratorApplication.cohort_id == cohort.id,
        AcceleratorApplication.status.in_(("submitted", "under_review")),
        AcceleratorApplication.submitted_at < now - timedelta(days=7),
    )
    await issue("stale_applications", "warning", stale_applications,
                "Заявки находятся в работе больше 7 дней", "Откройте раздел заявок и зафиксируйте решение")
    accepted_not_enrolled = await _count(
        db, AcceleratorMembership,
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.status == "accepted",
        AcceleratorMembership.accepted_at < now - timedelta(days=7),
    )
    await issue("accepted_not_enrolled", "warning", accepted_not_enrolled,
                "Принятые резиденты не зачислены больше 7 дней", "Проверьте согласия и завершите зачисление")
    unassigned = await _count(
        db, AcceleratorMembership,
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.status == "enrolled",
        ~AcceleratorMembership.id.in_(select(AcceleratorTrackerAssignment.membership_id)),
    ) if configured_modules.get("progress_tracking") else 0
    await issue("unassigned_trackers", "warning", unassigned,
                "У резидентов нет назначенного трекера", "Назначьте трекеров или отключите трекинг для потока")
    stale_checkins = await _count(
        db, AcceleratorMembership,
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.status == "enrolled",
        ~AcceleratorMembership.id.in_(select(AcceleratorProgressCheckin.membership_id).where(
            AcceleratorProgressCheckin.created_at >= now - timedelta(days=14)
        )),
    ) if configured_modules.get("progress_tracking") else 0
    await issue("stale_checkins", "warning", stale_checkins,
                "Нет чек-ина резидента за последние 14 дней", "Свяжитесь с резидентом и обновите прогресс")
    failed_artifacts = await _count(
        db, AcceleratorArtifact,
        AcceleratorArtifact.membership_id.in_(
            select(AcceleratorMembership.id).where(AcceleratorMembership.cohort_id == cohort.id)
        ),
        AcceleratorArtifact.status == "failed",
    ) if configured_modules.get("pitchy_artifacts") else 0
    await issue("failed_artifacts", "error", failed_artifacts,
                "Есть неуспешные действия Pitchy", "Откройте результаты Pitchy и повторите или отвяжите действие")
    stale_artifacts = await _count(
        db, AcceleratorArtifact,
        AcceleratorArtifact.membership_id.in_(
            select(AcceleratorMembership.id).where(AcceleratorMembership.cohort_id == cohort.id)
        ),
        AcceleratorArtifact.status == "started",
        AcceleratorArtifact.updated_at < now - timedelta(hours=24),
    ) if configured_modules.get("pitchy_artifacts") else 0
    await issue("stale_artifacts", "warning", stale_artifacts,
                "Действия Pitchy остаются начатыми больше суток", "Попросите резидента синхронизировать результат")
    failed_notifications = await _count(
        db, AcceleratorNotificationOutbox,
        AcceleratorNotificationOutbox.cohort_id == cohort.id,
        AcceleratorNotificationOutbox.status == "failed",
    )
    await issue("failed_notifications", "error", failed_notifications,
                "Есть уведомления с исчерпанными попытками доставки", "Проверьте канал email и повторите обработку")
    stuck_notifications = await _count(
        db, AcceleratorNotificationOutbox,
        AcceleratorNotificationOutbox.cohort_id == cohort.id,
        AcceleratorNotificationOutbox.status.in_(("pending", "processing")),
        AcceleratorNotificationOutbox.created_at < now - timedelta(minutes=15),
    )
    await issue("stuck_notifications", "error", stuck_notifications,
                "Уведомления не обработаны больше 15 минут", "Проверьте worker уведомлений")
    expired_invites = int((await db.execute(
        select(func.count())
        .select_from(AcceleratorTeamInvitation)
        .join(AcceleratorTeam, AcceleratorTeam.id == AcceleratorTeamInvitation.team_id)
        .where(
            AcceleratorTeam.cohort_id == cohort.id,
            AcceleratorTeamInvitation.status == "pending",
            AcceleratorTeamInvitation.expires_at <= now,
        )
    )).scalar_one() or 0) if configured_modules.get("matchmaking") else 0
    await issue("expired_team_invitations", "warning", expired_invites,
                "Просроченные приглашения в команды ещё не закрыты", "Откройте матчмейкинг для синхронизации приглашений")
    unfinalized_demo = await _count(
        db, AcceleratorDemoDay,
        AcceleratorDemoDay.cohort_id == cohort.id,
        AcceleratorDemoDay.status != "finalized",
    ) if configured_modules.get("demo_day") and cohort.ends_at and cohort.ends_at < now else 0
    await issue("unfinalized_demo_day", "warning", unfinalized_demo,
                "После даты окончания остался незавершённый демо-день", "Финализируйте оценки перед закрытием потока")
    closure = (await db.execute(select(AcceleratorCohortClosure).where(
        AcceleratorCohortClosure.cohort_id == cohort.id
    ))).scalar_one_or_none()
    overdue_closure = int(bool(
        cohort.status == "active" and cohort.ends_at and cohort.ends_at < now
        and (not closure or closure.status != "completed")
    ))
    await issue("overdue_closure", "error", overdue_closure,
                "Дата окончания прошла, но поток не завершён", "Откройте мастер завершения потока")
    disabled = await runtime_disabled_modules(db, cohort=cohort)
    if disabled:
        issues.append({
            "code": "runtime_modules_disabled",
            "severity": "info",
            "count": len(disabled),
            "message": "Часть модулей временно отключена операционным выключателем",
            "recommended_action": "Проверьте причины и срок действия выключателей",
        })
    severity_rank = {"info": 0, "warning": 1, "error": 2}
    top = max((severity_rank[row["severity"]] for row in issues), default=0)
    return {
        "cohort_id": cohort.id,
        "generated_at": now,
        "status": "error" if top == 2 else "warning" if top == 1 else "healthy",
        "issues": issues,
        "summary": {
            "error": sum(1 for row in issues if row["severity"] == "error"),
            "warning": sum(1 for row in issues if row["severity"] == "warning"),
            "info": sum(1 for row in issues if row["severity"] == "info"),
        },
        "runtime_disabled_modules": disabled,
    }


def override_dict(row: AcceleratorModuleRuntimeOverride) -> dict:
    return {
        "id": row.id,
        "scope_type": row.scope_type,
        "scope_id": row.cohort_id if row.scope_type == "cohort" else row.accelerator_id,
        "scope_key": row.scope_key,
        "module_key": row.module_key,
        "reason": row.reason,
        "expires_at": row.expires_at,
        "active": row.expires_at is None or row.expires_at > datetime.utcnow(),
        "updated_by_user_id": row.updated_by_user_id,
        "updated_at": row.updated_at,
    }


async def add_runtime_audit(
    db: AsyncSession,
    *,
    accelerator_id: int | None,
    cohort_id: int | None,
    actor_user_id: int,
    action: str,
    target_id: int | None,
    details: dict,
) -> None:
    accelerator_ids = [accelerator_id] if accelerator_id is not None else list((
        await db.execute(select(Accelerator.id))
    ).scalars().all())
    for current_accelerator_id in accelerator_ids:
        add_audit(
            db,
            accelerator_id=current_accelerator_id,
            cohort_id=cohort_id,
            actor_user_id=actor_user_id,
            action=action,
            target_type="runtime_override",
            target_id=target_id,
            details=details,
        )


async def list_runtime_overrides(db: AsyncSession, *, user: User) -> list[dict]:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Требуются права главного администратора")
    rows = (await db.execute(select(AcceleratorModuleRuntimeOverride).order_by(
        AcceleratorModuleRuntimeOverride.scope_type,
        AcceleratorModuleRuntimeOverride.scope_key,
        AcceleratorModuleRuntimeOverride.module_key,
    ))).scalars().all()
    return [override_dict(row) for row in rows]


async def update_runtime_override(
    db: AsyncSession, *, payload: RuntimeOverrideUpdate, user: User
) -> AcceleratorModuleRuntimeOverride | None:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Требуются права главного администратора")
    if payload.module_key not in RUNTIME_MODULES:
        raise HTTPException(status_code=422, detail="Неизвестный модуль")
    expires_at = payload.expires_at
    if expires_at and expires_at.tzinfo is not None:
        expires_at = expires_at.astimezone(timezone.utc).replace(tzinfo=None)
    if expires_at and expires_at <= datetime.utcnow():
        raise HTTPException(status_code=422, detail="Срок действия должен быть в будущем")
    accelerator_id = None
    cohort_id = None
    if payload.scope_type == "accelerator":
        accelerator = await db.get(Accelerator, payload.scope_id)
        if not accelerator:
            raise HTTPException(status_code=404, detail="Акселератор не найден")
        accelerator_id = accelerator.id
    elif payload.scope_type == "cohort":
        cohort = await db.get(AcceleratorCohort, payload.scope_id)
        if not cohort:
            raise HTTPException(status_code=404, detail="Поток не найден")
        cohort_id = cohort.id
        accelerator_id = cohort.accelerator_id
    key = scope_key(payload.scope_type, payload.scope_id)
    row = (await db.execute(select(AcceleratorModuleRuntimeOverride).where(
        AcceleratorModuleRuntimeOverride.scope_key == key,
        AcceleratorModuleRuntimeOverride.module_key == payload.module_key,
    ).with_for_update())).scalar_one_or_none()
    if not payload.disabled:
        if row:
            await db.delete(row)
        await add_runtime_audit(
            db,
            accelerator_id=accelerator_id,
            cohort_id=cohort_id,
            actor_user_id=user.id,
            action="runtime.module_enabled",
            target_id=row.id if row else None,
            details={"scope_key": key, "module_key": payload.module_key, "reason": payload.reason},
        )
        return None
    if not row:
        row = AcceleratorModuleRuntimeOverride(
            scope_type=payload.scope_type,
            scope_key=key,
            accelerator_id=accelerator_id,
            cohort_id=cohort_id,
            module_key=payload.module_key,
            reason=payload.reason,
            expires_at=expires_at,
            updated_by_user_id=user.id,
        )
        db.add(row)
    else:
        row.reason = payload.reason
        row.expires_at = expires_at
        row.updated_by_user_id = user.id
    await db.flush()
    await add_runtime_audit(
        db,
        accelerator_id=accelerator_id,
        cohort_id=cohort_id,
        actor_user_id=user.id,
        action="runtime.module_disabled",
        target_id=row.id,
        details={
            "scope_key": key,
            "module_key": payload.module_key,
            "reason": payload.reason,
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
    )
    return row
