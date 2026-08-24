"""Transactional cohort closure, immutable snapshots and opt-in alumni."""
from __future__ import annotations

from datetime import date, datetime
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_notification_service import enqueue_notification
from accelerator_service import add_audit, is_accelerator_organizer, require_cohort_manager
from accelerator_team_service import handle_membership_lifecycle_transition
from models import (
    AcceleratorAlumniCheckin,
    AcceleratorAlumniProfile,
    AcceleratorArtifact,
    AcceleratorAttendanceRecord,
    AcceleratorCohort,
    AcceleratorCohortClosure,
    AcceleratorDemoDayProject,
    AcceleratorEvent,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission,
    AcceleratorMembership,
    AcceleratorMembershipClosureDecision,
    AcceleratorMembershipEvent,
    AcceleratorProgramConfig,
    AcceleratorProgramStage,
    AcceleratorProgramStageProgress,
    AcceleratorProgressCheckin,
    AcceleratorQuotaUsageEvent,
    AcceleratorResidentSnapshot,
    AcceleratorTeam,
    AcceleratorTeamMember,
    AcceleratorTrackingTask,
    Project,
    User,
)
from schemas.accelerator_alumni import (
    AlumniCheckinUpsert,
    AlumniProfileUpdate,
    ClosureDecisionUpdate,
)


ELIGIBLE_CLOSURE_STATUSES = {"accepted", "enrolled", "suspended"}


async def get_cohort(db: AsyncSession, cohort_id: int) -> AcceleratorCohort:
    cohort = await db.get(AcceleratorCohort, cohort_id)
    if not cohort:
        raise HTTPException(status_code=404, detail="Поток не найден")
    return cohort


async def require_alumni_module(
    db: AsyncSession, cohort: AcceleratorCohort
) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("alumni"):
        raise HTTPException(
            status_code=409,
            detail="Alumni-модуль не включён для этого потока",
        )
    return config


async def get_closure(
    db: AsyncSession, cohort_id: int, *, lock: bool = False
) -> AcceleratorCohortClosure | None:
    query = select(AcceleratorCohortClosure).where(
        AcceleratorCohortClosure.cohort_id == cohort_id
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


async def prepare_closure(
    db: AsyncSession, *, cohort: AcceleratorCohort, user: User
) -> AcceleratorCohortClosure:
    cohort = (await db.execute(select(AcceleratorCohort).where(
        AcceleratorCohort.id == cohort.id
    ).with_for_update())).scalar_one()
    closure = await get_closure(db, cohort.id, lock=True)
    if closure:
        return closure
    if cohort.status != "active":
        raise HTTPException(
            status_code=409,
            detail="Подготовить завершение можно только для активного потока",
        )
    closure = AcceleratorCohortClosure(
        cohort_id=cohort.id,
        status="preparing",
        created_by_user_id=user.id,
    )
    db.add(closure)
    await db.flush()
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="cohort.closure_prepared",
        target_type="cohort_closure",
        target_id=closure.id,
        details={},
    )
    return closure


async def eligible_memberships(
    db: AsyncSession, cohort_id: int, *, lock: bool = False
) -> list[AcceleratorMembership]:
    query = select(AcceleratorMembership).where(
        AcceleratorMembership.cohort_id == cohort_id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status.in_(ELIGIBLE_CLOSURE_STATUSES),
    ).order_by(AcceleratorMembership.id)
    if lock:
        query = query.with_for_update()
    return list((await db.execute(query)).scalars().all())


async def closure_payload(
    db: AsyncSession, *, cohort: AcceleratorCohort, user: User
) -> dict:
    await require_cohort_manager(db, user, cohort)
    closure = await get_closure(db, cohort.id)
    memberships = await eligible_memberships(db, cohort.id)
    decisions: dict[int, AcceleratorMembershipClosureDecision] = {}
    snapshot_ids: set[int] = set()
    if closure:
        decisions = {
            row.membership_id: row
            for row in (await db.execute(select(AcceleratorMembershipClosureDecision).where(
                AcceleratorMembershipClosureDecision.closure_id == closure.id
            ))).scalars().all()
        }
        snapshot_ids = set((await db.execute(select(
            AcceleratorResidentSnapshot.membership_id
        ).where(AcceleratorResidentSnapshot.closure_id == closure.id))).scalars().all())
        if closure.status == "completed" and decisions:
            memberships = list((await db.execute(select(AcceleratorMembership).where(
                AcceleratorMembership.id.in_(decisions),
                AcceleratorMembership.cohort_id == cohort.id,
                AcceleratorMembership.role == "resident",
            ).order_by(AcceleratorMembership.id))).scalars().all())
    people = {
        row.id: person
        for row, person in (await db.execute(
            select(AcceleratorMembership, User)
            .join(User, User.id == AcceleratorMembership.user_id)
            .where(AcceleratorMembership.id.in_([row.id for row in memberships]))
        )).all()
    } if memberships else {}
    residents = []
    for membership in memberships:
        decision = decisions.get(membership.id)
        person = people.get(membership.id)
        residents.append({
            "membership_id": membership.id,
            "name": person.name if person else "Резидент недоступен",
            "email": person.email if person else None,
            "status": membership.status,
            "project_id": membership.project_id,
            "decision": ({
                "outcome": decision.outcome,
                "reason": decision.reason,
                "updated_at": decision.updated_at,
            } if decision else None),
            "snapshot_ready": membership.id in snapshot_ids,
        })
    missing = [row["membership_id"] for row in residents if not row["decision"]]
    blockers = []
    if cohort.status not in {"active", "completed"}:
        blockers.append("Завершить можно только активный поток")
    if missing:
        blockers.append(f"Не выбрано решение для резидентов: {len(missing)}")
    return {
        "cohort_id": cohort.id,
        "cohort_status": cohort.status,
        "closure": ({
            "id": closure.id,
            "status": closure.status,
            "summary": closure.summary,
            "completed_at": closure.completed_at,
        } if closure else None),
        "residents": residents,
        "missing_decision_membership_ids": missing,
        "blockers": blockers,
        "can_complete": bool(
            closure and closure.status == "preparing" and cohort.status == "active" and not missing
        ),
    }


async def upsert_closure_decision(
    db: AsyncSession,
    *,
    cohort: AcceleratorCohort,
    membership_id: int,
    payload: ClosureDecisionUpdate,
    user: User,
) -> AcceleratorMembershipClosureDecision:
    await require_cohort_manager(db, user, cohort)
    closure = await prepare_closure(db, cohort=cohort, user=user)
    if closure.status != "preparing":
        raise HTTPException(status_code=409, detail="Завершение потока уже зафиксировано")
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == membership_id,
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == "resident",
    ).with_for_update())).scalar_one_or_none()
    if not membership or membership.status not in ELIGIBLE_CLOSURE_STATUSES:
        raise HTTPException(status_code=404, detail="Активный резидент не найден")
    if payload.outcome == "completed" and membership.status == "accepted":
        raise HTTPException(
            status_code=409,
            detail="Незачисленного участника можно только вывести из потока",
        )
    decision = (await db.execute(select(AcceleratorMembershipClosureDecision).where(
        AcceleratorMembershipClosureDecision.closure_id == closure.id,
        AcceleratorMembershipClosureDecision.membership_id == membership.id,
    ).with_for_update())).scalar_one_or_none()
    if not decision:
        decision = AcceleratorMembershipClosureDecision(
            closure_id=closure.id,
            membership_id=membership.id,
            outcome=payload.outcome,
            reason=payload.reason,
            decided_by_user_id=user.id,
        )
        db.add(decision)
    else:
        decision.outcome = payload.outcome
        decision.reason = payload.reason
        decision.decided_by_user_id = user.id
    await db.flush()
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="cohort.closure_decision_updated",
        target_type="membership",
        target_id=membership.id,
        details={"outcome": decision.outcome, "reason": decision.reason},
    )
    return decision


async def _count(db: AsyncSession, model, *conditions) -> int:
    return int((await db.execute(
        select(func.count()).select_from(model).where(*conditions)
    )).scalar_one() or 0)


async def build_snapshot_payload(
    db: AsyncSession,
    *,
    membership: AcceleratorMembership,
    cohort: AcceleratorCohort,
    decision: AcceleratorMembershipClosureDecision,
) -> dict:
    project = await db.get(Project, membership.project_id) if membership.project_id else None
    published_stages = await _count(
        db, AcceleratorProgramStage,
        AcceleratorProgramStage.cohort_id == cohort.id,
        AcceleratorProgramStage.status == "published",
    )
    completed_stages = await _count(
        db, AcceleratorProgramStageProgress,
        AcceleratorProgramStageProgress.membership_id == membership.id,
    )
    published_homework = await _count(
        db, AcceleratorHomeworkAssignment,
        AcceleratorHomeworkAssignment.cohort_id == cohort.id,
        AcceleratorHomeworkAssignment.status == "published",
    )
    accepted_homework = await _count(
        db, AcceleratorHomeworkSubmission,
        AcceleratorHomeworkSubmission.membership_id == membership.id,
        AcceleratorHomeworkSubmission.status == "accepted",
    )
    published_events = await _count(
        db, AcceleratorEvent,
        AcceleratorEvent.cohort_id == cohort.id,
        AcceleratorEvent.status == "published",
    )
    attended_events = await _count(
        db, AcceleratorAttendanceRecord,
        AcceleratorAttendanceRecord.membership_id == membership.id,
        AcceleratorAttendanceRecord.status == "present",
    )
    artifacts_total = await _count(
        db, AcceleratorArtifact,
        AcceleratorArtifact.membership_id == membership.id,
    )
    artifacts_ready = await _count(
        db, AcceleratorArtifact,
        AcceleratorArtifact.membership_id == membership.id,
        AcceleratorArtifact.status == "ready",
    )
    tracking_total = await _count(
        db, AcceleratorTrackingTask,
        AcceleratorTrackingTask.membership_id == membership.id,
    )
    tracking_done = await _count(
        db, AcceleratorTrackingTask,
        AcceleratorTrackingTask.membership_id == membership.id,
        AcceleratorTrackingTask.status == "done",
    )
    checkins = await _count(
        db, AcceleratorProgressCheckin,
        AcceleratorProgressCheckin.membership_id == membership.id,
    )
    quota_rows = (await db.execute(
        select(
            AcceleratorQuotaUsageEvent.resource,
            func.coalesce(func.sum(AcceleratorQuotaUsageEvent.quantity), 0),
        ).where(
            AcceleratorQuotaUsageEvent.membership_id == membership.id
        ).group_by(AcceleratorQuotaUsageEvent.resource)
    )).all()
    demo = (await db.execute(select(AcceleratorDemoDayProject).where(
        AcceleratorDemoDayProject.membership_id == membership.id
    ).order_by(AcceleratorDemoDayProject.updated_at.desc()).limit(1))).scalar_one_or_none()
    team_row = (await db.execute(
        select(AcceleratorTeamMember, AcceleratorTeam)
        .join(AcceleratorTeam, AcceleratorTeam.id == AcceleratorTeamMember.team_id)
        .where(AcceleratorTeamMember.membership_id == membership.id)
        .order_by(AcceleratorTeamMember.created_at.desc())
        .limit(1)
    )).first()
    return {
        "schema_version": 1,
        "captured_at": datetime.utcnow().isoformat(),
        "cohort": {"id": cohort.id, "name": cohort.name},
        "membership": {
            "id": membership.id,
            "status_before_closure": membership.status,
            "enrolled_at": membership.enrolled_at.isoformat() if membership.enrolled_at else None,
            "outcome": decision.outcome,
            "outcome_reason": decision.reason,
        },
        "project": ({
            "id": project.id,
            "name": project.name,
            "readiness_index": project.readiness_index,
            "status": project.status,
        } if project else None),
        "program": {"published": published_stages, "completed": completed_stages},
        "homework": {"published": published_homework, "accepted": accepted_homework},
        "attendance": {"published_events": published_events, "present": attended_events},
        "tracking": {"tasks": tracking_total, "done": tracking_done, "checkins": checkins},
        "artifacts": {"total": artifacts_total, "ready": artifacts_ready},
        "quota_usage": {resource: int(quantity) for resource, quantity in quota_rows},
        "demo_day": ({
            "outcome": demo.outcome,
            "final_score": float(demo.final_score) if demo.final_score is not None else None,
            "rank": demo.rank,
        } if demo else None),
        "team": ({
            "id": team_row[1].id,
            "name": team_row[1].name,
            "role": team_row[0].role,
            "member_status": team_row[0].status,
        } if team_row else None),
    }


async def complete_closure(
    db: AsyncSession,
    *,
    cohort: AcceleratorCohort,
    user: User,
    summary: str | None,
) -> tuple[AcceleratorCohortClosure, list[int]]:
    await require_cohort_manager(db, user, cohort)
    cohort = (await db.execute(select(AcceleratorCohort).where(
        AcceleratorCohort.id == cohort.id
    ).with_for_update())).scalar_one()
    closure = await get_closure(db, cohort.id, lock=True)
    if closure and closure.status == "completed":
        return closure, []
    if not closure:
        raise HTTPException(status_code=409, detail="Сначала подготовьте решения по резидентам")
    if cohort.status != "active" or closure.status != "preparing":
        raise HTTPException(status_code=409, detail="Поток нельзя завершить в текущем состоянии")
    memberships = await eligible_memberships(db, cohort.id, lock=True)
    decisions = list((await db.execute(select(AcceleratorMembershipClosureDecision).where(
        AcceleratorMembershipClosureDecision.closure_id == closure.id
    ).with_for_update())).scalars().all())
    decision_map = {row.membership_id: row for row in decisions}
    missing = [row.id for row in memberships if row.id not in decision_map]
    if missing:
        raise HTTPException(
            status_code=409,
            detail=f"Не выбрано итоговое решение для резидентов: {len(missing)}",
        )
    now = datetime.utcnow()
    notification_ids: list[int] = []
    for membership in memberships:
        decision = decision_map[membership.id]
        existing_snapshot = (await db.execute(select(AcceleratorResidentSnapshot.id).where(
            AcceleratorResidentSnapshot.closure_id == closure.id,
            AcceleratorResidentSnapshot.membership_id == membership.id,
        ))).scalar_one_or_none()
        if existing_snapshot is None:
            snapshot_payload = await build_snapshot_payload(
                db, membership=membership, cohort=cohort, decision=decision
            )
            canonical = json.dumps(
                snapshot_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            db.add(AcceleratorResidentSnapshot(
                closure_id=closure.id,
                membership_id=membership.id,
                project_id=membership.project_id,
                payload=snapshot_payload,
                checksum=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            ))
        previous = membership.status
        target = decision.outcome
        if target == "withdrawn":
            notification_ids.extend(await handle_membership_lifecycle_transition(
                db,
                membership=membership,
                to_status="withdrawn",
                actor_user_id=user.id,
                reason=decision.reason,
            ))
        membership.status = target
        membership.status_reason = decision.reason
        membership.status_changed_by_user_id = user.id
        membership.ended_at = now
        membership.suspended_at = None
        db.add(AcceleratorMembershipEvent(
            membership_id=membership.id,
            from_status=previous,
            to_status=target,
            actor_user_id=user.id,
            reason=decision.reason,
        ))
        person = await db.get(User, membership.user_id)
        if person:
            event = await enqueue_notification(
                db,
                accelerator_id=cohort.accelerator_id,
                cohort_id=cohort.id,
                recipient_user_id=person.id,
                recipient_email=person.email,
                event_type="cohort_completed",
                subject=f"Поток «{cohort.name}» завершён",
                body=(
                    "Ваш результат зафиксирован. "
                    + ("Вы можете по желанию заполнить alumni-профиль." if target == "completed" else "Участие закрыто организатором.")
                ),
                action_url="/accelerator",
                membership_id=membership.id,
                event_metadata={"closure_id": closure.id, "outcome": target},
                idempotency_key=f"cohort-completed:{closure.id}:{membership.id}",
            )
            notification_ids.append(event.id)
    closure.status = "completed"
    closure.summary = (summary or "").strip() or None
    closure.completed_by_user_id = user.id
    closure.completed_at = now
    cohort.status = "completed"
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="cohort.closure_completed",
        target_type="cohort_closure",
        target_id=closure.id,
        details={
            "completed": sum(1 for row in decisions if row.outcome == "completed"),
            "withdrawn": sum(1 for row in decisions if row.outcome == "withdrawn"),
        },
    )
    await db.flush()
    return closure, notification_ids


async def membership_context(
    db: AsyncSession, membership_id: int
) -> tuple[AcceleratorMembership, AcceleratorCohort, User]:
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident":
        raise HTTPException(status_code=404, detail="Участие не найдено")
    cohort = await get_cohort(db, membership.cohort_id)
    person = await db.get(User, membership.user_id)
    if not person:
        raise HTTPException(status_code=404, detail="Резидент не найден")
    return membership, cohort, person


async def alumni_read_role(
    db: AsyncSession,
    *,
    membership: AcceleratorMembership,
    cohort: AcceleratorCohort,
    user: User,
) -> str:
    if membership.user_id == user.id:
        return "resident"
    if user.is_admin or await is_accelerator_organizer(db, user.id, cohort.accelerator_id):
        return "manager"
    raise HTTPException(status_code=403, detail="Нет доступа к alumni-профилю")


def alumni_profile_dict(
    profile: AcceleratorAlumniProfile | None,
    *,
    membership: AcceleratorMembership,
    person: User,
    project: Project | None,
) -> dict:
    return {
        "membership_id": membership.id,
        "name": person.name,
        "project": ({"id": project.id, "name": project.name} if project else None),
        "active": bool(profile and profile.active),
        "headline": profile.headline if profile and profile.active else None,
        "bio": profile.bio if profile and profile.active else None,
        "achievements": (profile.achievements or []) if profile and profile.active else [],
        "expertise": (profile.expertise or []) if profile and profile.active else [],
        "interests": (profile.interests or []) if profile and profile.active else [],
        "contact_url": profile.contact_url if profile and profile.active else None,
        "consented_at": profile.consented_at if profile and profile.active else None,
        "updated_at": profile.updated_at if profile else None,
    }


async def get_alumni_profile_payload(
    db: AsyncSession, *, membership_id: int, user: User
) -> dict:
    membership, cohort, person = await membership_context(db, membership_id)
    await require_alumni_module(db, cohort)
    await alumni_read_role(db, membership=membership, cohort=cohort, user=user)
    profile = (await db.execute(select(AcceleratorAlumniProfile).where(
        AcceleratorAlumniProfile.membership_id == membership.id
    ))).scalar_one_or_none()
    project = await db.get(Project, membership.project_id) if membership.project_id else None
    return alumni_profile_dict(profile, membership=membership, person=person, project=project)


async def upsert_alumni_profile(
    db: AsyncSession,
    *,
    membership_id: int,
    payload: AlumniProfileUpdate,
    user: User,
) -> AcceleratorAlumniProfile:
    membership, cohort, _ = await membership_context(db, membership_id)
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == membership.id
    ).with_for_update())).scalar_one()
    await require_alumni_module(db, cohort)
    if membership.user_id != user.id:
        raise HTTPException(status_code=403, detail="Профиль заполняет только сам выпускник")
    if membership.status != "completed" or cohort.status != "completed":
        raise HTTPException(status_code=409, detail="Alumni-профиль доступен после завершения потока")
    if not payload.accept_directory_terms:
        raise HTTPException(status_code=422, detail="Нужно явно согласиться на публикацию профиля")
    if payload.contact_url and not payload.contact_url.lower().startswith(("https://", "mailto:")):
        raise HTTPException(status_code=422, detail="Контакт должен быть безопасной ссылкой")
    profile = (await db.execute(select(AcceleratorAlumniProfile).where(
        AcceleratorAlumniProfile.membership_id == membership.id
    ).with_for_update())).scalar_one_or_none()
    now = datetime.utcnow()
    if not profile:
        profile = AcceleratorAlumniProfile(
            membership_id=membership.id,
            active=True,
            consented_at=now,
        )
        db.add(profile)
    profile.active = True
    profile.headline = payload.headline
    profile.bio = payload.bio
    profile.achievements = payload.achievements
    profile.expertise = payload.expertise
    profile.interests = payload.interests
    profile.contact_url = payload.contact_url
    profile.consented_at = now
    profile.opted_out_at = None
    await db.flush()
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="alumni.profile_published",
        target_type="alumni_profile",
        target_id=profile.id,
        details={"membership_id": membership.id},
    )
    return profile


async def opt_out_alumni_profile(
    db: AsyncSession, *, membership_id: int, user: User
) -> AcceleratorAlumniProfile | None:
    membership, cohort, _ = await membership_context(db, membership_id)
    await require_alumni_module(db, cohort)
    if membership.user_id != user.id:
        raise HTTPException(status_code=403, detail="Отключить профиль может только выпускник")
    profile = (await db.execute(select(AcceleratorAlumniProfile).where(
        AcceleratorAlumniProfile.membership_id == membership.id
    ).with_for_update())).scalar_one_or_none()
    if not profile:
        return None
    profile.active = False
    profile.headline = None
    profile.bio = None
    profile.achievements = []
    profile.expertise = []
    profile.interests = []
    profile.contact_url = None
    profile.opted_out_at = datetime.utcnow()
    await db.execute(delete(AcceleratorAlumniCheckin).where(
        AcceleratorAlumniCheckin.profile_id == profile.id
    ))
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="alumni.profile_opted_out",
        target_type="alumni_profile",
        target_id=profile.id,
        details={"membership_id": membership.id},
    )
    return profile


async def cohort_alumni_payload(
    db: AsyncSession, *, cohort_id: int, user: User
) -> dict:
    cohort = await get_cohort(db, cohort_id)
    await require_alumni_module(db, cohort)
    manager = user.is_admin or await is_accelerator_organizer(
        db, user.id, cohort.accelerator_id
    )
    own_membership = (await db.execute(select(AcceleratorMembership.id).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "completed",
    ))).scalar_one_or_none()
    if not manager and own_membership is None:
        raise HTTPException(status_code=403, detail="Каталог доступен выпускникам потока")
    rows = (await db.execute(
        select(AcceleratorAlumniProfile, AcceleratorMembership, User, Project)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorAlumniProfile.membership_id)
        .join(User, User.id == AcceleratorMembership.user_id)
        .outerjoin(Project, Project.id == AcceleratorMembership.project_id)
        .where(
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorMembership.status == "completed",
            AcceleratorAlumniProfile.active.is_(True),
        )
        .order_by(User.name, AcceleratorAlumniProfile.id)
    )).all()
    return {
        "cohort_id": cohort.id,
        "profiles": [
            alumni_profile_dict(profile, membership=membership, person=person, project=project)
            for profile, membership, person, project in rows
        ],
    }


async def upsert_alumni_checkin(
    db: AsyncSession,
    *,
    membership_id: int,
    payload: AlumniCheckinUpsert,
    user: User,
) -> AcceleratorAlumniCheckin:
    membership, cohort, _ = await membership_context(db, membership_id)
    await require_alumni_module(db, cohort)
    if membership.user_id != user.id or membership.status != "completed":
        raise HTTPException(status_code=403, detail="Отметка доступна только выпускнику")
    if payload.period_date > date.today():
        raise HTTPException(status_code=422, detail="Дата обновления не может быть в будущем")
    profile = (await db.execute(select(AcceleratorAlumniProfile).where(
        AcceleratorAlumniProfile.membership_id == membership.id,
        AcceleratorAlumniProfile.active.is_(True),
    ).with_for_update())).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=409, detail="Сначала опубликуйте alumni-профиль")
    checkin = (await db.execute(select(AcceleratorAlumniCheckin).where(
        AcceleratorAlumniCheckin.profile_id == profile.id,
        AcceleratorAlumniCheckin.period_date == payload.period_date,
    ).with_for_update())).scalar_one_or_none()
    if not checkin:
        checkin = AcceleratorAlumniCheckin(
            profile_id=profile.id,
            author_user_id=user.id,
            period_date=payload.period_date,
            summary=payload.summary,
            metrics=payload.metrics,
        )
        db.add(checkin)
    else:
        checkin.summary = payload.summary
        checkin.metrics = payload.metrics
    await db.flush()
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="alumni.checkin_saved",
        target_type="alumni_checkin",
        target_id=checkin.id,
        details={"membership_id": membership.id, "period_date": str(payload.period_date)},
    )
    return checkin


async def alumni_checkins_payload(
    db: AsyncSession, *, membership_id: int, user: User
) -> dict:
    membership, cohort, _ = await membership_context(db, membership_id)
    await require_alumni_module(db, cohort)
    await alumni_read_role(db, membership=membership, cohort=cohort, user=user)
    profile = (await db.execute(select(AcceleratorAlumniProfile).where(
        AcceleratorAlumniProfile.membership_id == membership.id,
        AcceleratorAlumniProfile.active.is_(True),
    ))).scalar_one_or_none()
    if not profile:
        return {"membership_id": membership.id, "checkins": []}
    rows = (await db.execute(select(AcceleratorAlumniCheckin).where(
        AcceleratorAlumniCheckin.profile_id == profile.id
    ).order_by(AcceleratorAlumniCheckin.period_date.desc()))).scalars().all()
    return {
        "membership_id": membership.id,
        "checkins": [{
            "id": row.id,
            "period_date": row.period_date,
            "summary": row.summary,
            "metrics": row.metrics or {},
            "updated_at": row.updated_at,
        } for row in rows],
    }


async def resident_snapshot_payload(
    db: AsyncSession, *, membership_id: int, user: User
) -> dict:
    membership, cohort, _ = await membership_context(db, membership_id)
    await alumni_read_role(db, membership=membership, cohort=cohort, user=user)
    row = (await db.execute(select(AcceleratorResidentSnapshot).where(
        AcceleratorResidentSnapshot.membership_id == membership.id
    ).order_by(AcceleratorResidentSnapshot.created_at.desc()).limit(1))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Итоговый снимок ещё не создан")
    return {
        "id": row.id,
        "membership_id": row.membership_id,
        "checksum": row.checksum,
        "payload": row.payload,
        "created_at": row.created_at,
    }
