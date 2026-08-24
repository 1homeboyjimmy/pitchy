from __future__ import annotations

from datetime import date, datetime, timedelta
import csv
import hashlib
import io
import json
import logging
import os
import re
import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_service import (
    add_audit,
    accelerator_membership_quota_snapshot,
    accelerator_quota_snapshot,
    assign_quota_override,
    consume_accelerator_membership_quota,
    has_active_personal_override,
    is_accelerator_organizer,
    normalize_resident_limits,
    require_cohort_manager,
    require_cohort_reader,
    require_tracker_membership_access,
    tracker_membership_ids,
)
from accelerator_project_audit_service import generate_project_audit
from accelerator_application_service import (
    MANAGER_TRANSITIONS,
    accept_invitation,
    approve_application,
    record_application_event,
    transition_application,
)
from accelerator_notification_service import enqueue_notification, process_notification_event
from auth import get_async_current_user, require_async_admin
from db_async import get_async_db
from models import (
    Accelerator,
    AcceleratorApplication,
    AcceleratorApplicationEvent,
    AcceleratorAuditLog,
    AcceleratorAttendanceRecord,
    AcceleratorCohort,
    AcceleratorDemoDay,
    AcceleratorDemoDayExpert,
    AcceleratorDemoDayProject,
    AcceleratorDemoDayScore,
    AcceleratorEvent,
    AcceleratorInvitation,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission,
    AcceleratorHomeworkTarget,
    AcceleratorMembership,
    AcceleratorMembershipEvent,
    AcceleratorMatch,
    AcceleratorMatchProfile,
    AcceleratorOrganization,
    AcceleratorProgramConfig,
    AcceleratorProgramMaterial,
    AcceleratorProgramMaterialProgress,
    AcceleratorProgramStage,
    AcceleratorProgramStageProgress,
    AcceleratorProgressCheckin,
    AcceleratorProjectAudit,
    AcceleratorProjectAuditTaskLink,
    AcceleratorQuotaUsageEvent,
    AcceleratorResidentQuotaOverride,
    AcceleratorStaff,
    AcceleratorTrackingFeedback,
    AcceleratorTrackingTask,
    AcceleratorTrackerAssignment,
    Project,
    User,
)
from schemas.accelerators import (
    AcceleratorCreate,
    AcceleratorSetupCreate,
    AcceleratorUpdate,
    ApplicationRevisionUpdate,
    ApplicationCreate,
    ApplicationReview,
    ApplicationStatusUpdate,
    CohortCreate,
    CohortUpdate,
    CohortQuotaAssign,
    InvitationAccept,
    HomeworkAssignmentCreate,
    HomeworkReview,
    HomeworkSubmissionUpsert,
    AttendanceMark,
    EventCreate,
    OrganizationCreate,
    OrganizerAssign,
    TrackerAssign,
    TrackerAssignmentsUpdate,
    ProgramConfigUpdate,
    ProgramStageCreate,
    ProgramStageReorder,
    PublicApplicationCreate,
    ResidentQuotaAssign,
    StatusUpdate,
    MembershipStatusUpdate,
    ProgressCheckinUpsert,
    TrackingFeedbackCreate,
    TrackingTaskCreate,
    TrackingTaskUpdate,
    ProjectAuditCreate,
    ProjectAuditTaskCreate,
    DemoDayCreate,
    DemoDayExpertAssign,
    DemoDayMaterialsUpdate,
    DemoDayProjectDecision,
    DemoDayProjectSelect,
    DemoDayScoreUpsert,
    DemoDayStatusUpdate,
    MatchProfileData,
    MatchPoolProfileCreate,
    MatchCreate,
    MatchStatusUpdate,
)


router = APIRouter(prefix="/api/accelerators", tags=["accelerators"])
logger = logging.getLogger("app.accelerator_project_audit")

DEFAULT_MODULES = {
    "applications": True,
    "program": True,
    "homework": False,
    "attendance": False,
    "progress_tracking": False,
    "matchmaking": False,
    "project_audit": False,
    "demo_day": False,
}
LOCKED_BASE_MODULES = {"applications": True, "program": True}
COHORT_STATUS_TRANSITIONS = {
    "draft": {"accepting", "archived"},
    "accepting": {"draft", "active", "archived"},
    "active": {"completed", "archived"},
    "completed": {"archived"},
    "archived": set(),
}
MEMBERSHIP_STATUS_TRANSITIONS = {
    "accepted": {"enrolled", "withdrawn"},
    "enrolled": {"suspended", "completed", "withdrawn"},
    "suspended": {"enrolled", "withdrawn"},
    "completed": set(),
    "withdrawn": set(),
}


def require_global_admin_user(user: User) -> None:
    """Defense in depth for business operations reserved for Pitchy admins."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Требуются права главного администратора")


def accelerator_dict(row: Accelerator) -> dict:
    return {
        "id": row.id,
        "organization_id": row.organization_id,
        "name": row.name,
        "organization": row.organization,
        "description": row.description,
        "status": row.status,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def cohort_dict(row: AcceleratorCohort) -> dict:
    return {
        "id": row.id,
        "accelerator_id": row.accelerator_id,
        "name": row.name,
        "status": row.status,
        "timezone": row.timezone,
        "starts_at": row.starts_at,
        "ends_at": row.ends_at,
        "application_form_schema": row.application_form_schema or {},
        "default_quota_config": row.default_quota_config,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def application_dict(row: AcceleratorApplication) -> dict:
    return {
        "id": row.id,
        "cohort_id": row.cohort_id,
        "user_id": row.user_id,
        "project_id": row.project_id,
        "applicant_name": row.applicant_name,
        "applicant_email": row.applicant_email,
        "application_type": row.application_type,
        "status": row.status,
        "form_payload": row.form_payload or {},
        "reviewed_by_user_id": row.reviewed_by_user_id,
        "review_comment": row.review_comment,
        "submitted_at": row.submitted_at,
        "reviewed_at": row.reviewed_at,
        "privacy_consent_at": row.privacy_consent_at,
        "program_rules_consent_at": row.program_rules_consent_at,
    }


async def require_homework_module(db: AsyncSession, cohort: AcceleratorCohort) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("homework"):
        raise HTTPException(status_code=409, detail="Модуль домашних заданий не включён для этого потока")
    return config


async def require_attendance_module(db: AsyncSession, cohort: AcceleratorCohort) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("attendance"):
        raise HTTPException(status_code=409, detail="Модуль посещаемости не включён для этого потока")
    return config


async def require_progress_tracking_module(
    db: AsyncSession, cohort: AcceleratorCohort
) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("progress_tracking"):
        raise HTTPException(status_code=409, detail="Модуль трекинга прогресса не включён для этого потока")
    return config


async def require_project_audit_module(
    db: AsyncSession, cohort: AcceleratorCohort
) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("project_audit"):
        raise HTTPException(status_code=409, detail="Модуль аудита проекта не включён для этого потока")
    return config


async def require_demo_day_module(
    db: AsyncSession, cohort: AcceleratorCohort
) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("demo_day"):
        raise HTTPException(status_code=409, detail="Модуль демо-дня не включён для этого потока")
    return config


async def require_matchmaking_module(
    db: AsyncSession, cohort: AcceleratorCohort
) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("matchmaking"):
        raise HTTPException(status_code=409, detail="Модуль матчмейкинга не включён для этого потока")
    return config


async def get_resident_membership(
    db: AsyncSession, membership_id: int, user: User, *, enrolled: bool = True
) -> AcceleratorMembership:
    membership = await db.get(AcceleratorMembership, membership_id)
    if (
        not membership
        or membership.user_id != user.id
        or membership.role != "resident"
        or (enrolled and membership.status != "enrolled")
    ):
        raise HTTPException(status_code=404, detail="Участие не найдено")
    return membership


def program_material_dict(row: AcceleratorProgramMaterial, completed_ids: set[int] | None = None) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "kind": row.kind,
        "url": row.url,
        "content": row.content,
        "position": row.position,
        "required": row.required,
        "completed": row.id in completed_ids if completed_ids is not None else False,
    }


async def stage_materials(db: AsyncSession, stage_id: int) -> list[AcceleratorProgramMaterial]:
    return list((await db.execute(select(AcceleratorProgramMaterial).where(
        AcceleratorProgramMaterial.stage_id == stage_id
    ).order_by(AcceleratorProgramMaterial.position))).scalars().all())


async def ensure_stage_for_cohort(
    db: AsyncSession, stage_id: int | None, cohort_id: int
) -> AcceleratorProgramStage | None:
    if stage_id is None:
        return None
    stage = await db.get(AcceleratorProgramStage, stage_id)
    if not stage or stage.cohort_id != cohort_id:
        raise HTTPException(status_code=422, detail="Этап программы не относится к этому потоку")
    return stage


async def get_homework_assignment_or_404(db: AsyncSession, assignment_id: int) -> AcceleratorHomeworkAssignment:
    assignment = await db.get(AcceleratorHomeworkAssignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Домашнее задание не найдено")
    return assignment


async def validate_homework_targets(
    db: AsyncSession, cohort_id: int, membership_ids: list[int]
) -> list[AcceleratorMembership]:
    if not membership_ids:
        return []
    rows = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id.in_(membership_ids),
        AcceleratorMembership.cohort_id == cohort_id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalars().all()
    if {row.id for row in rows} != set(membership_ids):
        raise HTTPException(status_code=422, detail="Часть выбранных резидентов не зачислена в этот поток")
    return rows


async def homework_recipients(
    db: AsyncSession, assignment: AcceleratorHomeworkAssignment
) -> list[tuple[AcceleratorMembership, User]]:
    query = (
        select(AcceleratorMembership, User)
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(
            AcceleratorMembership.cohort_id == assignment.cohort_id,
            AcceleratorMembership.role == "resident",
            AcceleratorMembership.status == "enrolled",
            User.deleted_at.is_(None),
            User.is_active.is_(True),
        )
    )
    if assignment.audience == "selected":
        target_ids = select(AcceleratorHomeworkTarget.membership_id).where(
            AcceleratorHomeworkTarget.assignment_id == assignment.id
        )
        query = query.where(AcceleratorMembership.id.in_(target_ids))
    return list((await db.execute(query.order_by(AcceleratorMembership.id))).all())


def homework_submission_dict(row: AcceleratorHomeworkSubmission, *, resident: User | None = None) -> dict:
    return {
        "id": row.id,
        "assignment_id": row.assignment_id,
        "membership_id": row.membership_id,
        "resident": ({"id": resident.id, "name": resident.name, "email": resident.email} if resident else None),
        "answer_text": row.answer_text,
        "attachments": row.attachments or [],
        "status": row.status,
        "attempt_count": row.attempt_count,
        "submitted_at": row.submitted_at,
        "reviewed_by_user_id": row.reviewed_by_user_id,
        "review_comment": row.review_comment,
        "reviewed_at": row.reviewed_at,
        "is_late": False,
    }


async def get_accelerator_or_404(db: AsyncSession, accelerator_id: int) -> Accelerator:
    row = await db.get(Accelerator, accelerator_id)
    if not row:
        raise HTTPException(status_code=404, detail="Акселератор не найден")
    return row


async def get_cohort_or_404(db: AsyncSession, cohort_id: int) -> AcceleratorCohort:
    row = await db.get(AcceleratorCohort, cohort_id)
    if not row:
        raise HTTPException(status_code=404, detail="Поток не найден")
    return row


def validate_application_form(schema: dict, payload: dict, application_type: str = "project") -> None:
    if not isinstance(payload, dict) or not payload:
        raise HTTPException(status_code=422, detail="Заявка должна содержать заполненную форму")
    required = set(schema.get("required") or []) if isinstance(schema, dict) else set()
    fields = schema.get("fields") or [] if isinstance(schema, dict) else []
    hidden_keys: set[str] = set()
    for field in fields:
        if not isinstance(field, dict) or not field.get("key"):
            continue
        application_types = field.get("application_types")
        if application_types and application_type not in application_types:
            hidden_keys.add(field["key"])
            continue
        if field.get("required"):
            required.add(field["key"])
    required -= hidden_keys
    missing = [key for key in sorted(required) if payload.get(key) in (None, "", [])]
    if missing:
        raise HTTPException(status_code=422, detail=f"Не заполнены обязательные поля: {', '.join(missing)}")


def setup_slug(name: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return (value or "organization")[:90]


@router.post("/organizations")
async def create_organization(
    payload: OrganizationCreate,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    slug = payload.slug.strip().lower()
    existing = (await db.execute(select(AcceleratorOrganization.id).where(
        AcceleratorOrganization.slug == slug
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Организация с таким идентификатором уже существует")
    organization = AcceleratorOrganization(
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
        created_by_user_id=admin.id,
    )
    db.add(organization)
    await db.commit()
    await db.refresh(organization)
    return {
        "id": organization.id,
        "name": organization.name,
        "slug": organization.slug,
        "description": organization.description,
        "status": organization.status,
    }


@router.get("/organizations")
async def list_organizations(
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    rows = (await db.execute(
        select(AcceleratorOrganization).order_by(AcceleratorOrganization.name)
    )).scalars().all()
    return [{
        "id": row.id,
        "name": row.name,
        "slug": row.slug,
        "description": row.description,
        "status": row.status,
    } for row in rows]


@router.post("/setup")
async def setup_accelerator(
    payload: AcceleratorSetupCreate,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """Atomically creates the minimum usable accelerator foundation."""
    unknown_modules = set(payload.modules) - set(DEFAULT_MODULES)
    if unknown_modules:
        raise HTTPException(
            status_code=422,
            detail=f"Недоступные модули: {', '.join(sorted(unknown_modules))}",
        )
    if payload.organization_id:
        organization = await db.get(AcceleratorOrganization, payload.organization_id)
        if not organization or organization.status != "active":
            raise HTTPException(status_code=404, detail="Активная организация не найдена")
    else:
        base_slug = setup_slug(payload.organization_name or "organization")
        slug = base_slug
        suffix = 1
        while (await db.execute(select(AcceleratorOrganization.id).where(
            AcceleratorOrganization.slug == slug
        ))).scalar_one_or_none():
            suffix += 1
            slug = f"{base_slug[:110]}-{suffix}"
        organization = AcceleratorOrganization(
            name=(payload.organization_name or "").strip(),
            slug=slug,
            description=payload.organization_description,
            created_by_user_id=admin.id,
        )
        db.add(organization)
        await db.flush()

    accelerator = Accelerator(
        organization_id=organization.id,
        name=payload.accelerator_name.strip(),
        organization=organization.name,
        description=payload.accelerator_description,
        created_by_user_id=admin.id,
    )
    db.add(accelerator)
    await db.flush()
    cohort = AcceleratorCohort(
        accelerator_id=accelerator.id,
        name=payload.cohort_name.strip(),
        timezone=payload.timezone.strip(),
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        application_form_schema=payload.application_form_schema,
        default_quota_config=payload.default_quota_config,
        default_quota_updated_by_user_id=admin.id if payload.default_quota_config else None,
        created_by_user_id=admin.id,
    )
    db.add(cohort)
    await db.flush()
    modules = {**DEFAULT_MODULES, **payload.modules}
    db.add(AcceleratorProgramConfig(
        cohort_id=cohort.id,
        version=1,
        modules=modules,
        locked_modules=LOCKED_BASE_MODULES.copy(),
        updated_by_user_id=admin.id,
    ))
    add_audit(
        db,
        accelerator_id=accelerator.id,
        cohort_id=cohort.id,
        actor_user_id=admin.id,
        action="accelerator.setup_completed",
        target_type="accelerator",
        target_id=accelerator.id,
        details={"organization_id": organization.id, "modules": modules},
    )
    await db.commit()
    await db.refresh(accelerator)
    await db.refresh(cohort)
    return {
        "accelerator": {**accelerator_dict(accelerator), "access_role": "global_admin"},
        "cohort": cohort_dict(cohort),
        "organization": {
            "id": organization.id,
            "name": organization.name,
            "slug": organization.slug,
        },
    }
@router.post("")
async def create_accelerator(
    payload: AcceleratorCreate,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    row = Accelerator(
        organization_id=payload.organization_id,
        name=payload.name.strip(),
        organization=payload.organization.strip() if payload.organization else None,
        description=payload.description,
        created_by_user_id=admin.id,
    )
    if payload.organization_id:
        organization = await db.get(AcceleratorOrganization, payload.organization_id)
        if not organization or organization.status != "active":
            raise HTTPException(status_code=404, detail="Активная организация не найдена")
    db.add(row)
    await db.flush()
    add_audit(
        db,
        accelerator_id=row.id,
        actor_user_id=admin.id,
        action="accelerator.created",
        target_type="accelerator",
        target_id=row.id,
    )
    await db.commit()
    await db.refresh(row)
    return accelerator_dict(row)


@router.get("")
async def list_accelerators(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    if user.is_admin:
        rows = (await db.execute(select(Accelerator).order_by(Accelerator.created_at.desc()))).scalars().all()
        access_roles = {row.id: "global_admin" for row in rows}
    else:
        staff_rows = (await db.execute(
            select(AcceleratorStaff.accelerator_id, AcceleratorStaff.role).where(
                AcceleratorStaff.user_id == user.id,
                AcceleratorStaff.role == "organizer",
            )
        )).all()
        tracker_accelerator_ids = set((await db.execute(
            select(AcceleratorCohort.accelerator_id)
            .join(
                AcceleratorMembership,
                AcceleratorMembership.cohort_id == AcceleratorCohort.id,
            )
            .join(
                AcceleratorTrackerAssignment,
                AcceleratorTrackerAssignment.membership_id == AcceleratorMembership.id,
            )
            .where(AcceleratorTrackerAssignment.tracker_user_id == user.id)
        )).scalars().all())
        resident_rows = (await db.execute(
            select(AcceleratorCohort.accelerator_id)
            .join(AcceleratorMembership, AcceleratorMembership.cohort_id == AcceleratorCohort.id)
            .where(AcceleratorMembership.user_id == user.id)
        )).scalars().all()
        expert_accelerator_ids = set((await db.execute(
            select(AcceleratorCohort.accelerator_id)
            .join(AcceleratorMatch, AcceleratorMatch.cohort_id == AcceleratorCohort.id)
            .join(AcceleratorMatchProfile, AcceleratorMatchProfile.id == AcceleratorMatch.counterpart_profile_id)
            .where(
                AcceleratorMatch.status == "active",
                AcceleratorMatchProfile.user_id == user.id,
                AcceleratorMatchProfile.role == "expert",
            )
        )).scalars().all())
        expert_accelerator_ids.update((await db.execute(
            select(AcceleratorCohort.accelerator_id)
            .join(AcceleratorDemoDay, AcceleratorDemoDay.cohort_id == AcceleratorCohort.id)
            .join(
                AcceleratorDemoDayExpert,
                AcceleratorDemoDayExpert.demo_day_id == AcceleratorDemoDay.id,
            )
            .where(AcceleratorDemoDayExpert.user_id == user.id)
        )).scalars().all())
        staff_roles = {accelerator_id: role for accelerator_id, role in staff_rows}
        for tracker_accelerator_id in tracker_accelerator_ids:
            staff_roles.setdefault(tracker_accelerator_id, "tracker")
        for expert_accelerator_id in expert_accelerator_ids:
            staff_roles.setdefault(expert_accelerator_id, "expert")
        staff_ids = set(staff_roles)
        resident_ids = set(resident_rows)
        access_roles = {
            accelerator_id: staff_roles.get(accelerator_id, "resident")
            for accelerator_id in staff_ids | resident_ids
        }
        rows = (await db.execute(
            select(Accelerator)
            .where(Accelerator.id.in_(access_roles))
            .order_by(Accelerator.created_at.desc())
        )).scalars().all()
    return [{**accelerator_dict(row), "access_role": access_roles[row.id]} for row in rows]


@router.patch("/{accelerator_id}")
async def update_accelerator(
    accelerator_id: int,
    payload: AcceleratorUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    accelerator = await get_accelerator_or_404(db, accelerator_id)
    if not user.is_admin and not await is_accelerator_organizer(db, user.id, accelerator_id):
        raise HTTPException(status_code=403, detail="Нет прав на настройку акселератора")
    if payload.name is not None:
        accelerator.name = payload.name.strip()
    if "description" in payload.model_fields_set:
        accelerator.description = payload.description
    add_audit(
        db,
        accelerator_id=accelerator.id,
        actor_user_id=user.id,
        action="accelerator.updated",
        target_type="accelerator",
        target_id=accelerator.id,
        details={"updated_fields": sorted(payload.model_fields_set)},
    )
    await db.commit()
    await db.refresh(accelerator)
    return accelerator_dict(accelerator)


@router.get("/me/memberships")
async def list_my_accelerator_memberships(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Resident-only projection; never exposes other participants or applications."""
    rows = (await db.execute(
        select(
            AcceleratorMembership,
            AcceleratorCohort,
            Accelerator,
            AcceleratorProgramConfig,
            Project,
        )
        .join(AcceleratorCohort, AcceleratorCohort.id == AcceleratorMembership.cohort_id)
        .join(Accelerator, Accelerator.id == AcceleratorCohort.accelerator_id)
        .join(AcceleratorProgramConfig, AcceleratorProgramConfig.cohort_id == AcceleratorCohort.id)
        .outerjoin(Project, Project.id == AcceleratorMembership.project_id)
        .where(
            AcceleratorMembership.user_id == user.id,
            AcceleratorMembership.role == "resident",
        )
        .order_by(AcceleratorMembership.created_at.desc())
    )).all()
    memberships = []
    for membership, cohort, accelerator, program, project in rows:
        memberships.append({
            "membership_id": membership.id,
            "application_id": membership.application_id,
            "status": membership.status,
            "accepted_at": membership.accepted_at,
            "enrolled_at": membership.enrolled_at,
            "ended_at": membership.ended_at,
            "accelerator": {
                "id": accelerator.id,
                "name": accelerator.name,
                "description": accelerator.description,
                "status": accelerator.status,
            },
            "cohort": {
                "id": cohort.id,
                "name": cohort.name,
                "status": cohort.status,
                "timezone": cohort.timezone,
                "starts_at": cohort.starts_at,
                "ends_at": cohort.ends_at,
            },
            "project": ({
                "id": project.id,
                "name": project.name,
                "readiness_index": project.readiness_index,
                "status": project.status,
            } if project else None),
            # Program contents become available only after explicit enrollment.
            "modules": program.modules if membership.status == "enrolled" else {},
        })
    effective_quotas = {}
    for resource in ("messages", "roadmaps", "custdev", "grants"):
        snapshot = await accelerator_quota_snapshot(db, user.id, resource)
        if snapshot:
            effective_quotas[resource] = {
                "membership_id": snapshot["membership"].id,
                "limit": snapshot["limit"],
                "used": snapshot["used"],
                "remaining": snapshot["remaining"],
                "source": snapshot["override"].source,
                "starts_at": snapshot["override"].starts_at,
                "ends_at": snapshot["override"].ends_at,
            }
    return {"memberships": memberships, "effective_quotas": effective_quotas}


@router.post("/{accelerator_id}/organizers")
async def assign_organizer(
    accelerator_id: int,
    payload: OrganizerAssign,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    accelerator = await get_accelerator_or_404(db, accelerator_id)
    organizer = await db.get(User, payload.user_id)
    if not organizer or organizer.deleted_at is not None or not organizer.is_active:
        raise HTTPException(status_code=404, detail="Активный пользователь не найден")
    existing = (await db.execute(select(AcceleratorStaff).where(
        AcceleratorStaff.accelerator_id == accelerator_id,
        AcceleratorStaff.user_id == payload.user_id,
    ))).scalar_one_or_none()
    if existing:
        return {
            "id": existing.id, "accelerator_id": accelerator_id, "user_id": payload.user_id,
            "name": organizer.name, "email": organizer.email, "role": existing.role,
        }
    staff = AcceleratorStaff(
        accelerator_id=accelerator_id,
        user_id=payload.user_id,
        role="organizer",
        created_by_user_id=admin.id,
    )
    db.add(staff)
    await db.flush()
    add_audit(
        db,
        accelerator_id=accelerator.id,
        actor_user_id=admin.id,
        action="organizer.assigned",
        target_type="user",
        target_id=payload.user_id,
    )
    await db.commit()
    return {
        "id": staff.id, "accelerator_id": accelerator_id, "user_id": payload.user_id,
        "name": organizer.name, "email": organizer.email, "role": staff.role,
    }


@router.get("/{accelerator_id}/organizers")
async def list_organizers(
    accelerator_id: int,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    await get_accelerator_or_404(db, accelerator_id)
    rows = (await db.execute(
        select(AcceleratorStaff, User)
        .join(User, User.id == AcceleratorStaff.user_id)
        .where(AcceleratorStaff.accelerator_id == accelerator_id)
        .order_by(User.name, User.email)
    )).all()
    return [{
        "id": staff.id,
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "role": staff.role,
        "created_at": staff.created_at,
    } for staff, user in rows]


@router.get("/{accelerator_id}/organizer-candidates")
async def search_organizer_candidates(
    accelerator_id: int,
    q: str = Query(min_length=2, max_length=200),
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    await get_accelerator_or_404(db, accelerator_id)
    search = f"%{q.strip()}%"
    assigned_ids = select(AcceleratorStaff.user_id).where(
        AcceleratorStaff.accelerator_id == accelerator_id
    )
    rows = (await db.execute(
        select(User)
        .where(
            User.is_active.is_(True),
            User.deleted_at.is_(None),
            User.id.not_in(assigned_ids),
            or_(User.name.ilike(search), User.email.ilike(search)),
        )
        .order_by(User.name, User.email)
        .limit(20)
    )).scalars().all()
    return [{"id": row.id, "name": row.name, "email": row.email} for row in rows]


@router.delete("/{accelerator_id}/organizers/{user_id}", status_code=204)
async def remove_organizer(
    accelerator_id: int,
    user_id: int,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    await get_accelerator_or_404(db, accelerator_id)
    staff = (await db.execute(select(AcceleratorStaff).where(
        AcceleratorStaff.accelerator_id == accelerator_id,
        AcceleratorStaff.user_id == user_id,
    ))).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Организатор не найден")
    await db.delete(staff)
    add_audit(
        db,
        accelerator_id=accelerator_id,
        actor_user_id=admin.id,
        action="organizer.removed",
        target_type="user",
        target_id=user_id,
    )
    await db.commit()
    return Response(status_code=204)


async def validate_tracker_memberships(
    db: AsyncSession, cohort_id: int, membership_ids: list[int]
) -> list[AcceleratorMembership]:
    if not membership_ids:
        return []
    rows = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id.in_(membership_ids),
        AcceleratorMembership.cohort_id == cohort_id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status.in_(("enrolled", "suspended")),
    ))).scalars().all()
    if {row.id for row in rows} != set(membership_ids):
        raise HTTPException(
            status_code=422,
            detail="Трекеру можно назначить только зачисленных или приостановленных резидентов этого потока",
        )
    return list(rows)


async def replace_tracker_assignments(
    db: AsyncSession,
    *,
    cohort: AcceleratorCohort,
    tracker_user_id: int,
    membership_ids: list[int],
    actor_user_id: int,
) -> None:
    await validate_tracker_memberships(db, cohort.id, membership_ids)
    cohort_membership_ids = select(AcceleratorMembership.id).where(
        AcceleratorMembership.cohort_id == cohort.id
    )
    await db.execute(delete(AcceleratorTrackerAssignment).where(
        AcceleratorTrackerAssignment.tracker_user_id == tracker_user_id,
        AcceleratorTrackerAssignment.membership_id.in_(cohort_membership_ids),
    ))
    for membership_id in membership_ids:
        db.add(AcceleratorTrackerAssignment(
            tracker_user_id=tracker_user_id,
            membership_id=membership_id,
            assigned_by_user_id=actor_user_id,
        ))


async def remove_tracker_staff_if_unused(
    db: AsyncSession, *, accelerator_id: int, tracker_user_id: int
) -> None:
    await db.flush()
    remaining = (await db.execute(
        select(AcceleratorTrackerAssignment.id)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorTrackerAssignment.membership_id,
        )
        .join(AcceleratorCohort, AcceleratorCohort.id == AcceleratorMembership.cohort_id)
        .where(
            AcceleratorTrackerAssignment.tracker_user_id == tracker_user_id,
            AcceleratorCohort.accelerator_id == accelerator_id,
        )
        .limit(1)
    )).scalar_one_or_none()
    if remaining is not None:
        return
    staff = (await db.execute(select(AcceleratorStaff).where(
        AcceleratorStaff.accelerator_id == accelerator_id,
        AcceleratorStaff.user_id == tracker_user_id,
        AcceleratorStaff.role == "tracker",
    ))).scalar_one_or_none()
    if staff:
        await db.delete(staff)


@router.get("/cohorts/{cohort_id}/trackers")
async def list_trackers(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    rows = (await db.execute(
        select(AcceleratorStaff, User)
        .join(User, User.id == AcceleratorStaff.user_id)
        .join(
            AcceleratorTrackerAssignment,
            AcceleratorTrackerAssignment.tracker_user_id == AcceleratorStaff.user_id,
        )
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorTrackerAssignment.membership_id,
        )
        .where(
            AcceleratorStaff.accelerator_id == cohort.accelerator_id,
            AcceleratorStaff.role == "tracker",
            AcceleratorMembership.cohort_id == cohort.id,
        )
        .distinct()
        .order_by(User.name, User.email)
    )).all()
    result = []
    for staff, tracker in rows:
        membership_ids = list((await db.execute(
            select(AcceleratorTrackerAssignment.membership_id)
            .join(
                AcceleratorMembership,
                AcceleratorMembership.id == AcceleratorTrackerAssignment.membership_id,
            )
            .where(
                AcceleratorTrackerAssignment.tracker_user_id == tracker.id,
                AcceleratorMembership.cohort_id == cohort.id,
            )
            .order_by(AcceleratorTrackerAssignment.membership_id)
        )).scalars().all())
        result.append({
            "staff_id": staff.id,
            "user_id": tracker.id,
            "name": tracker.name,
            "email": tracker.email,
            "membership_ids": membership_ids,
        })
    return result


@router.get("/cohorts/{cohort_id}/tracker-candidates")
async def search_tracker_candidates(
    cohort_id: int,
    q: str = Query(min_length=2, max_length=200),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    search = f"%{q.strip()}%"
    organizer_ids = select(AcceleratorStaff.user_id).where(
        AcceleratorStaff.accelerator_id == cohort.accelerator_id,
        AcceleratorStaff.role == "organizer",
    )
    assigned_here_ids = (
        select(AcceleratorTrackerAssignment.tracker_user_id)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorTrackerAssignment.membership_id,
        )
        .where(AcceleratorMembership.cohort_id == cohort.id)
    )
    rows = (await db.execute(select(User).where(
        User.is_active.is_(True),
        User.is_admin.is_(False),
        User.deleted_at.is_(None),
        User.id.not_in(organizer_ids),
        User.id.not_in(assigned_here_ids),
        or_(User.name.ilike(search), User.email.ilike(search)),
    ).order_by(User.name, User.email).limit(20))).scalars().all()
    return [{"id": row.id, "name": row.name, "email": row.email} for row in rows]


@router.post("/cohorts/{cohort_id}/trackers")
async def assign_tracker(
    cohort_id: int,
    payload: TrackerAssign,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    if not payload.membership_ids:
        raise HTTPException(status_code=422, detail="Выберите хотя бы одного резидента")
    tracker = await db.get(User, payload.user_id)
    if not tracker or not tracker.is_active or tracker.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Активный пользователь не найден")
    staff = (await db.execute(select(AcceleratorStaff).where(
        AcceleratorStaff.accelerator_id == cohort.accelerator_id,
        AcceleratorStaff.user_id == tracker.id,
    ))).scalar_one_or_none()
    if staff and staff.role != "tracker":
        raise HTTPException(status_code=409, detail="Пользователь уже назначен организатором")
    if not staff:
        staff = AcceleratorStaff(
            accelerator_id=cohort.accelerator_id,
            user_id=tracker.id,
            role="tracker",
            created_by_user_id=user.id,
        )
        db.add(staff)
        await db.flush()
    await replace_tracker_assignments(
        db,
        cohort=cohort,
        tracker_user_id=tracker.id,
        membership_ids=payload.membership_ids,
        actor_user_id=user.id,
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="tracker.assigned", target_type="user",
        target_id=tracker.id, details={"membership_ids": payload.membership_ids},
    )
    await db.commit()
    return {
        "staff_id": staff.id, "user_id": tracker.id, "name": tracker.name,
        "email": tracker.email, "membership_ids": payload.membership_ids,
    }


@router.put("/cohorts/{cohort_id}/trackers/{tracker_user_id}")
async def update_tracker_assignments(
    cohort_id: int,
    tracker_user_id: int,
    payload: TrackerAssignmentsUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    staff = (await db.execute(select(AcceleratorStaff).where(
        AcceleratorStaff.accelerator_id == cohort.accelerator_id,
        AcceleratorStaff.user_id == tracker_user_id,
        AcceleratorStaff.role == "tracker",
    ))).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=404, detail="Трекер не найден")
    await replace_tracker_assignments(
        db,
        cohort=cohort,
        tracker_user_id=tracker_user_id,
        membership_ids=payload.membership_ids,
        actor_user_id=user.id,
    )
    await remove_tracker_staff_if_unused(
        db,
        accelerator_id=cohort.accelerator_id,
        tracker_user_id=tracker_user_id,
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="tracker.assignments_updated", target_type="user",
        target_id=tracker_user_id, details={"membership_ids": payload.membership_ids},
    )
    await db.commit()
    return {"user_id": tracker_user_id, "membership_ids": payload.membership_ids}


@router.delete("/cohorts/{cohort_id}/trackers/{tracker_user_id}", status_code=204)
async def remove_tracker(
    cohort_id: int,
    tracker_user_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    cohort_membership_ids = select(AcceleratorMembership.id).where(
        AcceleratorMembership.cohort_id == cohort.id
    )
    result = await db.execute(delete(AcceleratorTrackerAssignment).where(
        AcceleratorTrackerAssignment.tracker_user_id == tracker_user_id,
        AcceleratorTrackerAssignment.membership_id.in_(cohort_membership_ids),
    ))
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Назначения трекера не найдены")
    await remove_tracker_staff_if_unused(
        db,
        accelerator_id=cohort.accelerator_id,
        tracker_user_id=tracker_user_id,
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="tracker.removed", target_type="user",
        target_id=tracker_user_id,
    )
    await db.commit()
    return Response(status_code=204)


@router.post("/{accelerator_id}/cohorts")
async def create_cohort(
    accelerator_id: int,
    payload: CohortCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    accelerator = await get_accelerator_or_404(db, accelerator_id)
    if not user.is_admin and not await is_accelerator_organizer(db, user.id, accelerator_id):
        raise HTTPException(status_code=403, detail="Нет прав на создание потока")
    if payload.ends_at and payload.starts_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="Дата окончания потока должна быть позже даты начала")
    cohort = AcceleratorCohort(
        accelerator_id=accelerator.id,
        name=payload.name.strip(),
        timezone=payload.timezone,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        application_form_schema=payload.application_form_schema,
        created_by_user_id=user.id,
    )
    db.add(cohort)
    await db.flush()
    db.add(AcceleratorProgramConfig(
        cohort_id=cohort.id,
        version=1,
        modules=DEFAULT_MODULES.copy(),
        locked_modules=LOCKED_BASE_MODULES.copy(),
        updated_by_user_id=user.id,
    ))
    add_audit(
        db,
        accelerator_id=accelerator.id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="cohort.created",
        target_type="cohort",
        target_id=cohort.id,
    )
    await db.commit()
    await db.refresh(cohort)
    return cohort_dict(cohort)


@router.get("/{accelerator_id}/cohorts")
async def list_cohorts(
    accelerator_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    await get_accelerator_or_404(db, accelerator_id)
    cohort_query = select(AcceleratorCohort).where(AcceleratorCohort.accelerator_id == accelerator_id)
    if not user.is_admin and not await is_accelerator_organizer(db, user.id, accelerator_id):
        tracker_cohort_ids = set((await db.execute(
            select(AcceleratorMembership.cohort_id)
            .join(
                AcceleratorTrackerAssignment,
                AcceleratorTrackerAssignment.membership_id == AcceleratorMembership.id,
            )
            .where(AcceleratorTrackerAssignment.tracker_user_id == user.id)
        )).scalars().all())
        expert_cohort_ids = set((await db.execute(
            select(AcceleratorMatch.cohort_id)
            .join(AcceleratorMatchProfile, AcceleratorMatchProfile.id == AcceleratorMatch.counterpart_profile_id)
            .where(
                AcceleratorMatchProfile.user_id == user.id,
                AcceleratorMatchProfile.role == "expert",
                AcceleratorMatch.status == "active",
            )
        )).scalars().all())
        expert_cohort_ids.update((await db.execute(
            select(AcceleratorDemoDay.cohort_id)
            .join(
                AcceleratorDemoDayExpert,
                AcceleratorDemoDayExpert.demo_day_id == AcceleratorDemoDay.id,
            )
            .where(AcceleratorDemoDayExpert.user_id == user.id)
        )).scalars().all())
        staff_cohort_ids = tracker_cohort_ids | expert_cohort_ids
        if staff_cohort_ids:
            cohort_query = cohort_query.where(AcceleratorCohort.id.in_(staff_cohort_ids))
            rows = (await db.execute(
                cohort_query.order_by(AcceleratorCohort.created_at.desc())
            )).scalars().all()
            return [cohort_dict(row) for row in rows]
        resident_cohort_ids = select(AcceleratorMembership.cohort_id).where(
            AcceleratorMembership.user_id == user.id,
            AcceleratorMembership.role == "resident",
        )
        has_membership = (await db.execute(
            select(AcceleratorMembership.id)
            .join(AcceleratorCohort, AcceleratorCohort.id == AcceleratorMembership.cohort_id)
            .where(
                AcceleratorCohort.accelerator_id == accelerator_id,
                AcceleratorMembership.user_id == user.id,
                AcceleratorMembership.role == "resident",
            )
            .limit(1)
        )).scalar_one_or_none()
        if has_membership is None:
            raise HTTPException(status_code=403, detail="Нет доступа к акселератору")
        cohort_query = cohort_query.where(AcceleratorCohort.id.in_(resident_cohort_ids))
    rows = (await db.execute(
        cohort_query.order_by(AcceleratorCohort.created_at.desc())
    )).scalars().all()
    return [cohort_dict(row) for row in rows]


@router.patch("/cohorts/{cohort_id}/status")
async def update_cohort_status(
    cohort_id: int,
    payload: StatusUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    previous = cohort.status
    if payload.status == previous:
        return cohort_dict(cohort)
    allowed = COHORT_STATUS_TRANSITIONS.get(previous, set())
    if payload.status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Нельзя перевести поток из статуса «{previous}» в «{payload.status}»",
        )
    cohort.status = payload.status
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="cohort.status_changed",
        target_type="cohort",
        target_id=cohort.id,
        details={"from": previous, "to": payload.status},
    )
    await db.commit()
    await db.refresh(cohort)
    return cohort_dict(cohort)


@router.patch("/cohorts/{cohort_id}")
async def update_cohort(
    cohort_id: int,
    payload: CohortUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    if payload.name is not None:
        cohort.name = payload.name.strip()
    if payload.timezone is not None:
        cohort.timezone = payload.timezone.strip()
    if "starts_at" in payload.model_fields_set:
        cohort.starts_at = payload.starts_at
    if "ends_at" in payload.model_fields_set:
        cohort.ends_at = payload.ends_at
    if cohort.starts_at and cohort.ends_at and cohort.ends_at <= cohort.starts_at:
        raise HTTPException(status_code=422, detail="Дата окончания потока должна быть позже даты начала")
    if payload.application_form_schema is not None:
        cohort.application_form_schema = payload.application_form_schema
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="cohort.updated",
        target_type="cohort",
        target_id=cohort.id,
        details={"updated_fields": sorted(payload.model_fields_set)},
    )
    await db.commit()
    await db.refresh(cohort)
    return cohort_dict(cohort)


@router.get("/cohorts/{cohort_id}/program-config")
async def get_program_config(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    if not user.is_admin and not await is_accelerator_organizer(db, user.id, cohort.accelerator_id):
        tracker_access = bool(await tracker_membership_ids(db, user.id, cohort.id))
        expert_access = (await db.execute(
            select(AcceleratorMatch.id)
            .join(AcceleratorMatchProfile, AcceleratorMatchProfile.id == AcceleratorMatch.counterpart_profile_id)
            .where(
                AcceleratorMatch.cohort_id == cohort.id,
                AcceleratorMatch.status == "active",
                AcceleratorMatchProfile.user_id == user.id,
                AcceleratorMatchProfile.role == "expert",
            )
            .limit(1)
        )).scalar_one_or_none() is not None
        if not expert_access:
            expert_access = (await db.execute(
                select(AcceleratorDemoDayExpert.id)
                .join(
                    AcceleratorDemoDay,
                    AcceleratorDemoDay.id == AcceleratorDemoDayExpert.demo_day_id,
                )
                .where(
                    AcceleratorDemoDay.cohort_id == cohort.id,
                    AcceleratorDemoDayExpert.user_id == user.id,
                )
                .limit(1)
            )).scalar_one_or_none() is not None
        member = (await db.execute(select(AcceleratorMembership.id).where(
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorMembership.user_id == user.id,
            AcceleratorMembership.status == "enrolled",
        ))).scalar_one_or_none()
        if member is None and not tracker_access and not expert_access:
            raise HTTPException(status_code=403, detail="Нет доступа к потоку")
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one()
    modules = {key: bool((config.modules or {}).get(key, default)) for key, default in DEFAULT_MODULES.items()}
    locked = {key: value for key, value in (config.locked_modules or {}).items() if key in DEFAULT_MODULES}
    return {"cohort_id": cohort.id, "version": config.version, "modules": modules, "locked_modules": locked}


@router.patch("/cohorts/{cohort_id}/program-config")
async def update_program_config(
    cohort_id: int,
    payload: ProgramConfigUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    config = (await db.execute(
        select(AcceleratorProgramConfig)
        .where(AcceleratorProgramConfig.cohort_id == cohort.id)
        .with_for_update()
    )).scalar_one()
    if payload.version != config.version:
        raise HTTPException(status_code=409, detail="Настройки уже изменились; обновите страницу")
    unknown = set(payload.modules) - set(DEFAULT_MODULES)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Неизвестные модули: {', '.join(sorted(unknown))}")
    next_modules = {
        key: payload.modules.get(key, bool((config.modules or {}).get(key, default)))
        for key, default in DEFAULT_MODULES.items()
    }
    for key, required_value in (config.locked_modules or {}).items():
        if next_modules.get(key) != required_value:
            raise HTTPException(status_code=409, detail=f"Модуль {key} зафиксирован главным администратором")
    previous = config.modules or {}
    config.modules = next_modules
    config.version += 1
    config.updated_by_user_id = user.id
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="program_config.updated",
        target_type="program_config",
        target_id=config.id,
        details={"from": previous, "to": next_modules, "version": config.version},
    )
    await db.commit()
    return {"cohort_id": cohort.id, "version": config.version, "modules": config.modules, "locked_modules": config.locked_modules}


async def manager_stage_dict(db: AsyncSession, stage: AcceleratorProgramStage) -> dict:
    materials = await stage_materials(db, stage.id)
    homework_ids = list((await db.execute(select(AcceleratorHomeworkAssignment.id).where(
        AcceleratorHomeworkAssignment.stage_id == stage.id
    ))).scalars().all())
    return {
        "id": stage.id,
        "cohort_id": stage.cohort_id,
        "title": stage.title,
        "description": stage.description,
        "position": stage.position,
        "unlock_at": stage.unlock_at,
        "required": stage.required,
        "status": stage.status,
        "published_at": stage.published_at,
        "materials": [program_material_dict(row) for row in materials],
        "homework_assignment_ids": homework_ids,
    }


async def resident_program_rows(
    db: AsyncSession, membership: AcceleratorMembership
) -> list[dict]:
    stages = list((await db.execute(select(AcceleratorProgramStage).where(
        AcceleratorProgramStage.cohort_id == membership.cohort_id,
        AcceleratorProgramStage.status == "published",
    ).order_by(AcceleratorProgramStage.position))).scalars().all())
    completed_stage_ids = set((await db.execute(select(AcceleratorProgramStageProgress.stage_id).where(
        AcceleratorProgramStageProgress.membership_id == membership.id
    ))).scalars().all())
    completed_material_ids = set((await db.execute(select(AcceleratorProgramMaterialProgress.material_id).where(
        AcceleratorProgramMaterialProgress.membership_id == membership.id
    ))).scalars().all())
    now = datetime.utcnow()
    blocked_by_previous = False
    result = []
    for stage in stages:
        locked = blocked_by_previous or bool(stage.unlock_at and stage.unlock_at > now)
        completed = stage.id in completed_stage_ids
        materials = await stage_materials(db, stage.id)
        result.append({
            "id": stage.id,
            "title": stage.title,
            "description": stage.description,
            "position": stage.position,
            "unlock_at": stage.unlock_at,
            "required": stage.required,
            "state": "completed" if completed else "locked" if locked else "available",
            "materials": [] if locked else [
                program_material_dict(row, completed_material_ids) for row in materials
            ],
        })
        if stage.required and not completed:
            blocked_by_previous = True
    return result


@router.get("/cohorts/{cohort_id}/program-stages")
async def list_program_stages(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    rows = (await db.execute(select(AcceleratorProgramStage).where(
        AcceleratorProgramStage.cohort_id == cohort.id,
        AcceleratorProgramStage.status != "archived",
    ).order_by(AcceleratorProgramStage.position))).scalars().all()
    return [await manager_stage_dict(db, row) for row in rows]


@router.post("/cohorts/{cohort_id}/program-stages")
async def create_program_stage(
    cohort_id: int,
    payload: ProgramStageCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    max_position = (await db.execute(select(func.max(AcceleratorProgramStage.position)).where(
        AcceleratorProgramStage.cohort_id == cohort.id
    ))).scalar_one()
    stage = AcceleratorProgramStage(
        cohort_id=cohort.id,
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        position=(max_position or 0) + 1,
        unlock_at=payload.unlock_at,
        required=payload.required,
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
    )
    db.add(stage)
    await db.flush()
    for position, material in enumerate(payload.materials, start=1):
        db.add(AcceleratorProgramMaterial(
            stage_id=stage.id,
            title=material.title.strip(),
            kind=material.kind,
            url=(material.url or "").strip() or None,
            content=(material.content or "").strip() or None,
            position=position,
            required=material.required,
        ))
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="program_stage.created",
              target_type="program_stage", target_id=stage.id)
    await db.commit()
    return await manager_stage_dict(db, stage)


@router.put("/program-stages/{stage_id}")
async def update_program_stage(
    stage_id: int,
    payload: ProgramStageCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    stage = (await db.execute(select(AcceleratorProgramStage).where(
        AcceleratorProgramStage.id == stage_id
    ).with_for_update())).scalar_one_or_none()
    if not stage:
        raise HTTPException(status_code=404, detail="Этап программы не найден")
    cohort = await get_cohort_or_404(db, stage.cohort_id)
    await require_cohort_manager(db, user, cohort)
    if stage.status != "draft":
        raise HTTPException(status_code=409, detail="Опубликованный этап нельзя менять")
    stage.title = payload.title.strip()
    stage.description = (payload.description or "").strip() or None
    stage.unlock_at = payload.unlock_at
    stage.required = payload.required
    stage.updated_by_user_id = user.id
    await db.execute(delete(AcceleratorProgramMaterial).where(
        AcceleratorProgramMaterial.stage_id == stage.id
    ))
    for position, material in enumerate(payload.materials, start=1):
        db.add(AcceleratorProgramMaterial(
            stage_id=stage.id, title=material.title.strip(), kind=material.kind,
            url=(material.url or "").strip() or None,
            content=(material.content or "").strip() or None,
            position=position, required=material.required,
        ))
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="program_stage.updated",
              target_type="program_stage", target_id=stage.id)
    await db.commit()
    return await manager_stage_dict(db, stage)


@router.post("/program-stages/{stage_id}/publish")
async def publish_program_stage(
    stage_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    stage = await db.get(AcceleratorProgramStage, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Этап программы не найден")
    cohort = await get_cohort_or_404(db, stage.cohort_id)
    await require_cohort_manager(db, user, cohort)
    if stage.status != "draft":
        raise HTTPException(status_code=409, detail="Этап уже опубликован")
    stage.status = "published"
    stage.published_at = datetime.utcnow()
    stage.updated_by_user_id = user.id
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="program_stage.published",
              target_type="program_stage", target_id=stage.id)
    await db.commit()
    return await manager_stage_dict(db, stage)


@router.post("/program-stages/{stage_id}/duplicate")
async def duplicate_program_stage(
    stage_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    source = await db.get(AcceleratorProgramStage, stage_id)
    if not source:
        raise HTTPException(status_code=404, detail="Этап программы не найден")
    cohort = await get_cohort_or_404(db, source.cohort_id)
    await require_cohort_manager(db, user, cohort)
    max_position = (await db.execute(select(func.max(AcceleratorProgramStage.position)).where(
        AcceleratorProgramStage.cohort_id == cohort.id
    ))).scalar_one() or 0
    duplicate = AcceleratorProgramStage(
        cohort_id=cohort.id, title=f"{source.title} — копия", description=source.description,
        position=max_position + 1, unlock_at=source.unlock_at, required=source.required,
        created_by_user_id=user.id, updated_by_user_id=user.id,
    )
    db.add(duplicate)
    await db.flush()
    for material in await stage_materials(db, source.id):
        db.add(AcceleratorProgramMaterial(
            stage_id=duplicate.id, title=material.title, kind=material.kind, url=material.url,
            content=material.content, position=material.position, required=material.required,
        ))
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="program_stage.duplicated",
              target_type="program_stage", target_id=duplicate.id, details={"source_id": source.id})
    await db.commit()
    return await manager_stage_dict(db, duplicate)


@router.post("/program-stages/{stage_id}/archive")
async def archive_program_stage(
    stage_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    stage = await db.get(AcceleratorProgramStage, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Этап программы не найден")
    cohort = await get_cohort_or_404(db, stage.cohort_id)
    await require_cohort_manager(db, user, cohort)
    if stage.status == "archived":
        raise HTTPException(status_code=409, detail="Этап уже в архиве")
    stage.status = "archived"
    stage.position = -stage.id
    stage.updated_by_user_id = user.id
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="program_stage.archived",
              target_type="program_stage", target_id=stage.id)
    await db.commit()
    return await manager_stage_dict(db, stage)


@router.put("/cohorts/{cohort_id}/program-stages/reorder")
async def reorder_program_stages(
    cohort_id: int,
    payload: ProgramStageReorder,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    stages = list((await db.execute(select(AcceleratorProgramStage).where(
        AcceleratorProgramStage.cohort_id == cohort.id,
        AcceleratorProgramStage.status != "archived",
    ).with_for_update())).scalars().all())
    if {stage.id for stage in stages} != set(payload.stage_ids):
        raise HTTPException(status_code=422, detail="Передайте все этапы потока без повторов")
    by_id = {stage.id: stage for stage in stages}
    for offset, stage in enumerate(stages, start=1):
        stage.position = -offset
    await db.flush()
    for position, stage_id in enumerate(payload.stage_ids, start=1):
        by_id[stage_id].position = position
        by_id[stage_id].updated_by_user_id = user.id
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="program_stage.reordered",
              target_type="cohort", target_id=cohort.id,
              details={"stage_ids": payload.stage_ids})
    await db.commit()
    return [await manager_stage_dict(db, by_id[stage_id]) for stage_id in payload.stage_ids]


@router.get("/memberships/{membership_id}/program-stages")
async def list_resident_program_stages(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await get_resident_membership(db, membership_id, user)
    return await resident_program_rows(db, membership)


@router.post("/program/materials/{material_id}/complete")
async def complete_program_material(
    material_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    material = await db.get(AcceleratorProgramMaterial, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Материал не найден")
    stage = await db.get(AcceleratorProgramStage, material.stage_id)
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.cohort_id == stage.cohort_id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Материал не найден")
    rows = await resident_program_rows(db, membership)
    state = next((row["state"] for row in rows if row["id"] == stage.id), None)
    if state not in ("available", "completed"):
        raise HTTPException(status_code=409, detail="Этап программы пока закрыт")
    existing = (await db.execute(select(AcceleratorProgramMaterialProgress).where(
        AcceleratorProgramMaterialProgress.material_id == material.id,
        AcceleratorProgramMaterialProgress.membership_id == membership.id,
    ))).scalar_one_or_none()
    if not existing:
        db.add(AcceleratorProgramMaterialProgress(material_id=material.id, membership_id=membership.id))
        cohort = await get_cohort_or_404(db, membership.cohort_id)
        add_audit(
            db,
            accelerator_id=cohort.accelerator_id,
            cohort_id=cohort.id,
            actor_user_id=user.id,
            action="program_material.completed",
            target_type="program_material",
            target_id=material.id,
            details={"membership_id": membership.id, "stage_id": stage.id},
        )
        await db.commit()
    return {"material_id": material.id, "completed": True}


@router.post("/program/stages/{stage_id}/complete")
async def complete_program_stage(
    stage_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    stage = await db.get(AcceleratorProgramStage, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Этап программы не найден")
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.cohort_id == stage.cohort_id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Этап программы не найден")
    rows = await resident_program_rows(db, membership)
    state = next((row["state"] for row in rows if row["id"] == stage.id), None)
    if state == "completed":
        return {"stage_id": stage.id, "completed": True}
    if state != "available":
        raise HTTPException(status_code=409, detail="Этап программы пока закрыт")
    required_material_ids = set((await db.execute(select(AcceleratorProgramMaterial.id).where(
        AcceleratorProgramMaterial.stage_id == stage.id,
        AcceleratorProgramMaterial.required.is_(True),
    ))).scalars().all())
    completed_material_ids = set((await db.execute(select(AcceleratorProgramMaterialProgress.material_id).where(
        AcceleratorProgramMaterialProgress.membership_id == membership.id,
        AcceleratorProgramMaterialProgress.material_id.in_(required_material_ids),
    ))).scalars().all()) if required_material_ids else set()
    if required_material_ids - completed_material_ids:
        raise HTTPException(status_code=409, detail="Сначала отметьте все обязательные материалы")
    assignments = list((await db.execute(select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.stage_id == stage.id,
        AcceleratorHomeworkAssignment.status == "published",
    ))).scalars().all())
    for assignment in assignments:
        if assignment.audience == "selected":
            targeted = (await db.execute(select(AcceleratorHomeworkTarget.id).where(
                AcceleratorHomeworkTarget.assignment_id == assignment.id,
                AcceleratorHomeworkTarget.membership_id == membership.id,
            ))).scalar_one_or_none()
            if targeted is None:
                continue
        accepted = (await db.execute(select(AcceleratorHomeworkSubmission.id).where(
            AcceleratorHomeworkSubmission.assignment_id == assignment.id,
            AcceleratorHomeworkSubmission.membership_id == membership.id,
            AcceleratorHomeworkSubmission.status == "accepted",
        ))).scalar_one_or_none()
        if accepted is None:
            raise HTTPException(status_code=409, detail="Сначала получите зачёт по домашнему заданию этапа")
    db.add(AcceleratorProgramStageProgress(stage_id=stage.id, membership_id=membership.id))
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="program_stage.completed",
        target_type="program_stage",
        target_id=stage.id,
        details={"membership_id": membership.id},
    )
    await db.commit()
    return {"stage_id": stage.id, "completed": True}


@router.get("/cohorts/{cohort_id}/homework")
async def list_homework_assignments(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    access_role = await require_cohort_reader(db, user, cohort)
    await require_homework_module(db, cohort)
    assignment_query = select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.cohort_id == cohort.id,
        AcceleratorHomeworkAssignment.status != "archived",
    )
    assigned_ids: set[int] | None = None
    if access_role == "tracker":
        assigned_ids = await tracker_membership_ids(db, user.id, cohort.id)
        assignment_query = assignment_query.where(AcceleratorHomeworkAssignment.status == "published")
    assignments = (await db.execute(
        assignment_query.order_by(AcceleratorHomeworkAssignment.created_at.desc())
    )).scalars().all()
    result = []
    if assigned_ids is not None:
        enrolled_count = (await db.execute(select(func.count(AcceleratorMembership.id)).where(
            AcceleratorMembership.id.in_(assigned_ids),
            AcceleratorMembership.status == "enrolled",
        ))).scalar_one()
    else:
        enrolled_count = (await db.execute(select(func.count(AcceleratorMembership.id)).where(
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorMembership.role == "resident",
            AcceleratorMembership.status == "enrolled",
        ))).scalar_one()
    for assignment in assignments:
        target_ids = list((await db.execute(select(AcceleratorHomeworkTarget.membership_id).where(
            AcceleratorHomeworkTarget.assignment_id == assignment.id
        ))).scalars().all())
        if assigned_ids is not None:
            target_ids = [membership_id for membership_id in target_ids if membership_id in assigned_ids]
            if assignment.audience == "selected" and not target_ids:
                continue
        status_query = (
            select(AcceleratorHomeworkSubmission.status, func.count(AcceleratorHomeworkSubmission.id))
            .where(AcceleratorHomeworkSubmission.assignment_id == assignment.id)
        )
        if assigned_ids is not None:
            status_query = status_query.where(AcceleratorHomeworkSubmission.membership_id.in_(assigned_ids))
        status_rows = (await db.execute(
            status_query.group_by(AcceleratorHomeworkSubmission.status)
        )).all()
        status_counts = {status: count for status, count in status_rows}
        result.append({
            "id": assignment.id,
            "cohort_id": assignment.cohort_id,
            "stage_id": assignment.stage_id,
            "title": assignment.title,
            "description": assignment.description,
            "due_at": assignment.due_at,
            "status": assignment.status,
            "audience": assignment.audience,
            "target_membership_ids": target_ids,
            "target_count": len(target_ids) if assignment.audience == "selected" else enrolled_count,
            "allow_resubmit": assignment.allow_resubmit,
            "published_at": assignment.published_at,
            "created_at": assignment.created_at,
            "submission_counts": status_counts,
        })
    return result


@router.post("/cohorts/{cohort_id}/homework")
async def create_homework_assignment(
    cohort_id: int,
    payload: HomeworkAssignmentCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    await validate_homework_targets(db, cohort.id, payload.target_membership_ids)
    await ensure_stage_for_cohort(db, payload.stage_id, cohort.id)
    if payload.due_at and payload.due_at <= datetime.utcnow():
        raise HTTPException(status_code=422, detail="Дедлайн должен быть в будущем")
    assignment = AcceleratorHomeworkAssignment(
        cohort_id=cohort.id,
        stage_id=payload.stage_id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        due_at=payload.due_at,
        audience=payload.audience,
        allow_resubmit=payload.allow_resubmit,
        created_by_user_id=user.id,
        updated_by_user_id=user.id,
    )
    db.add(assignment)
    await db.flush()
    for membership_id in payload.target_membership_ids:
        db.add(AcceleratorHomeworkTarget(
            assignment_id=assignment.id,
            membership_id=membership_id,
        ))
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="homework.created",
        target_type="homework_assignment",
        target_id=assignment.id,
        details={"audience": assignment.audience, "target_membership_ids": payload.target_membership_ids},
    )
    await db.commit()
    return {"id": assignment.id, "status": assignment.status}


@router.put("/homework/{assignment_id}")
async def update_homework_assignment(
    assignment_id: int,
    payload: HomeworkAssignmentCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    assignment = (await db.execute(select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.id == assignment_id
    ).with_for_update())).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Домашнее задание не найдено")
    cohort = await get_cohort_or_404(db, assignment.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    if assignment.status != "draft":
        raise HTTPException(status_code=409, detail="После публикации задание нельзя редактировать")
    await validate_homework_targets(db, cohort.id, payload.target_membership_ids)
    await ensure_stage_for_cohort(db, payload.stage_id, cohort.id)
    if payload.due_at and payload.due_at <= datetime.utcnow():
        raise HTTPException(status_code=422, detail="Дедлайн должен быть в будущем")
    assignment.title = payload.title.strip()
    assignment.stage_id = payload.stage_id
    assignment.description = payload.description.strip()
    assignment.due_at = payload.due_at
    assignment.audience = payload.audience
    assignment.allow_resubmit = payload.allow_resubmit
    assignment.updated_by_user_id = user.id
    await db.execute(delete(AcceleratorHomeworkTarget).where(
        AcceleratorHomeworkTarget.assignment_id == assignment.id
    ))
    for membership_id in payload.target_membership_ids:
        db.add(AcceleratorHomeworkTarget(assignment_id=assignment.id, membership_id=membership_id))
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="homework.updated",
        target_type="homework_assignment",
        target_id=assignment.id,
    )
    await db.commit()
    return {"id": assignment.id, "status": assignment.status}


@router.post("/homework/{assignment_id}/publish")
async def publish_homework_assignment(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    assignment = (await db.execute(select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.id == assignment_id
    ).with_for_update())).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Домашнее задание не найдено")
    cohort = await get_cohort_or_404(db, assignment.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    if assignment.status != "draft":
        raise HTTPException(status_code=409, detail="Задание уже опубликовано")
    recipients = await homework_recipients(db, assignment)
    if not recipients:
        raise HTTPException(status_code=409, detail="В аудитории задания нет зачисленных резидентов")
    accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
    assignment.status = "published"
    assignment.published_at = datetime.utcnow()
    assignment.updated_by_user_id = user.id
    frontend_url = os.getenv("FRONTEND_URL", "https://pitchy.pro").rstrip("/")
    notification_ids = []
    for membership, resident in recipients:
        deadline = f"\nДедлайн: {assignment.due_at.strftime('%d.%m.%Y %H:%M')}" if assignment.due_at else ""
        notification = await enqueue_notification(
            db,
            accelerator_id=accelerator.id,
            cohort_id=cohort.id,
            recipient_email=resident.email,
            event_type="homework_published",
            subject=f"Новое задание: {assignment.title}",
            body=(
                f"Здравствуйте, {resident.name}!\n\nВ потоке «{cohort.name}» опубликовано задание "
                f"«{assignment.title}».{deadline}\n\nОткрыть: {frontend_url}/accelerator"
            ),
            idempotency_key=f"homework-published:{assignment.id}:{membership.id}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db,
        accelerator_id=accelerator.id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="homework.published",
        target_type="homework_assignment",
        target_id=assignment.id,
        details={"recipient_count": len(recipients)},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return {"id": assignment.id, "status": assignment.status, "recipient_count": len(recipients)}


@router.post("/homework/{assignment_id}/remind")
async def remind_homework_assignment(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    assignment = await get_homework_assignment_or_404(db, assignment_id)
    cohort = await get_cohort_or_404(db, assignment.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    if assignment.status != "published":
        raise HTTPException(status_code=409, detail="Напоминание доступно только для опубликованного задания")
    recipients = await homework_recipients(db, assignment)
    completed_or_waiting_ids = set((await db.execute(select(AcceleratorHomeworkSubmission.membership_id).where(
        AcceleratorHomeworkSubmission.assignment_id == assignment.id,
        AcceleratorHomeworkSubmission.status.in_(("accepted", "submitted")),
    ))).scalars().all())
    accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
    frontend_url = os.getenv("FRONTEND_URL", "https://pitchy.pro").rstrip("/")
    notification_ids = []
    today = datetime.utcnow().date().isoformat()
    for membership, resident in recipients:
        if membership.id in completed_or_waiting_ids:
            continue
        notification = await enqueue_notification(
            db,
            accelerator_id=accelerator.id,
            cohort_id=cohort.id,
            recipient_email=resident.email,
            event_type="homework_reminder",
            subject=f"Напоминание о задании: {assignment.title}",
            body=f"Здравствуйте, {resident.name}!\n\nЗадание «{assignment.title}» ожидает выполнения или доработки.\n\nОткрыть: {frontend_url}/accelerator",
            idempotency_key=f"homework-reminder:{assignment.id}:{membership.id}:{today}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db,
        accelerator_id=accelerator.id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="homework.reminded",
        target_type="homework_assignment",
        target_id=assignment.id,
        details={"recipient_count": len(notification_ids)},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return {"id": assignment.id, "reminded": len(notification_ids)}


@router.post("/homework/{assignment_id}/duplicate")
async def duplicate_homework_assignment(
    assignment_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    source = await get_homework_assignment_or_404(db, assignment_id)
    cohort = await get_cohort_or_404(db, source.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    duplicate = AcceleratorHomeworkAssignment(
        cohort_id=source.cohort_id, stage_id=source.stage_id,
        title=f"{source.title} — копия", description=source.description,
        due_at=source.due_at if source.due_at and source.due_at > datetime.utcnow() else None,
        audience=source.audience, allow_resubmit=source.allow_resubmit,
        created_by_user_id=user.id, updated_by_user_id=user.id,
    )
    db.add(duplicate)
    await db.flush()
    target_ids = list((await db.execute(select(AcceleratorHomeworkTarget.membership_id).where(
        AcceleratorHomeworkTarget.assignment_id == source.id
    ))).scalars().all())
    for membership_id in target_ids:
        db.add(AcceleratorHomeworkTarget(assignment_id=duplicate.id, membership_id=membership_id))
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="homework.duplicated",
              target_type="homework_assignment", target_id=duplicate.id,
              details={"source_id": source.id})
    await db.commit()
    return {"id": duplicate.id, "status": duplicate.status}


@router.post("/homework/{assignment_id}/archive")
async def archive_homework_assignment(
    assignment_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    assignment = await get_homework_assignment_or_404(db, assignment_id)
    cohort = await get_cohort_or_404(db, assignment.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    if assignment.status == "archived":
        raise HTTPException(status_code=409, detail="Задание уже в архиве")
    assignment.status = "archived"
    assignment.archived_at = datetime.utcnow()
    assignment.updated_by_user_id = user.id
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="homework.archived",
              target_type="homework_assignment", target_id=assignment.id)
    await db.commit()
    return {"id": assignment.id, "status": assignment.status}


@router.get("/memberships/{membership_id}/homework")
async def list_resident_homework(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.user_id != user.id or membership.role != "resident":
        raise HTTPException(status_code=404, detail="Участие не найдено")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_homework_module(db, cohort)
    if membership.status != "enrolled":
        return []
    selected_assignment_ids = select(AcceleratorHomeworkTarget.assignment_id).where(
        AcceleratorHomeworkTarget.membership_id == membership.id
    )
    assignments = (await db.execute(select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.cohort_id == cohort.id,
        AcceleratorHomeworkAssignment.status == "published",
        or_(
            AcceleratorHomeworkAssignment.audience == "cohort",
            AcceleratorHomeworkAssignment.id.in_(selected_assignment_ids),
        ),
    ).order_by(
        AcceleratorHomeworkAssignment.due_at.is_(None),
        AcceleratorHomeworkAssignment.due_at,
        AcceleratorHomeworkAssignment.published_at.desc(),
    ))).scalars().all()
    submissions = (await db.execute(select(AcceleratorHomeworkSubmission).where(
        AcceleratorHomeworkSubmission.membership_id == membership.id,
        AcceleratorHomeworkSubmission.assignment_id.in_([row.id for row in assignments]),
    ))).scalars().all() if assignments else []
    by_assignment = {submission.assignment_id: submission for submission in submissions}
    result = []
    for assignment in assignments:
        submission = by_assignment.get(assignment.id)
        submission_data = homework_submission_dict(submission) if submission else None
        if submission_data:
            submission_data["is_late"] = bool(assignment.due_at and submission.submitted_at > assignment.due_at)
        result.append({
            "id": assignment.id,
            "stage_id": assignment.stage_id,
            "title": assignment.title,
            "description": assignment.description,
            "due_at": assignment.due_at,
            "allow_resubmit": assignment.allow_resubmit,
            "published_at": assignment.published_at,
            "is_overdue": bool(assignment.due_at and assignment.due_at < datetime.utcnow() and not submission),
            "submission": submission_data,
        })
    return result


@router.post("/homework/{assignment_id}/submission")
async def submit_homework(
    assignment_id: int,
    payload: HomeworkSubmissionUpsert,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    assignment = await get_homework_assignment_or_404(db, assignment_id)
    cohort = await get_cohort_or_404(db, assignment.cohort_id)
    await require_homework_module(db, cohort)
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalar_one_or_none()
    if not membership or assignment.status != "published":
        raise HTTPException(status_code=404, detail="Домашнее задание недоступно")
    if assignment.audience == "selected":
        targeted = (await db.execute(select(AcceleratorHomeworkTarget.id).where(
            AcceleratorHomeworkTarget.assignment_id == assignment.id,
            AcceleratorHomeworkTarget.membership_id == membership.id,
        ))).scalar_one_or_none()
        if targeted is None:
            raise HTTPException(status_code=404, detail="Домашнее задание недоступно")
    submission = (await db.execute(select(AcceleratorHomeworkSubmission).where(
        AcceleratorHomeworkSubmission.assignment_id == assignment.id,
        AcceleratorHomeworkSubmission.membership_id == membership.id,
    ).with_for_update())).scalar_one_or_none()
    now = datetime.utcnow()
    if submission:
        if not assignment.allow_resubmit and submission.status in ("submitted", "accepted"):
            raise HTTPException(status_code=409, detail="Повторная отправка для этого задания отключена")
        submission.answer_text = (payload.answer_text or "").strip() or None
        submission.attachments = payload.attachments
        submission.status = "submitted"
        submission.attempt_count += 1
        submission.submitted_at = now
        submission.reviewed_by_user_id = None
        submission.review_comment = None
        submission.reviewed_at = None
    else:
        submission = AcceleratorHomeworkSubmission(
            assignment_id=assignment.id,
            membership_id=membership.id,
            answer_text=(payload.answer_text or "").strip() or None,
            attachments=payload.attachments,
            status="submitted",
            submitted_at=now,
        )
        db.add(submission)
    await db.flush()
    reviewer = await db.get(User, assignment.created_by_user_id)
    tracker_reviewers = (await db.execute(
        select(User)
        .join(AcceleratorTrackerAssignment, AcceleratorTrackerAssignment.tracker_user_id == User.id)
        .where(AcceleratorTrackerAssignment.membership_id == membership.id)
    )).scalars().all()
    reviewers = {
        row.id: row for row in ([reviewer] if reviewer else []) + list(tracker_reviewers)
        if row.is_active and row.deleted_at is None
    }
    notification_ids = []
    accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
    for recipient in reviewers.values():
        notification = await enqueue_notification(
            db,
            accelerator_id=accelerator.id,
            cohort_id=cohort.id,
            recipient_email=recipient.email,
            event_type="homework_submitted",
            subject=f"Получен ответ: {assignment.title}",
            body=f"Резидент {user.name} отправил ответ на задание «{assignment.title}».\n\nОткрыть проверку: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
            idempotency_key=f"homework-submitted:{submission.id}:{submission.attempt_count}:{recipient.id}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="homework.submitted",
        target_type="homework_submission",
        target_id=submission.id,
        details={"assignment_id": assignment.id, "attempt": submission.attempt_count},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    data = homework_submission_dict(submission)
    data["is_late"] = bool(assignment.due_at and submission.submitted_at > assignment.due_at)
    return data


@router.get("/homework/{assignment_id}/submissions")
async def list_homework_submissions(
    assignment_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    assignment = await get_homework_assignment_or_404(db, assignment_id)
    cohort = await get_cohort_or_404(db, assignment.cohort_id)
    access_role = await require_cohort_reader(db, user, cohort)
    await require_homework_module(db, cohort)
    submission_query = (
        select(AcceleratorHomeworkSubmission, User)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorHomeworkSubmission.membership_id)
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(AcceleratorHomeworkSubmission.assignment_id == assignment.id)
    )
    if access_role == "tracker":
        submission_query = submission_query.where(
            AcceleratorHomeworkSubmission.membership_id.in_(
                await tracker_membership_ids(db, user.id, cohort.id)
            )
        )
    rows = (await db.execute(
        submission_query.order_by(AcceleratorHomeworkSubmission.submitted_at.desc())
    )).all()
    result = []
    for submission, resident in rows:
        data = homework_submission_dict(submission, resident=resident)
        data["is_late"] = bool(assignment.due_at and submission.submitted_at > assignment.due_at)
        result.append(data)
    return result


@router.patch("/homework/submissions/{submission_id}/review")
async def review_homework_submission(
    submission_id: int,
    payload: HomeworkReview,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    submission = (await db.execute(select(AcceleratorHomeworkSubmission).where(
        AcceleratorHomeworkSubmission.id == submission_id
    ).with_for_update())).scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=404, detail="Ответ не найден")
    assignment = await get_homework_assignment_or_404(db, submission.assignment_id)
    cohort = await get_cohort_or_404(db, assignment.cohort_id)
    await require_homework_module(db, cohort)
    membership = await db.get(AcceleratorMembership, submission.membership_id)
    await require_tracker_membership_access(db, user, membership)
    if submission.status not in ("submitted", "needs_revision"):
        raise HTTPException(status_code=409, detail="Ответ уже проверен")
    submission.status = payload.status
    submission.review_comment = (payload.comment or "").strip() or None
    submission.reviewed_by_user_id = user.id
    submission.reviewed_at = datetime.utcnow()
    resident = await db.get(User, membership.user_id) if membership else None
    notification = None
    if resident:
        accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
        decision = "принят" if payload.status == "accepted" else "возвращён на доработку"
        notification = await enqueue_notification(
            db,
            accelerator_id=accelerator.id,
            cohort_id=cohort.id,
            recipient_email=resident.email,
            event_type=f"homework_{payload.status}",
            subject=f"Ответ {decision}: {assignment.title}",
            body=(
                f"Здравствуйте, {resident.name}!\n\nВаш ответ на задание «{assignment.title}» {decision}."
                + (f"\n\nКомментарий: {submission.review_comment}" if submission.review_comment else "")
                + f"\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator"
            ),
            idempotency_key=f"homework-review:{submission.id}:{submission.attempt_count}:{payload.status}",
        )
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="homework.reviewed",
        target_type="homework_submission",
        target_id=submission.id,
        details={"status": payload.status, "assignment_id": assignment.id},
    )
    await db.commit()
    if notification:
        background_tasks.add_task(process_notification_event, notification.id)
    return homework_submission_dict(submission, resident=resident)


def event_dict(row: AcceleratorEvent, *, attendance_count: int = 0, attendance: AcceleratorAttendanceRecord | None = None) -> dict:
    frontend_url = os.getenv("FRONTEND_URL", "https://pitchy.pro").rstrip("/")
    return {
        "id": row.id,
        "cohort_id": row.cohort_id,
        "stage_id": row.stage_id,
        "title": row.title,
        "description": row.description,
        "starts_at": row.starts_at,
        "ends_at": row.ends_at,
        "event_format": row.event_format,
        "location": row.location,
        "meeting_url": row.meeting_url,
        "status": row.status,
        "checkin_opens_minutes": row.checkin_opens_minutes,
        "checkin_closes_minutes": row.checkin_closes_minutes,
        "checkin_url": f"{frontend_url}/accelerator/check-in/{row.checkin_code}",
        "attendance_count": attendance_count,
        "attendance": ({
            "status": attendance.status,
            "checked_in_at": attendance.checked_in_at,
            "checkin_method": attendance.checkin_method,
            "comment": attendance.comment,
        } if attendance else None),
    }


@router.get("/cohorts/{cohort_id}/events")
async def list_events(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    access_role = await require_cohort_reader(db, user, cohort)
    await require_attendance_module(db, cohort)
    event_query = select(AcceleratorEvent).where(
        AcceleratorEvent.cohort_id == cohort.id,
        AcceleratorEvent.status != "archived",
    )
    if access_role == "tracker":
        event_query = event_query.where(AcceleratorEvent.status == "published")
    rows = (await db.execute(event_query.order_by(AcceleratorEvent.starts_at))).scalars().all()
    count_query = (
        select(AcceleratorAttendanceRecord.event_id, func.count(AcceleratorAttendanceRecord.id))
        .where(AcceleratorAttendanceRecord.status == "present")
    )
    if access_role == "tracker":
        count_query = count_query.where(AcceleratorAttendanceRecord.membership_id.in_(
            await tracker_membership_ids(db, user.id, cohort.id)
        ))
    counts = dict((await db.execute(
        count_query.group_by(AcceleratorAttendanceRecord.event_id)
    )).all())
    return [event_dict(row, attendance_count=counts.get(row.id, 0)) for row in rows]


@router.post("/cohorts/{cohort_id}/events")
async def create_event(
    cohort_id: int,
    payload: EventCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    await ensure_stage_for_cohort(db, payload.stage_id, cohort.id)
    event = AcceleratorEvent(
        cohort_id=cohort.id, stage_id=payload.stage_id, title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        starts_at=payload.starts_at, ends_at=payload.ends_at,
        event_format=payload.event_format, location=(payload.location or "").strip() or None,
        meeting_url=(payload.meeting_url or "").strip() or None,
        checkin_code=secrets.token_urlsafe(24),
        checkin_opens_minutes=payload.checkin_opens_minutes,
        checkin_closes_minutes=payload.checkin_closes_minutes,
        created_by_user_id=user.id, updated_by_user_id=user.id,
    )
    db.add(event)
    await db.flush()
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="event.created", target_type="event", target_id=event.id)
    await db.commit()
    return event_dict(event)


@router.put("/events/{event_id}")
async def update_event(
    event_id: int,
    payload: EventCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = await db.get(AcceleratorEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Мероприятие не найдено")
    cohort = await get_cohort_or_404(db, event.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    if event.status != "draft":
        raise HTTPException(status_code=409, detail="Опубликованное мероприятие нельзя менять")
    await ensure_stage_for_cohort(db, payload.stage_id, cohort.id)
    event.stage_id = payload.stage_id
    event.title = payload.title.strip()
    event.description = (payload.description or "").strip() or None
    event.starts_at = payload.starts_at
    event.ends_at = payload.ends_at
    event.event_format = payload.event_format
    event.location = (payload.location or "").strip() or None
    event.meeting_url = (payload.meeting_url or "").strip() or None
    event.checkin_opens_minutes = payload.checkin_opens_minutes
    event.checkin_closes_minutes = payload.checkin_closes_minutes
    event.updated_by_user_id = user.id
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="event.updated",
        target_type="event",
        target_id=event.id,
    )
    await db.commit()
    return event_dict(event)


@router.post("/events/{event_id}/publish")
async def publish_event(
    event_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = await db.get(AcceleratorEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Мероприятие не найдено")
    cohort = await get_cohort_or_404(db, event.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    if event.status != "draft":
        raise HTTPException(status_code=409, detail="Мероприятие уже опубликовано")
    event.status = "published"
    event.published_at = datetime.utcnow()
    event.updated_by_user_id = user.id
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="event.published", target_type="event", target_id=event.id)
    await db.commit()
    return event_dict(event)


@router.get("/events/{event_id}/qr")
async def event_checkin_qr(
    event_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = await db.get(AcceleratorEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Мероприятие не найдено")
    cohort = await get_cohort_or_404(db, event.cohort_id)
    await require_cohort_manager(db, user, cohort)
    import qrcode
    import qrcode.image.svg
    url = event_dict(event)["checkin_url"]
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage)
    return Response(content=image.to_string(), media_type="image/svg+xml",
                    headers={"Cache-Control": "no-store"})


@router.post("/events/{event_id}/duplicate")
async def duplicate_event(
    event_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    source = await db.get(AcceleratorEvent, event_id)
    if not source:
        raise HTTPException(status_code=404, detail="Мероприятие не найдено")
    cohort = await get_cohort_or_404(db, source.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    duplicate = AcceleratorEvent(
        cohort_id=source.cohort_id, stage_id=source.stage_id,
        title=f"{source.title} — копия", description=source.description,
        starts_at=source.starts_at, ends_at=source.ends_at,
        event_format=source.event_format, location=source.location, meeting_url=source.meeting_url,
        checkin_code=secrets.token_urlsafe(24),
        checkin_opens_minutes=source.checkin_opens_minutes,
        checkin_closes_minutes=source.checkin_closes_minutes,
        created_by_user_id=user.id, updated_by_user_id=user.id,
    )
    db.add(duplicate)
    await db.flush()
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="event.duplicated", target_type="event",
              target_id=duplicate.id, details={"source_id": source.id})
    await db.commit()
    return event_dict(duplicate)


@router.post("/events/{event_id}/archive")
async def archive_event(
    event_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = await db.get(AcceleratorEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Мероприятие не найдено")
    cohort = await get_cohort_or_404(db, event.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    if event.status == "archived":
        raise HTTPException(status_code=409, detail="Мероприятие уже в архиве")
    event.status = "archived"
    event.updated_by_user_id = user.id
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="event.archived", target_type="event", target_id=event.id)
    await db.commit()
    return event_dict(event)


@router.get("/events/{event_id}/attendance")
async def list_event_attendance(
    event_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = await db.get(AcceleratorEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Мероприятие не найдено")
    cohort = await get_cohort_or_404(db, event.cohort_id)
    access_role = await require_cohort_reader(db, user, cohort)
    await require_attendance_module(db, cohort)
    attendance_query = (
        select(AcceleratorMembership, User, AcceleratorAttendanceRecord)
        .join(User, User.id == AcceleratorMembership.user_id)
        .outerjoin(AcceleratorAttendanceRecord, (
            (AcceleratorAttendanceRecord.membership_id == AcceleratorMembership.id)
            & (AcceleratorAttendanceRecord.event_id == event.id)
        ))
        .where(AcceleratorMembership.cohort_id == cohort.id,
               AcceleratorMembership.role == "resident",
               AcceleratorMembership.status == "enrolled")
    )
    if access_role == "tracker":
        attendance_query = attendance_query.where(AcceleratorMembership.id.in_(
            await tracker_membership_ids(db, user.id, cohort.id)
        ))
    rows = (await db.execute(attendance_query.order_by(User.name))).all()
    return [{
        "membership_id": membership.id, "name": resident.name, "email": resident.email,
        "status": attendance.status if attendance else "not_marked",
        "checked_in_at": attendance.checked_in_at if attendance else None,
        "comment": attendance.comment if attendance else None,
    } for membership, resident, attendance in rows]


@router.patch("/events/{event_id}/attendance")
async def mark_event_attendance(
    event_id: int,
    payload: AttendanceMark,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = await db.get(AcceleratorEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Мероприятие не найдено")
    cohort = await get_cohort_or_404(db, event.cohort_id)
    await require_attendance_module(db, cohort)
    membership = await db.get(AcceleratorMembership, payload.membership_id)
    if not membership or membership.cohort_id != cohort.id or membership.status != "enrolled":
        raise HTTPException(status_code=422, detail="Резидент не зачислен в этот поток")
    await require_tracker_membership_access(db, user, membership)
    record = (await db.execute(select(AcceleratorAttendanceRecord).where(
        AcceleratorAttendanceRecord.event_id == event.id,
        AcceleratorAttendanceRecord.membership_id == membership.id,
    ))).scalar_one_or_none()
    now = datetime.utcnow()
    if not record:
        record = AcceleratorAttendanceRecord(event_id=event.id, membership_id=membership.id)
        db.add(record)
    record.status = payload.status
    record.checkin_method = "manual"
    record.checked_in_at = now if payload.status == "present" else None
    record.marked_by_user_id = user.id
    record.comment = (payload.comment or "").strip() or None
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
              actor_user_id=user.id, action="attendance.marked", target_type="event", target_id=event.id,
              details={"membership_id": membership.id, "status": payload.status})
    await db.commit()
    return {"event_id": event.id, "membership_id": membership.id, "status": record.status}


@router.get("/memberships/{membership_id}/events")
async def list_resident_events(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await get_resident_membership(db, membership_id, user)
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_attendance_module(db, cohort)
    events = (await db.execute(select(AcceleratorEvent).where(
        AcceleratorEvent.cohort_id == cohort.id,
        AcceleratorEvent.status == "published",
    ).order_by(AcceleratorEvent.starts_at))).scalars().all()
    records = (await db.execute(select(AcceleratorAttendanceRecord).where(
        AcceleratorAttendanceRecord.membership_id == membership.id,
        AcceleratorAttendanceRecord.event_id.in_([event.id for event in events]),
    ))).scalars().all() if events else []
    by_event = {row.event_id: row for row in records}
    return [event_dict(event, attendance=by_event.get(event.id)) for event in events]


@router.post("/attendance/check-in/{code}")
async def check_in_to_event(
    code: str,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = (await db.execute(select(AcceleratorEvent).where(
        AcceleratorEvent.checkin_code == code,
        AcceleratorEvent.status == "published",
    ))).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Ссылка отметки недействительна")
    cohort = await get_cohort_or_404(db, event.cohort_id)
    await require_attendance_module(db, cohort)
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=403, detail="Вы не зачислены в этот поток")
    now = datetime.utcnow()
    opens_at = event.starts_at - timedelta(minutes=event.checkin_opens_minutes)
    closes_at = event.ends_at + timedelta(minutes=event.checkin_closes_minutes)
    if now < opens_at:
        raise HTTPException(status_code=409, detail="Отметка посещения ещё не открыта")
    if now > closes_at:
        raise HTTPException(status_code=409, detail="Время отметки посещения завершилось")
    record = (await db.execute(select(AcceleratorAttendanceRecord).where(
        AcceleratorAttendanceRecord.event_id == event.id,
        AcceleratorAttendanceRecord.membership_id == membership.id,
    ))).scalar_one_or_none()
    changed = not record or record.status != "present" or record.checkin_method != "qr"
    if not record:
        record = AcceleratorAttendanceRecord(
            event_id=event.id, membership_id=membership.id, status="present",
            checkin_method="qr", checked_in_at=now,
        )
        db.add(record)
    elif changed:
        record.status = "present"
        record.checkin_method = "qr"
        record.checked_in_at = now
        record.marked_by_user_id = None
        record.comment = None
    if changed:
        add_audit(
            db,
            accelerator_id=cohort.accelerator_id,
            cohort_id=cohort.id,
            actor_user_id=user.id,
            action="attendance.checked_in",
            target_type="event",
            target_id=event.id,
            details={"membership_id": membership.id, "method": "qr"},
        )
        await db.commit()
    return {"event": event_dict(event, attendance=record), "checked_in": True}


@router.post("/cohorts/{cohort_id}/applications")
async def submit_application(
    cohort_id: int,
    payload: ApplicationCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    if cohort.status != "accepting":
        raise HTTPException(status_code=409, detail="Приём заявок в этот поток закрыт")
    validate_application_form(
        cohort.application_form_schema or {}, payload.form_payload, payload.application_type
    )
    if payload.project_id:
        from models import Project
        project = (await db.execute(select(Project.id).where(
            Project.id == payload.project_id, Project.user_id == user.id
        ))).scalar_one_or_none()
        if project is None:
            raise HTTPException(status_code=404, detail="Проект не найден")
    existing = (await db.execute(select(AcceleratorApplication).where(
        AcceleratorApplication.cohort_id == cohort.id,
        or_(
            AcceleratorApplication.user_id == user.id,
            func.lower(AcceleratorApplication.applicant_email) == user.email.lower(),
        ),
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Вы уже подали заявку в этот поток")
    application = AcceleratorApplication(
        cohort_id=cohort.id,
        user_id=user.id,
        project_id=payload.project_id,
        applicant_name=user.name,
        applicant_email=user.email.lower(),
        application_type=payload.application_type,
        status="draft",
        form_payload=payload.form_payload,
        privacy_consent_at=datetime.utcnow(),
        program_rules_consent_at=datetime.utcnow(),
    )
    db.add(application)
    await db.flush()
    record_application_event(
        db,
        application=application,
        to_status="submitted",
        actor_user_id=user.id,
        comment="Заявка отправлена кандидатом",
    )
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="application.submitted",
        target_type="application",
        target_id=application.id,
    )
    await db.commit()
    await db.refresh(application)
    return application_dict(application)


@router.get("/public/cohorts/{cohort_id}/application-form")
async def get_public_application_form(
    cohort_id: int,
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    if cohort.status != "accepting":
        raise HTTPException(status_code=404, detail="Приём заявок закрыт")
    accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
    return {
        "accelerator": accelerator_dict(accelerator),
        "cohort": cohort_dict(cohort),
        "form_schema": cohort.application_form_schema or {},
    }


@router.post("/public/cohorts/{cohort_id}/applications")
async def submit_public_application(
    cohort_id: int,
    payload: PublicApplicationCreate,
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    if cohort.status != "accepting":
        raise HTTPException(status_code=409, detail="Приём заявок в этот поток закрыт")
    validate_application_form(
        cohort.application_form_schema or {}, payload.form_payload, payload.application_type
    )
    email = str(payload.applicant_email).strip().lower()
    existing = (await db.execute(select(AcceleratorApplication.id).where(
        AcceleratorApplication.cohort_id == cohort.id,
        func.lower(AcceleratorApplication.applicant_email) == email,
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Заявка с этим email уже подана")
    user = (await db.execute(select(User).where(
        func.lower(User.email) == email, User.deleted_at.is_(None)
    ))).scalar_one_or_none()
    now = datetime.utcnow()
    application = AcceleratorApplication(
        cohort_id=cohort.id,
        user_id=user.id if user else None,
        applicant_name=payload.applicant_name.strip(),
        applicant_email=email,
        application_type=payload.application_type,
        status="draft",
        form_payload=payload.form_payload,
        privacy_consent_at=now,
        program_rules_consent_at=now,
    )
    db.add(application)
    await db.flush()
    record_application_event(
        db,
        application=application,
        to_status="submitted",
        actor_user_id=user.id if user else None,
        comment="Публичная заявка отправлена",
    )
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id if user else None,
        action="application.submitted_public",
        target_type="application",
        target_id=application.id,
        details={"applicant_email": email},
    )
    await db.commit()
    await db.refresh(application)
    return {"id": application.id, "status": application.status, "submitted_at": application.submitted_at}


@router.get("/cohorts/{cohort_id}/applications")
async def list_applications(
    cohort_id: int,
    status: str | None = Query(default=None),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    query = select(AcceleratorApplication).where(AcceleratorApplication.cohort_id == cohort.id)
    if status:
        query = query.where(AcceleratorApplication.status == status)
    rows = (await db.execute(query.order_by(AcceleratorApplication.submitted_at.desc()))).scalars().all()
    return [application_dict(row) for row in rows]


@router.post("/applications/{application_id}/accept")
async def accept_application(
    application_id: int,
    payload: ApplicationReview,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    application = (await db.execute(
        select(AcceleratorApplication).where(AcceleratorApplication.id == application_id).with_for_update()
    )).scalar_one_or_none()
    if not application:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    cohort = await get_cohort_or_404(db, application.cohort_id)
    await require_cohort_manager(db, user, cohort)
    accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
    try:
        result = await approve_application(
            db,
            application=application,
            cohort=cohort,
            accelerator=accelerator,
            actor_user_id=user.id,
            comment=payload.comment,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Пользователь уже состоит в потоке") from exc
    membership = result["membership"]
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="application.accepted",
        target_type="application",
        target_id=application.id,
        details={
            "membership_id": membership.id,
            "project_id": result["project"].id if result["project"] else None,
            "created_user": result["created_user"],
        },
    )
    await db.commit()
    if result["notification"]:
        background_tasks.add_task(process_notification_event, result["notification"].id)
    return {
        "application": application_dict(application),
        "membership_id": membership.id,
        "membership_status": membership.status,
        "project_id": result["project"].id if result["project"] else None,
        "user_id": result["user"].id,
        "created_user": result["created_user"],
    }


@router.patch("/applications/{application_id}/status")
async def update_application_status(
    application_id: int,
    payload: ApplicationStatusUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    application = (await db.execute(
        select(AcceleratorApplication).where(AcceleratorApplication.id == application_id).with_for_update()
    )).scalar_one_or_none()
    if not application:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    cohort = await get_cohort_or_404(db, application.cohort_id)
    await require_cohort_manager(db, user, cohort)
    previous = application.status
    transition_application(
        db,
        application=application,
        to_status=payload.status,
        actor_user_id=user.id,
        comment=payload.comment,
    )
    application.reviewed_by_user_id = user.id
    application.review_comment = payload.comment
    application.reviewed_at = datetime.utcnow()
    notification = None
    revision_token = None
    if payload.status == "needs_info":
        revision_token = secrets.token_urlsafe(32)
        application.revision_token_hash = hashlib.sha256(revision_token.encode("utf-8")).hexdigest()
        application.revision_requested_at = datetime.utcnow()
        application.revision_expires_at = datetime.utcnow() + timedelta(days=14)
    elif previous == "needs_info":
        application.revision_token_hash = None
        application.revision_requested_at = None
        application.revision_expires_at = None
    if payload.status in ("needs_info", "rejected") and application.applicant_email:
        accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
        subject = (
            f"Нужны уточнения по заявке в «{accelerator.name}»"
            if payload.status == "needs_info"
            else f"Решение по заявке в «{accelerator.name}»"
        )
        revision_link = (
            f"\n\nИсправить заявку: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerators/application-revision/{revision_token}"
            if revision_token else ""
        )
        body = (
            f"Здравствуйте, {application.applicant_name or ''}!\n\n"
            + ("Организатору нужны дополнительные сведения по вашей заявке.\n" if payload.status == "needs_info" else "К сожалению, заявка не прошла отбор.\n")
            + (f"\nКомментарий: {payload.comment}" if payload.comment else "")
            + revision_link
        )
        notification = await enqueue_notification(
            db,
            accelerator_id=accelerator.id,
            cohort_id=cohort.id,
            recipient_email=application.applicant_email,
            event_type=f"application_{payload.status}",
            subject=subject,
            body=body,
            idempotency_key=f"application-{payload.status}:{application.id}:{application.updated_at.isoformat()}",
        )
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="application.status_changed",
        target_type="application",
        target_id=application.id,
        details={"from": previous, "to": payload.status, "comment": payload.comment},
    )
    await db.commit()
    if notification:
        background_tasks.add_task(process_notification_event, notification.id)
    return application_dict(application)


@router.post("/applications/{application_id}/enroll")
async def enroll_application(
    application_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    application = await db.get(AcceleratorApplication, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    cohort = await get_cohort_or_404(db, application.cohort_id)
    await require_cohort_manager(db, user, cohort)
    membership = (await db.execute(
        select(AcceleratorMembership)
        .where(AcceleratorMembership.application_id == application.id)
        .with_for_update()
    )).scalar_one_or_none()
    if application.status != "approved" or not membership or membership.status != "accepted":
        raise HTTPException(status_code=409, detail="Сначала заявку нужно принять")
    membership.status = "enrolled"
    membership.enrolled_at = datetime.utcnow()
    membership.status_reason = "Зачисление после одобрения заявки"
    membership.status_changed_by_user_id = user.id
    if cohort.default_quota_config:
        await assign_quota_override(
            db,
            membership=membership,
            source="cohort",
            limits=cohort.default_quota_config,
            created_by_user_id=cohort.default_quota_updated_by_user_id or cohort.created_by_user_id,
            starts_at=membership.enrolled_at,
            ends_at=cohort.ends_at,
            reason="Шаблон лимитов потока при зачислении",
        )
    db.add(AcceleratorMembershipEvent(
        membership_id=membership.id,
        from_status="accepted",
        to_status="enrolled",
        actor_user_id=user.id,
        reason=membership.status_reason,
    ))
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="resident.enrolled",
        target_type="membership",
        target_id=membership.id,
    )
    await db.commit()
    return {"membership_id": membership.id, "status": membership.status, "enrolled_at": membership.enrolled_at}


@router.post("/applications/{application_id}/reject")
async def reject_application(
    application_id: int,
    payload: ApplicationReview,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await update_application_status(
        application_id,
        ApplicationStatusUpdate(status="rejected", comment=payload.comment),
        background_tasks,
        user,
        db,
    )


@router.get("/applications/{application_id}/events")
async def list_application_events(
    application_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    application = await db.get(AcceleratorApplication, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    cohort = await get_cohort_or_404(db, application.cohort_id)
    await require_cohort_manager(db, user, cohort)
    rows = (await db.execute(
        select(AcceleratorApplicationEvent)
        .where(AcceleratorApplicationEvent.application_id == application.id)
        .order_by(AcceleratorApplicationEvent.created_at)
    )).scalars().all()
    return [{
        "id": row.id,
        "from_status": row.from_status,
        "to_status": row.to_status,
        "actor_user_id": row.actor_user_id,
        "comment": row.comment,
        "created_at": row.created_at,
    } for row in rows]


async def application_by_revision_token(db: AsyncSession, token: str) -> AcceleratorApplication:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    application = (await db.execute(select(AcceleratorApplication).where(
        AcceleratorApplication.revision_token_hash == token_hash
    ))).scalar_one_or_none()
    if (
        not application
        or application.status != "needs_info"
        or not application.revision_expires_at
        or application.revision_expires_at < datetime.utcnow()
    ):
        raise HTTPException(status_code=404, detail="Ссылка на доработку недействительна или устарела")
    return application


@router.get("/public/application-revisions/{token}")
async def get_application_revision(
    token: str,
    db: AsyncSession = Depends(get_async_db),
):
    application = await application_by_revision_token(db, token)
    cohort = await get_cohort_or_404(db, application.cohort_id)
    accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
    return {
        "application_id": application.id,
        "applicant_name": application.applicant_name,
        "applicant_email": application.applicant_email,
        "application_type": application.application_type,
        "form_payload": application.form_payload or {},
        "review_comment": application.review_comment,
        "revision_expires_at": application.revision_expires_at,
        "form_schema": cohort.application_form_schema or {},
        "cohort": {"id": cohort.id, "name": cohort.name},
        "accelerator": {"id": accelerator.id, "name": accelerator.name},
    }


@router.post("/public/application-revisions/{token}")
async def submit_application_revision(
    token: str,
    payload: ApplicationRevisionUpdate,
    db: AsyncSession = Depends(get_async_db),
):
    application = await application_by_revision_token(db, token)
    cohort = await get_cohort_or_404(db, application.cohort_id)
    validate_application_form(
        cohort.application_form_schema or {}, payload.form_payload, application.application_type
    )
    previous = application.status
    application.form_payload = payload.form_payload
    application.revision_token_hash = None
    application.revision_requested_at = None
    application.revision_expires_at = None
    application.reviewed_by_user_id = None
    application.reviewed_at = None
    record_application_event(
        db, application=application, to_status="under_review",
        actor_user_id=application.user_id, comment="Кандидат отправил исправленную заявку",
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=application.user_id, action="application.revised",
        target_type="application", target_id=application.id,
        details={"from": previous, "to": "under_review"},
    )
    await db.commit()
    return {"id": application.id, "status": application.status, "updated_at": application.updated_at}


@router.post("/public/invitations/{token}/accept")
async def accept_accelerator_invitation(
    token: str,
    payload: InvitationAccept,
    db: AsyncSession = Depends(get_async_db),
):
    user = await accept_invitation(db, token, payload.password)
    await db.commit()
    return {"status": "accepted", "email": user.email}


@router.get("/cohorts/{cohort_id}/residents")
async def list_residents(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    access_role = await require_cohort_reader(db, user, cohort)
    query = (
        select(AcceleratorMembership, User)
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(AcceleratorMembership.cohort_id == cohort.id, AcceleratorMembership.role == "resident")
        .order_by(AcceleratorMembership.created_at.desc())
    )
    if access_role == "tracker":
        assigned_ids = await tracker_membership_ids(db, user.id, cohort.id)
        query = query.where(AcceleratorMembership.id.in_(assigned_ids))
    rows = (await db.execute(query)).all()
    result = []
    for membership, resident in rows:
        trackers = (await db.execute(
            select(User.id, User.name)
            .join(
                AcceleratorTrackerAssignment,
                AcceleratorTrackerAssignment.tracker_user_id == User.id,
            )
            .where(AcceleratorTrackerAssignment.membership_id == membership.id)
            .order_by(User.name)
        )).all()
        result.append({
            "membership_id": membership.id,
            "user_id": resident.id,
            "name": resident.name,
            "email": resident.email,
            "status": membership.status,
            "status_reason": membership.status_reason,
            "accepted_at": membership.accepted_at,
            "enrolled_at": membership.enrolled_at,
            "suspended_at": membership.suspended_at,
            "ended_at": membership.ended_at,
            "trackers": [{"user_id": tracker_id, "name": name} for tracker_id, name in trackers],
        })
    return result


@router.patch("/memberships/{membership_id}/status")
async def update_membership_status(
    membership_id: int,
    payload: MembershipStatusUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == membership_id
    ).with_for_update())).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_cohort_manager(db, user, cohort)
    previous = membership.status
    if payload.status == previous:
        return {"membership_id": membership.id, "status": membership.status}
    if payload.status not in MEMBERSHIP_STATUS_TRANSITIONS.get(previous, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Нельзя перевести резидента из статуса «{previous}» в «{payload.status}»",
        )
    now = datetime.utcnow()
    membership.status = payload.status
    membership.status_reason = payload.reason.strip()
    membership.status_changed_by_user_id = user.id
    if payload.status == "enrolled":
        membership.enrolled_at = membership.enrolled_at or now
        membership.suspended_at = None
        membership.ended_at = None
        if previous == "accepted" and cohort.default_quota_config:
            await assign_quota_override(
                db,
                membership=membership,
                source="cohort",
                limits=cohort.default_quota_config,
                created_by_user_id=(
                    cohort.default_quota_updated_by_user_id or cohort.created_by_user_id
                ),
                starts_at=membership.enrolled_at,
                ends_at=cohort.ends_at,
                reason="Шаблон лимитов потока при зачислении",
            )
    elif payload.status == "suspended":
        membership.suspended_at = now
        membership.ended_at = None
    elif payload.status in ("completed", "withdrawn"):
        membership.ended_at = now
        membership.suspended_at = None
    db.add(AcceleratorMembershipEvent(
        membership_id=membership.id,
        from_status=previous,
        to_status=payload.status,
        actor_user_id=user.id,
        reason=membership.status_reason,
    ))
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="resident.status_changed", target_type="membership",
        target_id=membership.id,
        details={"from": previous, "to": payload.status, "reason": membership.status_reason},
    )
    await db.commit()
    return {
        "membership_id": membership.id,
        "status": membership.status,
        "status_reason": membership.status_reason,
        "suspended_at": membership.suspended_at,
        "ended_at": membership.ended_at,
    }


@router.get("/memberships/{membership_id}/lifecycle-events")
async def list_membership_events(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership:
        raise HTTPException(status_code=404, detail="Резидент не найден")
    if user.id != membership.user_id:
        await require_tracker_membership_access(db, user, membership)
    rows = (await db.execute(select(AcceleratorMembershipEvent).where(
        AcceleratorMembershipEvent.membership_id == membership.id
    ).order_by(AcceleratorMembershipEvent.created_at))).scalars().all()
    return [{
        "id": row.id,
        "from_status": row.from_status,
        "to_status": row.to_status,
        "actor_user_id": row.actor_user_id,
        "reason": row.reason,
        "created_at": row.created_at,
    } for row in rows]


@router.get("/cohorts/{cohort_id}/report")
async def cohort_resident_report(
    cohort_id: int,
    format: str = Query(default="json", pattern="^(json|csv)$"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    access_role = await require_cohort_reader(db, user, cohort)
    membership_query = (
        select(AcceleratorMembership, User)
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorMembership.role == "resident",
        )
        .order_by(User.name, User.email)
    )
    if access_role == "tracker":
        membership_query = membership_query.where(
            AcceleratorMembership.id.in_(await tracker_membership_ids(db, user.id, cohort.id))
        )
    membership_rows = (await db.execute(membership_query)).all()
    membership_ids = [membership.id for membership, _ in membership_rows]

    stage_ids = list((await db.execute(select(AcceleratorProgramStage.id).where(
        AcceleratorProgramStage.cohort_id == cohort.id,
        AcceleratorProgramStage.status == "published",
    ))).scalars().all())
    stage_progress = set((await db.execute(select(
        AcceleratorProgramStageProgress.membership_id,
        AcceleratorProgramStageProgress.stage_id,
    ).where(
        AcceleratorProgramStageProgress.membership_id.in_(membership_ids),
        AcceleratorProgramStageProgress.stage_id.in_(stage_ids),
    ))).all()) if membership_ids and stage_ids else set()

    assignments = list((await db.execute(select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.cohort_id == cohort.id,
        AcceleratorHomeworkAssignment.status == "published",
    ))).scalars().all())
    assignment_ids = [row.id for row in assignments]
    targets = set((await db.execute(select(
        AcceleratorHomeworkTarget.assignment_id,
        AcceleratorHomeworkTarget.membership_id,
    ).where(AcceleratorHomeworkTarget.assignment_id.in_(assignment_ids)))).all()) if assignment_ids else set()
    submissions = {
        (row.assignment_id, row.membership_id): row
        for row in (await db.execute(select(AcceleratorHomeworkSubmission).where(
            AcceleratorHomeworkSubmission.assignment_id.in_(assignment_ids),
            AcceleratorHomeworkSubmission.membership_id.in_(membership_ids),
        ))).scalars().all()
    } if assignment_ids and membership_ids else {}

    event_ids = list((await db.execute(select(AcceleratorEvent.id).where(
        AcceleratorEvent.cohort_id == cohort.id,
        AcceleratorEvent.status == "published",
    ))).scalars().all())
    attendance = {
        (row.event_id, row.membership_id): row
        for row in (await db.execute(select(AcceleratorAttendanceRecord).where(
            AcceleratorAttendanceRecord.event_id.in_(event_ids),
            AcceleratorAttendanceRecord.membership_id.in_(membership_ids),
        ))).scalars().all()
    } if event_ids and membership_ids else {}

    tracker_rows = (await db.execute(
        select(AcceleratorTrackerAssignment.membership_id, User.id, User.name)
        .join(User, User.id == AcceleratorTrackerAssignment.tracker_user_id)
        .where(AcceleratorTrackerAssignment.membership_id.in_(membership_ids))
    )).all() if membership_ids else []
    trackers_by_membership: dict[int, list[dict]] = {}
    for assigned_membership_id, tracker_id, tracker_name in tracker_rows:
        trackers_by_membership.setdefault(assigned_membership_id, []).append({
            "user_id": tracker_id, "name": tracker_name,
        })

    now = datetime.utcnow()
    rows = []
    for membership, resident in membership_rows:
        applicable = [
            assignment for assignment in assignments
            if assignment.audience == "cohort" or (assignment.id, membership.id) in targets
        ]
        accepted_homework = 0
        waiting_homework = 0
        overdue_homework = 0
        activity_dates = [membership.updated_at, membership.enrolled_at, membership.accepted_at]
        for assignment in applicable:
            submission = submissions.get((assignment.id, membership.id))
            if submission:
                activity_dates.append(submission.submitted_at)
                if submission.status == "accepted":
                    accepted_homework += 1
                elif submission.status == "submitted":
                    waiting_homework += 1
            if assignment.due_at and assignment.due_at < now and (
                not submission or submission.status == "needs_revision"
            ):
                overdue_homework += 1
        present = 0
        marked = 0
        for event_id in event_ids:
            record = attendance.get((event_id, membership.id))
            if record:
                marked += 1
                activity_dates.append(record.checked_in_at or record.updated_at)
                present += int(record.status == "present")
        completed_stages = sum((membership.id, stage_id) in stage_progress for stage_id in stage_ids)
        quota = {}
        for resource in ("messages", "roadmaps", "custdev", "grants"):
            snapshot = await accelerator_membership_quota_snapshot(db, membership.id, resource)
            if snapshot:
                quota[resource] = {
                    "limit": snapshot["limit"], "used": snapshot["used"],
                    "remaining": snapshot["remaining"], "source": snapshot["override"].source,
                }
        activity_dates = [value for value in activity_dates if value is not None]
        rows.append({
            "membership_id": membership.id,
            "user_id": resident.id,
            "name": resident.name,
            "email": resident.email,
            "status": membership.status,
            "status_reason": membership.status_reason,
            "trackers": trackers_by_membership.get(membership.id, []),
            "program": {
                "completed": completed_stages,
                "total": len(stage_ids),
                "percent": round(completed_stages * 100 / len(stage_ids)) if stage_ids else 0,
            },
            "homework": {
                "accepted": accepted_homework,
                "waiting_review": waiting_homework,
                "overdue": overdue_homework,
                "total": len(applicable),
            },
            "attendance": {"present": present, "marked": marked, "total": len(event_ids)},
            "quota": quota,
            "last_activity_at": max(activity_dates) if activity_dates else None,
        })

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output, delimiter=";")
        writer.writerow([
            "Резидент", "Email", "Статус", "Трекеры", "Программа, %",
            "Домашние задания зачтено", "Просрочено", "Посещено", "Всего событий",
            "Сообщения лимит", "Сообщения использовано", "Дорожные карты лимит",
            "Дорожные карты использовано", "Кастдевы лимит", "Кастдевы использовано",
            "Гранты лимит", "Гранты использовано",
            "Последняя активность",
        ])
        for row in rows:
            def quota_value(resource: str, key: str):
                return row["quota"].get(resource, {}).get(key, "")

            writer.writerow([
                row["name"], row["email"], row["status"],
                ", ".join(tracker["name"] for tracker in row["trackers"]),
                row["program"]["percent"], row["homework"]["accepted"],
                row["homework"]["overdue"], row["attendance"]["present"],
                row["attendance"]["total"],
                quota_value("messages", "limit"), quota_value("messages", "used"),
                quota_value("roadmaps", "limit"), quota_value("roadmaps", "used"),
                quota_value("custdev", "limit"), quota_value("custdev", "used"),
                quota_value("grants", "limit"), quota_value("grants", "used"),
                row["last_activity_at"].isoformat() if row["last_activity_at"] else "",
            ])
        return Response(
            content="\ufeff" + output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="cohort-{cohort.id}-report.csv"'},
        )
    return {
        "cohort_id": cohort.id,
        "access_role": access_role,
        "summary": {
            "residents": len(rows),
            "enrolled": sum(row["status"] == "enrolled" for row in rows),
            "suspended": sum(row["status"] == "suspended" for row in rows),
            "completed": sum(row["status"] == "completed" for row in rows),
            "overdue_homework": sum(row["homework"]["overdue"] for row in rows),
        },
        "rows": rows,
    }


async def tracking_membership_context(
    db: AsyncSession, membership_id: int, user: User
) -> tuple[AcceleratorMembership, AcceleratorCohort, str]:
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident":
        raise HTTPException(status_code=404, detail="Резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_progress_tracking_module(db, cohort)
    if membership.user_id == user.id:
        return membership, cohort, "resident"
    return membership, cohort, await require_tracker_membership_access(db, user, membership)


def tracking_task_dict(task: AcceleratorTrackingTask) -> dict:
    return {
        "id": task.id,
        "membership_id": task.membership_id,
        "created_by_user_id": task.created_by_user_id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "due_at": task.due_at,
        "completed_at": task.completed_at,
        "completed_by_user_id": task.completed_by_user_id,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


async def membership_tracking_risk(
    db: AsyncSession, membership: AcceleratorMembership
) -> dict:
    now = datetime.utcnow()
    current_week = date.today() - timedelta(days=date.today().weekday())
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == membership.cohort_id
    ))).scalar_one_or_none()
    modules = (config.modules or {}) if config else {}
    latest_checkin = (await db.execute(
        select(AcceleratorProgressCheckin)
        .where(AcceleratorProgressCheckin.membership_id == membership.id)
        .order_by(AcceleratorProgressCheckin.period_start.desc())
        .limit(1)
    )).scalar_one_or_none()

    assignments = list((await db.execute(select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.cohort_id == membership.cohort_id,
        AcceleratorHomeworkAssignment.status == "published",
        AcceleratorHomeworkAssignment.due_at.is_not(None),
        AcceleratorHomeworkAssignment.due_at < now,
    ))).scalars().all()) if modules.get("homework") else []
    overdue_homework = 0
    for assignment in assignments:
        if assignment.audience == "selected":
            targeted = (await db.execute(select(AcceleratorHomeworkTarget.id).where(
                AcceleratorHomeworkTarget.assignment_id == assignment.id,
                AcceleratorHomeworkTarget.membership_id == membership.id,
            ))).scalar_one_or_none()
            if targeted is None:
                continue
        accepted_or_waiting = (await db.execute(select(AcceleratorHomeworkSubmission.id).where(
            AcceleratorHomeworkSubmission.assignment_id == assignment.id,
            AcceleratorHomeworkSubmission.membership_id == membership.id,
            AcceleratorHomeworkSubmission.status.in_(("submitted", "accepted")),
        ))).scalar_one_or_none()
        overdue_homework += int(accepted_or_waiting is None)

    overdue_tasks = (await db.execute(select(func.count(AcceleratorTrackingTask.id)).where(
        AcceleratorTrackingTask.membership_id == membership.id,
        AcceleratorTrackingTask.status == "open",
        AcceleratorTrackingTask.due_at.is_not(None),
        AcceleratorTrackingTask.due_at < now,
    ))).scalar_one()
    past_event_ids = list((await db.execute(select(AcceleratorEvent.id).where(
        AcceleratorEvent.cohort_id == membership.cohort_id,
        AcceleratorEvent.status == "published",
        AcceleratorEvent.ends_at < now,
    ))).scalars().all()) if modules.get("attendance") else []
    present_count = (await db.execute(select(func.count(AcceleratorAttendanceRecord.id)).where(
        AcceleratorAttendanceRecord.membership_id == membership.id,
        AcceleratorAttendanceRecord.event_id.in_(past_event_ids),
        AcceleratorAttendanceRecord.status == "present",
    ))).scalar_one() if past_event_ids else 0

    activity_values = [membership.updated_at, membership.enrolled_at, membership.accepted_at]
    for model, field in (
        (AcceleratorProgressCheckin, AcceleratorProgressCheckin.created_at),
        (AcceleratorHomeworkSubmission, AcceleratorHomeworkSubmission.submitted_at),
        (AcceleratorAttendanceRecord, AcceleratorAttendanceRecord.updated_at),
        (AcceleratorProgramStageProgress, AcceleratorProgramStageProgress.completed_at),
    ):
        latest = (await db.execute(select(func.max(field)).where(
            model.membership_id == membership.id
        ))).scalar_one()
        activity_values.append(latest)
    activity_values = [value for value in activity_values if value is not None]
    last_activity_at = max(activity_values) if activity_values else None
    inactive_days = (now - last_activity_at).days if last_activity_at else 999
    attendance_total = len(past_event_ids)
    attendance_percent = round(present_count * 100 / attendance_total) if attendance_total else 100

    red_reasons: list[str] = []
    yellow_reasons: list[str] = []
    if inactive_days >= 14:
        red_reasons.append(f"Нет активности {inactive_days} дней")
    elif inactive_days >= 7:
        yellow_reasons.append(f"Нет активности {inactive_days} дней")
    if overdue_tasks:
        red_reasons.append(f"Просрочено задач: {overdue_tasks}")
    if overdue_homework >= 2:
        red_reasons.append(f"Просрочено домашних заданий: {overdue_homework}")
    elif overdue_homework == 1:
        yellow_reasons.append("Просрочено домашнее задание")
    if attendance_total >= 2 and attendance_percent < 50:
        red_reasons.append(f"Посещаемость {attendance_percent}%")
    elif attendance_total and present_count < attendance_total:
        yellow_reasons.append(f"Посещаемость {attendance_percent}%")
    if latest_checkin and latest_checkin.health == "red":
        red_reasons.append("Резидент отметил критическое состояние")
    elif latest_checkin and latest_checkin.health == "yellow":
        yellow_reasons.append("Резидент отметил сложности")
    if latest_checkin and latest_checkin.period_start < current_week:
        yellow_reasons.append("Нет чек-ина за текущую неделю")
    elif not latest_checkin and membership.enrolled_at and (now - membership.enrolled_at).days >= 7:
        yellow_reasons.append("Первый чек-ин ещё не заполнен")
    level = "red" if red_reasons else "yellow" if yellow_reasons else "green"
    return {
        "level": level,
        "reasons": red_reasons + yellow_reasons,
        "last_activity_at": last_activity_at,
        "inactive_days": inactive_days,
        "overdue_homework": overdue_homework,
        "overdue_tasks": int(overdue_tasks or 0),
        "attendance_percent": attendance_percent,
        "last_checkin_at": latest_checkin.created_at if latest_checkin else None,
        "last_checkin_health": latest_checkin.health if latest_checkin else None,
    }


@router.get("/cohorts/{cohort_id}/tracking-dashboard")
async def tracking_dashboard(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_progress_tracking_module(db, cohort)
    report = await cohort_resident_report(cohort_id, "json", user, db)
    rows = []
    for report_row in report["rows"]:
        membership = await db.get(AcceleratorMembership, report_row["membership_id"])
        risk = await membership_tracking_risk(db, membership)
        open_tasks = (await db.execute(select(func.count(AcceleratorTrackingTask.id)).where(
            AcceleratorTrackingTask.membership_id == membership.id,
            AcceleratorTrackingTask.status == "open",
        ))).scalar_one()
        rows.append({**report_row, "risk": risk, "open_tasks": int(open_tasks or 0)})
    return {
        "cohort_id": cohort.id,
        "access_role": report["access_role"],
        "summary": {
            "residents": len(rows),
            "green": sum(row["risk"]["level"] == "green" for row in rows),
            "yellow": sum(row["risk"]["level"] == "yellow" for row in rows),
            "red": sum(row["risk"]["level"] == "red" for row in rows),
            "overdue_tasks": sum(row["risk"]["overdue_tasks"] for row in rows),
        },
        "rows": rows,
    }


@router.get("/memberships/{membership_id}/tracking")
async def membership_tracking(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership, _, access_role = await tracking_membership_context(db, membership_id, user)
    checkins = (await db.execute(
        select(AcceleratorProgressCheckin, User)
        .join(User, User.id == AcceleratorProgressCheckin.author_user_id)
        .where(AcceleratorProgressCheckin.membership_id == membership.id)
        .order_by(AcceleratorProgressCheckin.period_start.desc())
    )).all()
    feedback = (await db.execute(
        select(AcceleratorTrackingFeedback, User)
        .join(User, User.id == AcceleratorTrackingFeedback.author_user_id)
        .where(AcceleratorTrackingFeedback.membership_id == membership.id)
        .order_by(AcceleratorTrackingFeedback.created_at.desc())
    )).all()
    tasks = (await db.execute(select(AcceleratorTrackingTask).where(
        AcceleratorTrackingTask.membership_id == membership.id
    ).order_by(
        AcceleratorTrackingTask.status != "open",
        AcceleratorTrackingTask.due_at.is_(None),
        AcceleratorTrackingTask.due_at,
        AcceleratorTrackingTask.created_at.desc(),
    ))).scalars().all()
    return {
        "membership_id": membership.id,
        "access_role": access_role,
        "risk": await membership_tracking_risk(db, membership),
        "checkins": [{
            "id": row.id, "period_start": row.period_start, "health": row.health,
            "summary": row.summary, "blockers": row.blockers, "next_steps": row.next_steps,
            "help_needed": row.help_needed, "created_at": row.created_at,
            "author": {"id": author.id, "name": author.name},
        } for row, author in checkins],
        "feedback": [{
            "id": row.id, "body": row.body, "created_at": row.created_at,
            "author": {"id": author.id, "name": author.name},
        } for row, author in feedback],
        "tasks": [tracking_task_dict(row) for row in tasks],
    }


@router.post("/memberships/{membership_id}/checkins")
async def upsert_progress_checkin(
    membership_id: int,
    payload: ProgressCheckinUpsert,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership, cohort, access_role = await tracking_membership_context(db, membership_id, user)
    if access_role != "resident" or membership.status != "enrolled":
        raise HTTPException(status_code=403, detail="Чек-ин заполняет сам зачисленный резидент")
    today = date.today()
    requested_period = payload.period_start or today
    if requested_period > today or requested_period < today - timedelta(days=31):
        raise HTTPException(status_code=422, detail="Чек-ин можно заполнить только за последние 31 день")
    period_start = requested_period - timedelta(days=requested_period.weekday())
    checkin = (await db.execute(select(AcceleratorProgressCheckin).where(
        AcceleratorProgressCheckin.membership_id == membership.id,
        AcceleratorProgressCheckin.period_start == period_start,
    ).with_for_update())).scalar_one_or_none()
    if not checkin:
        checkin = AcceleratorProgressCheckin(
            membership_id=membership.id, author_user_id=user.id, period_start=period_start,
            summary=payload.summary, next_steps=payload.next_steps,
        )
        db.add(checkin)
    checkin.health = payload.health
    checkin.summary = payload.summary
    checkin.blockers = payload.blockers
    checkin.next_steps = payload.next_steps
    checkin.help_needed = payload.help_needed
    await db.flush()
    tracker_rows = (await db.execute(
        select(User)
        .join(AcceleratorTrackerAssignment, AcceleratorTrackerAssignment.tracker_user_id == User.id)
        .where(AcceleratorTrackerAssignment.membership_id == membership.id)
    )).scalars().all()
    notification_ids = []
    for tracker in tracker_rows:
        notification = await enqueue_notification(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            recipient_email=tracker.email, event_type="progress_checkin_submitted",
            subject=f"Новый чек-ин: {user.name}",
            body=f"{user.name} заполнил чек-ин за неделю {period_start.isoformat()}.\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
            idempotency_key=f"progress-checkin:{checkin.id}:{checkin.updated_at.isoformat()}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="tracking.checkin_upserted",
        target_type="progress_checkin", target_id=checkin.id,
        details={"membership_id": membership.id, "health": checkin.health},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return {"id": checkin.id, "period_start": checkin.period_start, "health": checkin.health}


@router.post("/memberships/{membership_id}/tracking-feedback")
async def create_tracking_feedback(
    membership_id: int,
    payload: TrackingFeedbackCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership, cohort, access_role = await tracking_membership_context(db, membership_id, user)
    if access_role == "resident":
        raise HTTPException(status_code=403, detail="Обратную связь оставляет трекер или организатор")
    if membership.status not in ("enrolled", "suspended"):
        raise HTTPException(status_code=409, detail="Обратная связь доступна только активному резиденту")
    feedback = AcceleratorTrackingFeedback(
        membership_id=membership.id, author_user_id=user.id, body=payload.body
    )
    db.add(feedback)
    await db.flush()
    resident = await db.get(User, membership.user_id)
    notification = await enqueue_notification(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        recipient_email=resident.email, event_type="tracking_feedback_created",
        subject="Новая обратная связь от трекера",
        body=f"Здравствуйте, {resident.name}!\n\n{payload.body}\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
        idempotency_key=f"tracking-feedback:{feedback.id}",
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="tracking.feedback_created",
        target_type="tracking_feedback", target_id=feedback.id,
        details={"membership_id": membership.id},
    )
    await db.commit()
    background_tasks.add_task(process_notification_event, notification.id)
    return {"id": feedback.id, "body": feedback.body, "created_at": feedback.created_at}


@router.post("/memberships/{membership_id}/tracking-tasks")
async def create_tracking_task(
    membership_id: int,
    payload: TrackingTaskCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership, cohort, access_role = await tracking_membership_context(db, membership_id, user)
    if access_role == "resident":
        raise HTTPException(status_code=403, detail="Задачу создаёт трекер или организатор")
    if membership.status != "enrolled":
        raise HTTPException(status_code=409, detail="Задачи можно назначать только активному резиденту")
    if payload.due_at and payload.due_at <= datetime.utcnow():
        raise HTTPException(status_code=422, detail="Срок задачи должен быть в будущем")
    task = AcceleratorTrackingTask(
        membership_id=membership.id, created_by_user_id=user.id,
        title=payload.title.strip(), description=(payload.description or "").strip() or None,
        due_at=payload.due_at,
    )
    db.add(task)
    await db.flush()
    resident = await db.get(User, membership.user_id)
    notification = await enqueue_notification(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        recipient_email=resident.email, event_type="tracking_task_created",
        subject=f"Новая задача: {task.title}",
        body=f"Здравствуйте, {resident.name}!\n\nВам назначена задача «{task.title}».\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
        idempotency_key=f"tracking-task-created:{task.id}",
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="tracking.task_created",
        target_type="tracking_task", target_id=task.id,
        details={"membership_id": membership.id, "due_at": task.due_at.isoformat() if task.due_at else None},
    )
    await db.commit()
    background_tasks.add_task(process_notification_event, notification.id)
    return tracking_task_dict(task)


@router.patch("/tracking-tasks/{task_id}")
async def update_tracking_task(
    task_id: int,
    payload: TrackingTaskUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    task = (await db.execute(select(AcceleratorTrackingTask).where(
        AcceleratorTrackingTask.id == task_id
    ).with_for_update())).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    membership, cohort, access_role = await tracking_membership_context(db, task.membership_id, user)
    if access_role == "resident" and membership.status != "enrolled":
        raise HTTPException(status_code=403, detail="Задачи доступны только активному резиденту")
    if access_role == "resident" and payload.status == "cancelled":
        raise HTTPException(status_code=403, detail="Резидент не может отменить задачу")
    previous = task.status
    allowed = {
        "open": {"done", "cancelled"},
        "done": {"open"},
        "cancelled": {"open"},
    }
    if payload.status != previous and payload.status not in allowed.get(previous, set()):
        raise HTTPException(status_code=409, detail="Недопустимый переход статуса задачи")
    if payload.status == previous:
        return tracking_task_dict(task)
    task.status = payload.status
    if payload.status == "done":
        task.completed_at = datetime.utcnow()
        task.completed_by_user_id = user.id
    else:
        task.completed_at = None
        task.completed_by_user_id = None
    await db.flush()
    resident = await db.get(User, membership.user_id)
    tracker_rows = (await db.execute(
        select(User)
        .join(AcceleratorTrackerAssignment, AcceleratorTrackerAssignment.tracker_user_id == User.id)
        .where(AcceleratorTrackerAssignment.membership_id == membership.id)
    )).scalars().all()
    creator = await db.get(User, task.created_by_user_id)
    recipients = {
        row.id: row for row in ([resident, creator] + list(tracker_rows))
        if row and row.id != user.id and row.is_active and row.deleted_at is None
    }
    status_label = {"open": "возвращена в работу", "done": "выполнена", "cancelled": "отменена"}[task.status]
    notification_ids = []
    for recipient in recipients.values():
        notification = await enqueue_notification(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            recipient_email=recipient.email, event_type="tracking_task_status_changed",
            subject=f"Задача {status_label}: {task.title}",
            body=(
                f"Пользователь {user.name} изменил статус задачи «{task.title}»: {status_label}."
                f"\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator"
            ),
            idempotency_key=f"tracking-task-status:{task.id}:{task.updated_at.isoformat()}:{recipient.id}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="tracking.task_status_changed",
        target_type="tracking_task", target_id=task.id,
        details={"membership_id": membership.id, "from": previous, "to": task.status},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return tracking_task_dict(task)


PROJECT_AUDIT_TYPE_LABELS = {
    "product": "Продукт",
    "market": "Рынок",
    "custdev": "CustDev",
    "business_model": "Бизнес-модель",
    "grant": "Грантовая готовность",
}


async def project_audit_membership_context(
    db: AsyncSession, membership_id: int, user: User
) -> tuple[AcceleratorMembership, AcceleratorCohort, str]:
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident":
        raise HTTPException(status_code=404, detail="Резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_project_audit_module(db, cohort)
    if membership.user_id == user.id:
        access_role = "resident"
    else:
        access_role = await require_tracker_membership_access(db, user, membership)
    if membership.status != "enrolled":
        raise HTTPException(status_code=409, detail="Аудит доступен только зачисленному резиденту")
    return membership, cohort, access_role


async def project_audit_input_snapshot(
    db: AsyncSession, membership: AcceleratorMembership
) -> tuple[Project, dict]:
    if not membership.project_id:
        raise HTTPException(
            status_code=409,
            detail="Для аудита резиденту необходимо привязать паспорт проекта",
        )
    project = await db.get(Project, membership.project_id)
    if not project or project.user_id != membership.user_id:
        raise HTTPException(status_code=409, detail="Паспорт проекта резидента недоступен")
    application = await db.get(AcceleratorApplication, membership.application_id)
    checkins = (await db.execute(
        select(AcceleratorProgressCheckin).where(
            AcceleratorProgressCheckin.membership_id == membership.id
        ).order_by(AcceleratorProgressCheckin.period_start.desc()).limit(6)
    )).scalars().all()
    return project, {
        "project": {
            "id": project.id,
            "name": project.name,
            "readiness_index": project.readiness_index,
            "passport": project.passport or {},
            "passport_updated_at": (
                project.passport_updated_at.isoformat() if project.passport_updated_at else None
            ),
        },
        "application": {
            "type": application.application_type if application else None,
            "answers": application.form_payload if application else {},
        },
        "recent_checkins": [{
            "period_start": row.period_start.isoformat(),
            "health": row.health,
            "summary": row.summary,
            "blockers": row.blockers,
            "next_steps": row.next_steps,
            "help_needed": row.help_needed,
        } for row in checkins],
    }


def project_audit_comparison(current: AcceleratorProjectAudit, previous: AcceleratorProjectAudit | None) -> dict | None:
    if not previous or current.status != "completed" or previous.status != "completed":
        return None
    current_result = current.result or {}
    previous_result = previous.result or {}
    current_findings = {
        str(item.get("title", "")).strip() for item in current_result.get("findings", [])
        if str(item.get("title", "")).strip()
    }
    previous_findings = {
        str(item.get("title", "")).strip() for item in previous_result.get("findings", [])
        if str(item.get("title", "")).strip()
    }
    return {
        "previous_audit_id": previous.id,
        "score_delta": (current.overall_score or 0) - (previous.overall_score or 0),
        "new_findings": sorted(current_findings - previous_findings),
        "resolved_findings": sorted(previous_findings - current_findings),
    }


async def project_audit_dict(
    db: AsyncSession,
    row: AcceleratorProjectAudit,
    previous: AcceleratorProjectAudit | None = None,
) -> dict:
    membership = await db.get(AcceleratorMembership, row.membership_id)
    resident = await db.get(User, membership.user_id) if membership else None
    requester = await db.get(User, row.requested_by_user_id)
    project = await db.get(Project, row.project_id)
    links = (await db.execute(
        select(AcceleratorProjectAuditTaskLink, AcceleratorTrackingTask)
        .join(
            AcceleratorTrackingTask,
            AcceleratorTrackingTask.id == AcceleratorProjectAuditTaskLink.tracking_task_id,
        )
        .where(AcceleratorProjectAuditTaskLink.audit_id == row.id)
        .order_by(AcceleratorProjectAuditTaskLink.recommendation_index)
    )).all()
    return {
        "id": row.id,
        "cohort_id": row.cohort_id,
        "membership_id": row.membership_id,
        "project": {"id": project.id, "name": project.name} if project else None,
        "resident": {"id": resident.id, "name": resident.name} if resident else None,
        "requested_by": {"id": requester.id, "name": requester.name} if requester else None,
        "audit_type": row.audit_type,
        "audit_type_label": PROJECT_AUDIT_TYPE_LABELS.get(row.audit_type, row.audit_type),
        "focus": row.focus,
        "status": row.status,
        "result": row.result,
        "overall_score": row.overall_score,
        "error_message": row.error_message,
        "quota": {
            "resource": row.quota_resource,
            "consumed": row.quota_usage_event_id is not None,
        },
        "linked_tasks": [{
            "recommendation_index": link.recommendation_index,
            "task": tracking_task_dict(task),
        } for link, task in links],
        "comparison": project_audit_comparison(row, previous),
        "completed_at": row.completed_at,
        "created_at": row.created_at,
    }


def previous_project_audit(
    rows: list[AcceleratorProjectAudit], index: int
) -> AcceleratorProjectAudit | None:
    current = rows[index]
    return next((
        candidate for candidate in rows[index + 1:]
        if candidate.membership_id == current.membership_id
        and candidate.audit_type == current.audit_type
        and candidate.status == "completed"
    ), None)


@router.get("/cohorts/{cohort_id}/project-audits")
async def list_cohort_project_audits(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_project_audit_module(db, cohort)
    access_role = await require_cohort_reader(db, user, cohort)
    query = (
        select(AcceleratorProjectAudit)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorProjectAudit.membership_id,
        )
        .where(AcceleratorProjectAudit.cohort_id == cohort.id)
        .order_by(AcceleratorProjectAudit.created_at.desc())
        .limit(300)
    )
    if access_role == "tracker":
        allowed_ids = await tracker_membership_ids(db, user.id, cohort.id)
        query = query.where(AcceleratorProjectAudit.membership_id.in_(allowed_ids))
    rows = list((await db.execute(query)).scalars().all())
    return {
        "access_role": access_role,
        "audits": [
            await project_audit_dict(db, row, previous_project_audit(rows, index))
            for index, row in enumerate(rows)
        ],
    }


@router.get("/memberships/{membership_id}/project-audits")
async def list_membership_project_audits(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    _, _, access_role = await project_audit_membership_context(db, membership_id, user)
    rows = list((await db.execute(
        select(AcceleratorProjectAudit).where(
            AcceleratorProjectAudit.membership_id == membership_id
        ).order_by(AcceleratorProjectAudit.created_at.desc()).limit(100)
    )).scalars().all())
    return {
        "access_role": access_role,
        "audits": [
            await project_audit_dict(db, row, previous_project_audit(rows, index))
            for index, row in enumerate(rows)
        ],
    }


@router.get("/project-audits/{audit_id}")
async def get_project_audit(
    audit_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = await db.get(AcceleratorProjectAudit, audit_id)
    if not row:
        raise HTTPException(status_code=404, detail="Аудит не найден")
    await project_audit_membership_context(db, row.membership_id, user)
    previous = (await db.execute(
        select(AcceleratorProjectAudit).where(
            AcceleratorProjectAudit.membership_id == row.membership_id,
            AcceleratorProjectAudit.audit_type == row.audit_type,
            AcceleratorProjectAudit.status == "completed",
            AcceleratorProjectAudit.created_at < row.created_at,
        ).order_by(AcceleratorProjectAudit.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    return await project_audit_dict(db, row, previous)


@router.post("/memberships/{membership_id}/project-audits")
async def create_project_audit(
    membership_id: int,
    payload: ProjectAuditCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership, cohort, _ = await project_audit_membership_context(db, membership_id, user)
    existing = (await db.execute(select(AcceleratorProjectAudit).where(
        AcceleratorProjectAudit.membership_id == membership.id,
        AcceleratorProjectAudit.client_request_id == payload.client_request_id,
    ))).scalar_one_or_none()
    if existing:
        return await project_audit_dict(db, existing)

    project, input_snapshot = await project_audit_input_snapshot(db, membership)
    quota = await accelerator_membership_quota_snapshot(db, membership.id, "custdev")
    if quota and quota["limit"] != -1 and quota["remaining"] == 0:
        raise HTTPException(
            status_code=402,
            detail=f"quota_exceeded: лимит резидента custdev исчерпан ({quota['limit']})",
        )
    row = AcceleratorProjectAudit(
        cohort_id=cohort.id,
        membership_id=membership.id,
        project_id=project.id,
        requested_by_user_id=user.id,
        client_request_id=payload.client_request_id,
        audit_type=payload.audit_type,
        focus=payload.focus,
        input_snapshot=input_snapshot,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(select(AcceleratorProjectAudit).where(
            AcceleratorProjectAudit.membership_id == membership_id,
            AcceleratorProjectAudit.client_request_id == payload.client_request_id,
        ))).scalar_one_or_none()
        if existing:
            return await project_audit_dict(db, existing)
        raise
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="project_audit.requested",
        target_type="project_audit", target_id=row.id,
        details={"membership_id": membership.id, "audit_type": row.audit_type},
    )
    await db.commit()

    try:
        generated = await generate_project_audit(
            audit_type=row.audit_type,
            project_snapshot=row.input_snapshot,
            focus=row.focus,
        )
    except Exception:
        logger.exception("Project audit generation failed for audit_id=%s", row.id)
        row.status = "failed"
        row.error_message = "Сервис анализа временно недоступен. Повторите запрос позже."
        add_audit(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            actor_user_id=user.id, action="project_audit.failed",
            target_type="project_audit", target_id=row.id,
            details={"membership_id": membership.id, "reason": "generation_failed"},
        )
        await db.commit()
        raise HTTPException(status_code=503, detail=row.error_message)

    row.result = generated.model_dump(mode="json")
    row.overall_score = generated.overall_score
    row.status = "completed"
    row.completed_at = datetime.utcnow()
    quota_key = f"accelerator-project-audit:{row.id}"
    try:
        consumed = await consume_accelerator_membership_quota(
            db,
            membership_id=membership.id,
            user_id=membership.user_id,
            resource="custdev",
            idempotency_key=quota_key,
            reference_type="accelerator_project_audit",
            reference_id=str(row.id),
            metadata={"audit_type": row.audit_type, "requested_by_user_id": user.id},
        )
    except HTTPException as exc:
        row.status = "failed"
        row.result = None
        row.overall_score = None
        row.completed_at = None
        row.error_message = str(exc.detail)
        add_audit(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            actor_user_id=user.id, action="project_audit.failed",
            target_type="project_audit", target_id=row.id,
            details={"membership_id": membership.id, "reason": "quota_exceeded"},
        )
        await db.commit()
        raise
    if consumed:
        row.quota_usage_event_id = (await db.execute(
            select(AcceleratorQuotaUsageEvent.id).where(
                AcceleratorQuotaUsageEvent.idempotency_key == quota_key
            )
        )).scalar_one()

    resident = await db.get(User, membership.user_id)
    recipients: dict[int, User] = {}
    if resident and resident.id != user.id:
        recipients[resident.id] = resident
    elif resident:
        trackers = (await db.execute(
            select(User)
            .join(
                AcceleratorTrackerAssignment,
                AcceleratorTrackerAssignment.tracker_user_id == User.id,
            )
            .where(AcceleratorTrackerAssignment.membership_id == membership.id)
        )).scalars().all()
        recipients.update({tracker.id: tracker for tracker in trackers if tracker.id != user.id})
    notification_ids = []
    for recipient in recipients.values():
        notification = await enqueue_notification(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            recipient_email=recipient.email, event_type="project_audit_completed",
            subject=f"Готов аудит проекта «{project.name}»",
            body=(
                f"Аудит «{PROJECT_AUDIT_TYPE_LABELS[row.audit_type]}» завершён. "
                f"Итоговая оценка: {row.overall_score}/100.\n\n"
                f"Открыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator"
            ),
            idempotency_key=f"project-audit-completed:{row.id}:{recipient.id}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="project_audit.completed",
        target_type="project_audit", target_id=row.id,
        details={
            "membership_id": membership.id,
            "audit_type": row.audit_type,
            "overall_score": row.overall_score,
            "quota_consumed": consumed,
        },
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return await project_audit_dict(db, row)


@router.post("/project-audits/{audit_id}/tasks")
async def create_project_audit_task(
    audit_id: int,
    payload: ProjectAuditTaskCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = await db.get(AcceleratorProjectAudit, audit_id)
    if not row:
        raise HTTPException(status_code=404, detail="Аудит не найден")
    membership, cohort, access_role = await project_audit_membership_context(
        db, row.membership_id, user
    )
    if access_role == "resident":
        raise HTTPException(status_code=403, detail="Задачу создаёт трекер или организатор")
    await require_progress_tracking_module(db, cohort)
    if row.status != "completed" or not row.result:
        raise HTTPException(status_code=409, detail="Задачу можно создать только из завершённого аудита")
    recommendations = row.result.get("recommendations", [])
    if payload.recommendation_index >= len(recommendations):
        raise HTTPException(status_code=422, detail="Рекомендация не найдена")
    existing = (await db.execute(
        select(AcceleratorProjectAuditTaskLink, AcceleratorTrackingTask)
        .join(
            AcceleratorTrackingTask,
            AcceleratorTrackingTask.id == AcceleratorProjectAuditTaskLink.tracking_task_id,
        )
        .where(
            AcceleratorProjectAuditTaskLink.audit_id == row.id,
            AcceleratorProjectAuditTaskLink.recommendation_index == payload.recommendation_index,
        )
    )).first()
    if existing:
        link, task = existing
        return {
            "audit_id": row.id,
            "recommendation_index": link.recommendation_index,
            "task": tracking_task_dict(task),
        }
    if payload.due_at and payload.due_at <= datetime.utcnow():
        raise HTTPException(status_code=422, detail="Срок задачи должен быть в будущем")
    recommendation = recommendations[payload.recommendation_index]
    task = AcceleratorTrackingTask(
        membership_id=membership.id,
        created_by_user_id=user.id,
        title=str(recommendation.get("title", "Рекомендация аудита"))[:300],
        description=(
            f"{recommendation.get('description', '')}\n\n"
            f"Ожидаемый результат: {recommendation.get('expected_result', 'не указан')}"
        ).strip(),
        due_at=payload.due_at,
    )
    db.add(task)
    await db.flush()
    link = AcceleratorProjectAuditTaskLink(
        audit_id=row.id,
        recommendation_index=payload.recommendation_index,
        tracking_task_id=task.id,
        created_by_user_id=user.id,
    )
    db.add(link)
    resident = await db.get(User, membership.user_id)
    notification = await enqueue_notification(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        recipient_email=resident.email, event_type="project_audit_task_created",
        subject=f"Новая задача по аудиту: {task.title}",
        body=(
            f"По результатам аудита проекта создана задача «{task.title}».\n\n"
            f"Открыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator"
        ),
        idempotency_key=f"project-audit-task:{row.id}:{payload.recommendation_index}",
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="project_audit.task_created",
        target_type="tracking_task", target_id=task.id,
        details={
            "membership_id": membership.id,
            "project_audit_id": row.id,
            "recommendation_index": payload.recommendation_index,
        },
    )
    await db.commit()
    background_tasks.add_task(process_notification_event, notification.id)
    return {
        "audit_id": row.id,
        "recommendation_index": payload.recommendation_index,
        "task": tracking_task_dict(task),
    }


async def demo_day_access(
    db: AsyncSession, demo_day: AcceleratorDemoDay, user: User
) -> tuple[AcceleratorCohort, str]:
    cohort = await get_cohort_or_404(db, demo_day.cohort_id)
    await require_demo_day_module(db, cohort)
    if user.is_admin:
        return cohort, "global_admin"
    if await is_accelerator_organizer(db, user.id, cohort.accelerator_id):
        return cohort, "organizer"
    expert = (await db.execute(select(AcceleratorDemoDayExpert.id).where(
        AcceleratorDemoDayExpert.demo_day_id == demo_day.id,
        AcceleratorDemoDayExpert.user_id == user.id,
    ))).scalar_one_or_none()
    if expert is not None:
        return cohort, "expert"
    resident = (await db.execute(
        select(AcceleratorDemoDayProject.id)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorDemoDayProject.membership_id,
        )
        .where(
            AcceleratorDemoDayProject.demo_day_id == demo_day.id,
            AcceleratorMembership.user_id == user.id,
            AcceleratorMembership.role == "resident",
        )
    )).scalar_one_or_none()
    if resident is not None:
        return cohort, "resident"
    raise HTTPException(status_code=403, detail="Нет доступа к этому демо-дню")


def demo_normalized_score(criteria: list[dict], raw_scores: dict[str, float]) -> float:
    keys = {str(item.get("key")) for item in criteria}
    if set(raw_scores) != keys:
        raise HTTPException(status_code=422, detail="Оцените проект по всем критериям")
    total_weight = sum(float(item.get("weight", 0)) for item in criteria)
    if total_weight <= 0:
        raise HTTPException(status_code=409, detail="Критерии демо-дня настроены некорректно")
    total = 0.0
    for criterion in criteria:
        key = str(criterion["key"])
        value = float(raw_scores[key])
        maximum = float(criterion["max_score"])
        if value < 0 or value > maximum:
            raise HTTPException(
                status_code=422,
                detail=f"Оценка «{criterion['label']}» должна быть от 0 до {maximum:g}",
            )
        total += (value / maximum) * float(criterion["weight"])
    return round(total / total_weight * 100, 2)


async def demo_day_dict(
    db: AsyncSession, demo_day: AcceleratorDemoDay, access_role: str, viewer_id: int
) -> dict:
    expert_rows = (await db.execute(
        select(AcceleratorDemoDayExpert, User)
        .join(User, User.id == AcceleratorDemoDayExpert.user_id)
        .where(AcceleratorDemoDayExpert.demo_day_id == demo_day.id)
        .order_by(User.name, User.email)
    )).all()
    project_rows = (await db.execute(
        select(AcceleratorDemoDayProject, AcceleratorMembership, User, Project)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorDemoDayProject.membership_id,
        )
        .join(User, User.id == AcceleratorMembership.user_id)
        .join(Project, Project.id == AcceleratorDemoDayProject.project_id)
        .where(AcceleratorDemoDayProject.demo_day_id == demo_day.id)
        .order_by(
            AcceleratorDemoDayProject.rank.is_(None),
            AcceleratorDemoDayProject.rank,
            Project.name,
        )
    )).all()
    project_ids = [row.id for row, _, _, _ in project_rows]
    score_rows = []
    if project_ids:
        score_rows = (await db.execute(
            select(AcceleratorDemoDayScore, User)
            .join(User, User.id == AcceleratorDemoDayScore.expert_user_id)
            .where(AcceleratorDemoDayScore.demo_project_id.in_(project_ids))
            .order_by(AcceleratorDemoDayScore.submitted_at)
        )).all()
    scores_by_project: dict[int, list] = {}
    for score, expert in score_rows:
        scores_by_project.setdefault(score.demo_project_id, []).append((score, expert))
    projects = []
    for row, membership, resident, project in project_rows:
        if access_role == "resident" and resident.id != viewer_id:
            continue
        evaluations = scores_by_project.get(row.id, [])
        average = (
            round(sum(float(score.normalized_score) for score, _ in evaluations) / len(evaluations), 2)
            if evaluations else None
        )
        visible_evaluations = []
        for score, expert in evaluations:
            if access_role in ("global_admin", "organizer") or (
                access_role == "expert" and score.expert_user_id == viewer_id
            ):
                visible_evaluations.append({
                    "id": score.id,
                    "expert": {"id": expert.id, "name": expert.name},
                    "scores": score.scores or {},
                    "normalized_score": float(score.normalized_score),
                    "comment": score.comment,
                    "recommendation": score.recommendation,
                    "submitted_at": score.submitted_at,
                })
        projects.append({
            "id": row.id,
            "membership_id": membership.id,
            "resident": {
                "id": resident.id,
                "name": resident.name,
                **({"email": resident.email} if access_role in ("global_admin", "organizer") else {}),
            },
            "project": {
                "id": project.id,
                "name": project.name,
                "readiness_index": project.readiness_index,
            },
            "selection_reason": row.selection_reason,
            "pitch_title": row.pitch_title,
            "summary": row.summary,
            "presentation_url": row.presentation_url,
            "video_url": row.video_url,
            "attachments": row.attachments or [],
            "submitted_at": row.submitted_at,
            "evaluation_count": len(evaluations),
            "average_score": average if access_role in ("global_admin", "organizer") or demo_day.status == "finalized" else None,
            "score_adjustment": float(row.score_adjustment or 0) if access_role in ("global_admin", "organizer") else None,
            "manager_note": row.manager_note if access_role in ("global_admin", "organizer") else None,
            "outcome": row.outcome if access_role in ("global_admin", "organizer") or demo_day.status == "finalized" else None,
            "final_score": float(row.final_score) if row.final_score is not None and demo_day.status == "finalized" else None,
            "rank": row.rank if demo_day.status == "finalized" else None,
            "evaluations": visible_evaluations,
        })
    return {
        "id": demo_day.id,
        "cohort_id": demo_day.cohort_id,
        "title": demo_day.title,
        "description": demo_day.description,
        "starts_at": demo_day.starts_at,
        "criteria": demo_day.criteria or [],
        "status": demo_day.status,
        "access_role": access_role,
        "experts": [{
            "id": assignment.id,
            "user_id": expert.id,
            "name": expert.name,
            **({"email": expert.email} if access_role in ("global_admin", "organizer") else {}),
        } for assignment, expert in expert_rows],
        "projects": projects,
        "finalized_at": demo_day.finalized_at,
        "created_at": demo_day.created_at,
    }


@router.get("/cohorts/{cohort_id}/demo-days")
async def list_cohort_demo_days(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_demo_day_module(db, cohort)
    if user.is_admin:
        access_role = "global_admin"
        query = select(AcceleratorDemoDay).where(AcceleratorDemoDay.cohort_id == cohort.id)
    elif await is_accelerator_organizer(db, user.id, cohort.accelerator_id):
        access_role = "organizer"
        query = select(AcceleratorDemoDay).where(AcceleratorDemoDay.cohort_id == cohort.id)
    else:
        access_role = "expert"
        query = (
            select(AcceleratorDemoDay)
            .join(
                AcceleratorDemoDayExpert,
                AcceleratorDemoDayExpert.demo_day_id == AcceleratorDemoDay.id,
            )
            .where(
                AcceleratorDemoDay.cohort_id == cohort.id,
                AcceleratorDemoDayExpert.user_id == user.id,
            )
        )
        allowed = (await db.execute(select(AcceleratorDemoDayExpert.id).join(
            AcceleratorDemoDay,
            AcceleratorDemoDay.id == AcceleratorDemoDayExpert.demo_day_id,
        ).where(
            AcceleratorDemoDay.cohort_id == cohort.id,
            AcceleratorDemoDayExpert.user_id == user.id,
        ).limit(1))).scalar_one_or_none()
        if allowed is None:
            raise HTTPException(status_code=403, detail="Нет доступа к демо-дню")
    rows = (await db.execute(query.order_by(AcceleratorDemoDay.created_at.desc()))).scalars().all()
    return {
        "access_role": access_role,
        "demo_days": [await demo_day_dict(db, row, access_role, user.id) for row in rows],
    }


@router.get("/memberships/{membership_id}/demo-days")
async def list_membership_demo_days(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.user_id != user.id or membership.role != "resident":
        raise HTTPException(status_code=404, detail="Участие не найдено")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_demo_day_module(db, cohort)
    rows = (await db.execute(
        select(AcceleratorDemoDay)
        .join(
            AcceleratorDemoDayProject,
            AcceleratorDemoDayProject.demo_day_id == AcceleratorDemoDay.id,
        )
        .where(AcceleratorDemoDayProject.membership_id == membership.id)
        .order_by(AcceleratorDemoDay.created_at.desc())
    )).scalars().all()
    return {
        "access_role": "resident",
        "demo_days": [await demo_day_dict(db, row, "resident", user.id) for row in rows],
    }


@router.post("/cohorts/{cohort_id}/demo-days")
async def create_demo_day(
    cohort_id: int,
    payload: DemoDayCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_demo_day_module(db, cohort)
    await require_cohort_manager(db, user, cohort)
    row = AcceleratorDemoDay(
        cohort_id=cohort.id,
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        starts_at=payload.starts_at,
        criteria=[criterion.model_dump(mode="json") for criterion in payload.criteria],
        created_by_user_id=user.id,
    )
    db.add(row)
    await db.flush()
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.created",
        target_type="demo_day", target_id=row.id,
        details={"title": row.title, "criteria_count": len(row.criteria)},
    )
    await db.commit()
    return await demo_day_dict(db, row, "global_admin" if user.is_admin else "organizer", user.id)


@router.get("/cohorts/{cohort_id}/demo-day-expert-candidates")
async def search_demo_day_expert_candidates(
    cohort_id: int,
    q: str = Query(min_length=2, max_length=200),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_demo_day_module(db, cohort)
    await require_cohort_manager(db, user, cohort)
    resident_ids = select(AcceleratorMembership.user_id).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == "resident",
    )
    organizer_ids = select(AcceleratorStaff.user_id).where(
        AcceleratorStaff.accelerator_id == cohort.accelerator_id,
        AcceleratorStaff.role == "organizer",
    )
    search = f"%{q.strip()}%"
    rows = (await db.execute(select(User).where(
        User.is_active.is_(True),
        User.deleted_at.is_(None),
        User.id.not_in(resident_ids),
        User.id.not_in(organizer_ids),
        or_(User.name.ilike(search), User.email.ilike(search)),
    ).order_by(User.name, User.email).limit(20))).scalars().all()
    return [{"id": row.id, "name": row.name, "email": row.email} for row in rows]


@router.post("/demo-days/{demo_day_id}/experts")
async def assign_demo_day_expert(
    demo_day_id: int,
    payload: DemoDayExpertAssign,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    demo_day = await db.get(AcceleratorDemoDay, demo_day_id)
    if not demo_day:
        raise HTTPException(status_code=404, detail="Демо-день не найден")
    cohort, _ = await demo_day_access(db, demo_day, user)
    await require_cohort_manager(db, user, cohort)
    if demo_day.status == "finalized":
        raise HTTPException(status_code=409, detail="Финализированный демо-день нельзя изменить")
    expert = await db.get(User, payload.user_id)
    if not expert or not expert.is_active or expert.is_admin or expert.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Активный пользователь не найден")
    forbidden = (await db.execute(select(AcceleratorMembership.id).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == expert.id,
        AcceleratorMembership.role == "resident",
    ))).scalar_one_or_none()
    if forbidden is not None or await is_accelerator_organizer(db, expert.id, cohort.accelerator_id):
        raise HTTPException(status_code=409, detail="Резидент или организатор потока не может оценивать этот демо-день")
    existing = (await db.execute(select(AcceleratorDemoDayExpert).where(
        AcceleratorDemoDayExpert.demo_day_id == demo_day.id,
        AcceleratorDemoDayExpert.user_id == expert.id,
    ))).scalar_one_or_none()
    if existing:
        return await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)
    assignment = AcceleratorDemoDayExpert(
        demo_day_id=demo_day.id,
        user_id=expert.id,
        invited_by_user_id=user.id,
    )
    db.add(assignment)
    await db.flush()
    notification = await enqueue_notification(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        recipient_email=expert.email, event_type="demo_day_expert_invited",
        subject=f"Приглашение оценивать «{demo_day.title}»",
        body=f"Вы приглашены экспертом демо-дня.\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
        idempotency_key=f"demo-day-expert:{demo_day.id}:{expert.id}",
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.expert_assigned",
        target_type="user", target_id=expert.id,
        details={"demo_day_id": demo_day.id},
    )
    await db.commit()
    background_tasks.add_task(process_notification_event, notification.id)
    return await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)


@router.delete("/demo-days/{demo_day_id}/experts/{expert_user_id}", status_code=204)
async def remove_demo_day_expert(
    demo_day_id: int,
    expert_user_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    demo_day = await db.get(AcceleratorDemoDay, demo_day_id)
    if not demo_day:
        raise HTTPException(status_code=404, detail="Демо-день не найден")
    cohort, _ = await demo_day_access(db, demo_day, user)
    await require_cohort_manager(db, user, cohort)
    if demo_day.status in ("scoring", "finalized"):
        raise HTTPException(status_code=409, detail="После начала оценивания состав экспертов зафиксирован")
    await db.execute(delete(AcceleratorDemoDayExpert).where(
        AcceleratorDemoDayExpert.demo_day_id == demo_day.id,
        AcceleratorDemoDayExpert.user_id == expert_user_id,
    ))
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.expert_removed",
        target_type="user", target_id=expert_user_id,
        details={"demo_day_id": demo_day.id},
    )
    await db.commit()
    return Response(status_code=204)


@router.post("/demo-days/{demo_day_id}/projects")
async def select_demo_day_project(
    demo_day_id: int,
    payload: DemoDayProjectSelect,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    demo_day = await db.get(AcceleratorDemoDay, demo_day_id)
    if not demo_day:
        raise HTTPException(status_code=404, detail="Демо-день не найден")
    cohort, _ = await demo_day_access(db, demo_day, user)
    await require_cohort_manager(db, user, cohort)
    if demo_day.status not in ("draft", "open"):
        raise HTTPException(status_code=409, detail="Отбор проектов уже завершён")
    membership = await db.get(AcceleratorMembership, payload.membership_id)
    if (
        not membership or membership.cohort_id != cohort.id
        or membership.role != "resident" or membership.status != "enrolled"
    ):
        raise HTTPException(status_code=404, detail="Зачисленный резидент не найден")
    if not membership.project_id:
        raise HTTPException(status_code=409, detail="У резидента нет паспорта проекта")
    completed_stage = (await db.execute(
        select(AcceleratorProgramStageProgress.id)
        .join(
            AcceleratorProgramStage,
            AcceleratorProgramStage.id == AcceleratorProgramStageProgress.stage_id,
        )
        .where(
            AcceleratorProgramStageProgress.membership_id == membership.id,
            AcceleratorProgramStage.cohort_id == cohort.id,
        ).limit(1)
    )).scalar_one_or_none()
    if completed_stage is None:
        raise HTTPException(status_code=409, detail="Для участия нужно завершить хотя бы один этап программы")
    existing = (await db.execute(select(AcceleratorDemoDayProject).where(
        AcceleratorDemoDayProject.demo_day_id == demo_day.id,
        AcceleratorDemoDayProject.membership_id == membership.id,
    ))).scalar_one_or_none()
    if existing:
        return await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)
    project = await db.get(Project, membership.project_id)
    row = AcceleratorDemoDayProject(
        demo_day_id=demo_day.id,
        membership_id=membership.id,
        project_id=project.id,
        selected_by_user_id=user.id,
        selection_reason=(payload.selection_reason or "").strip() or None,
        pitch_title=project.name,
    )
    db.add(row)
    await db.flush()
    resident = await db.get(User, membership.user_id)
    notification = await enqueue_notification(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        recipient_email=resident.email, event_type="demo_day_project_selected",
        subject=f"Проект отобран на «{demo_day.title}»",
        body=f"Подготовьте презентацию и материалы проекта.\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
        idempotency_key=f"demo-day-project:{demo_day.id}:{membership.id}",
    )
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.project_selected",
        target_type="demo_day_project", target_id=row.id,
        details={"demo_day_id": demo_day.id, "membership_id": membership.id},
    )
    await db.commit()
    background_tasks.add_task(process_notification_event, notification.id)
    return await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)


@router.delete("/demo-day-projects/{demo_project_id}", status_code=204)
async def remove_demo_day_project(
    demo_project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = await db.get(AcceleratorDemoDayProject, demo_project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Проект демо-дня не найден")
    demo_day = await db.get(AcceleratorDemoDay, row.demo_day_id)
    cohort, _ = await demo_day_access(db, demo_day, user)
    await require_cohort_manager(db, user, cohort)
    if demo_day.status not in ("draft", "open"):
        raise HTTPException(status_code=409, detail="После начала оценивания отбор зафиксирован")
    await db.delete(row)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.project_removed",
        target_type="demo_day_project", target_id=demo_project_id,
        details={"demo_day_id": demo_day.id},
    )
    await db.commit()
    return Response(status_code=204)


@router.patch("/demo-day-projects/{demo_project_id}/materials")
async def update_demo_day_materials(
    demo_project_id: int,
    payload: DemoDayMaterialsUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = await db.get(AcceleratorDemoDayProject, demo_project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Проект демо-дня не найден")
    demo_day = await db.get(AcceleratorDemoDay, row.demo_day_id)
    cohort, access_role = await demo_day_access(db, demo_day, user)
    membership = await db.get(AcceleratorMembership, row.membership_id)
    if access_role == "resident" and membership.user_id != user.id:
        raise HTTPException(status_code=403, detail="Можно менять только материалы своего проекта")
    if access_role == "expert":
        raise HTTPException(status_code=403, detail="Эксперт не меняет материалы проекта")
    if demo_day.status != "open":
        raise HTTPException(status_code=409, detail="Материалы принимаются только на открытом демо-дне")
    row.pitch_title = payload.pitch_title.strip()
    row.summary = payload.summary.strip()
    row.presentation_url = payload.presentation_url
    row.video_url = payload.video_url
    row.attachments = payload.attachments
    row.submitted_at = datetime.utcnow()
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.materials_submitted",
        target_type="demo_day_project", target_id=row.id,
        details={"demo_day_id": demo_day.id, "membership_id": membership.id},
    )
    notification_ids = []
    if access_role == "resident":
        organizers = (await db.execute(
            select(User)
            .join(AcceleratorStaff, AcceleratorStaff.user_id == User.id)
            .where(
                AcceleratorStaff.accelerator_id == cohort.accelerator_id,
                AcceleratorStaff.role == "organizer",
            )
        )).scalars().all()
        for organizer in organizers:
            notification = await enqueue_notification(
                db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
                recipient_email=organizer.email, event_type="demo_day_materials_submitted",
                subject=f"Материалы готовы: {row.pitch_title}",
                body=f"Резидент отправил презентацию для демо-дня «{demo_day.title}».",
                idempotency_key=f"demo-day-materials:{row.id}:{row.submitted_at.isoformat()}:{organizer.id}",
            )
            notification_ids.append(notification.id)
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return await demo_day_dict(db, demo_day, access_role, user.id)


@router.patch("/demo-day-projects/{demo_project_id}/decision")
async def update_demo_day_project_decision(
    demo_project_id: int,
    payload: DemoDayProjectDecision,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = await db.get(AcceleratorDemoDayProject, demo_project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Проект демо-дня не найден")
    demo_day = await db.get(AcceleratorDemoDay, row.demo_day_id)
    cohort, _ = await demo_day_access(db, demo_day, user)
    await require_cohort_manager(db, user, cohort)
    if demo_day.status == "finalized":
        raise HTTPException(status_code=409, detail="Результаты уже финализированы")
    row.score_adjustment = payload.score_adjustment
    row.manager_note = (payload.manager_note or "").strip() or None
    row.outcome = payload.outcome
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.decision_updated",
        target_type="demo_day_project", target_id=row.id,
        details={
            "demo_day_id": demo_day.id,
            "score_adjustment": payload.score_adjustment,
            "outcome": payload.outcome,
        },
    )
    await db.commit()
    return await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)


@router.put("/demo-day-projects/{demo_project_id}/score")
async def upsert_demo_day_score(
    demo_project_id: int,
    payload: DemoDayScoreUpsert,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    project_row = await db.get(AcceleratorDemoDayProject, demo_project_id)
    if not project_row:
        raise HTTPException(status_code=404, detail="Проект демо-дня не найден")
    demo_day = await db.get(AcceleratorDemoDay, project_row.demo_day_id)
    cohort, access_role = await demo_day_access(db, demo_day, user)
    if access_role != "expert":
        raise HTTPException(status_code=403, detail="Проекты оценивают приглашённые эксперты")
    if demo_day.status != "scoring":
        raise HTTPException(status_code=409, detail="Оценивание сейчас закрыто")
    normalized = demo_normalized_score(demo_day.criteria or [], payload.scores)
    score = (await db.execute(select(AcceleratorDemoDayScore).where(
        AcceleratorDemoDayScore.demo_project_id == project_row.id,
        AcceleratorDemoDayScore.expert_user_id == user.id,
    ).with_for_update())).scalar_one_or_none()
    if not score:
        score = AcceleratorDemoDayScore(
            demo_project_id=project_row.id,
            expert_user_id=user.id,
            scores=payload.scores,
            normalized_score=normalized,
            recommendation=payload.recommendation,
        )
        db.add(score)
    score.scores = payload.scores
    score.normalized_score = normalized
    score.comment = (payload.comment or "").strip() or None
    score.recommendation = payload.recommendation
    score.submitted_at = datetime.utcnow()
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.score_submitted",
        target_type="demo_day_project", target_id=project_row.id,
        details={"demo_day_id": demo_day.id, "normalized_score": normalized},
    )
    await db.commit()
    return await demo_day_dict(db, demo_day, "expert", user.id)


@router.patch("/demo-days/{demo_day_id}/status")
async def update_demo_day_status(
    demo_day_id: int,
    payload: DemoDayStatusUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    demo_day = (await db.execute(select(AcceleratorDemoDay).where(
        AcceleratorDemoDay.id == demo_day_id
    ).with_for_update())).scalar_one_or_none()
    if not demo_day:
        raise HTTPException(status_code=404, detail="Демо-день не найден")
    cohort, _ = await demo_day_access(db, demo_day, user)
    await require_cohort_manager(db, user, cohort)
    if payload.status == demo_day.status:
        return await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)
    allowed = {"draft": {"open"}, "open": {"scoring"}, "scoring": {"finalized"}, "finalized": set()}
    if payload.status not in allowed.get(demo_day.status, set()):
        raise HTTPException(status_code=409, detail="Недопустимый переход статуса демо-дня")
    projects = (await db.execute(select(AcceleratorDemoDayProject).where(
        AcceleratorDemoDayProject.demo_day_id == demo_day.id
    ))).scalars().all()
    if payload.status in ("open", "scoring", "finalized") and not projects:
        raise HTTPException(status_code=409, detail="Сначала отберите хотя бы один проект")
    if payload.status == "scoring":
        expert_count = (await db.execute(select(func.count(AcceleratorDemoDayExpert.id)).where(
            AcceleratorDemoDayExpert.demo_day_id == demo_day.id
        ))).scalar_one()
        if not expert_count:
            raise HTTPException(status_code=409, detail="Пригласите хотя бы одного эксперта")
        missing = [row.id for row in projects if not row.submitted_at or not row.presentation_url]
        if missing:
            raise HTTPException(status_code=409, detail="Не все проекты отправили презентации")
    if payload.status == "finalized":
        score_counts = dict((await db.execute(
            select(
                AcceleratorDemoDayScore.demo_project_id,
                func.count(AcceleratorDemoDayScore.id),
            ).where(
                AcceleratorDemoDayScore.demo_project_id.in_([row.id for row in projects])
            ).group_by(AcceleratorDemoDayScore.demo_project_id)
        )).all()) if projects else {}
        if any(score_counts.get(row.id, 0) == 0 for row in projects):
            raise HTTPException(status_code=409, detail="Каждый проект должен получить хотя бы одну оценку")
        scores = (await db.execute(select(AcceleratorDemoDayScore).where(
            AcceleratorDemoDayScore.demo_project_id.in_([row.id for row in projects])
        ))).scalars().all()
        by_project: dict[int, list[float]] = {}
        for score in scores:
            by_project.setdefault(score.demo_project_id, []).append(float(score.normalized_score))
        for row in projects:
            average = sum(by_project[row.id]) / len(by_project[row.id])
            row.final_score = round(max(0, min(100, average + float(row.score_adjustment or 0))), 2)
        ranked = sorted(projects, key=lambda row: (-float(row.final_score), row.id))
        for rank, row in enumerate(ranked, start=1):
            row.rank = rank
        demo_day.finalized_at = datetime.utcnow()
        demo_day.finalized_by_user_id = user.id
    previous = demo_day.status
    demo_day.status = payload.status
    recipients: dict[int, User] = {}
    if payload.status == "scoring":
        expert_users = (await db.execute(
            select(User)
            .join(AcceleratorDemoDayExpert, AcceleratorDemoDayExpert.user_id == User.id)
            .where(AcceleratorDemoDayExpert.demo_day_id == demo_day.id)
        )).scalars().all()
        recipients.update({person.id: person for person in expert_users})
    elif payload.status == "finalized":
        resident_users = (await db.execute(
            select(User)
            .join(AcceleratorMembership, AcceleratorMembership.user_id == User.id)
            .join(
                AcceleratorDemoDayProject,
                AcceleratorDemoDayProject.membership_id == AcceleratorMembership.id,
            )
            .where(AcceleratorDemoDayProject.demo_day_id == demo_day.id)
        )).scalars().all()
        recipients.update({person.id: person for person in resident_users})
    notification_ids = []
    for recipient in recipients.values():
        notification = await enqueue_notification(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            recipient_email=recipient.email,
            event_type=f"demo_day_{payload.status}",
            subject=(
                f"Открыто оценивание «{demo_day.title}»"
                if payload.status == "scoring" else f"Опубликованы результаты «{demo_day.title}»"
            ),
            body=f"Откройте рабочее пространство акселератора: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
            idempotency_key=f"demo-day-status:{demo_day.id}:{payload.status}:{recipient.id}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="demo_day.status_changed",
        target_type="demo_day", target_id=demo_day.id,
        details={"from": previous, "to": payload.status},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)


@router.get("/demo-days/{demo_day_id}/export")
async def export_demo_day(
    demo_day_id: int,
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    demo_day = await db.get(AcceleratorDemoDay, demo_day_id)
    if not demo_day:
        raise HTTPException(status_code=404, detail="Демо-день не найден")
    cohort, _ = await demo_day_access(db, demo_day, user)
    await require_cohort_manager(db, user, cohort)
    if demo_day.status != "finalized":
        raise HTTPException(status_code=409, detail="Экспорт доступен после финализации результатов")
    data = await demo_day_dict(db, demo_day, "global_admin" if user.is_admin else "organizer", user.id)
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Место", "Проект", "Резидент", "Итоговая оценка", "Средняя оценка экспертов",
            "Корректировка организатора", "Результат", "Презентация", "Видео",
        ])
        for project in data["projects"]:
            writer.writerow([
                project["rank"], project["project"]["name"], project["resident"]["name"],
                project["final_score"], project["average_score"], project["score_adjustment"],
                project["outcome"], project["presentation_url"], project["video_url"],
            ])
        return Response(
            content="\ufeff" + output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="demo-day-{demo_day.id}-results.csv"'},
        )
    cards = []
    for project_data in data["projects"]:
        project = await db.get(Project, project_data["project"]["id"])
        cards.append({
            **project_data,
            "passport": project.passport or {},
        })
    content = json.dumps({
        "demo_day": {
            "id": demo_day.id,
            "title": demo_day.title,
            "criteria": demo_day.criteria or [],
            "finalized_at": demo_day.finalized_at.isoformat() if demo_day.finalized_at else None,
        },
        "project_cards": cards,
    }, ensure_ascii=False, default=str, indent=2)
    return Response(
        content=content,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="demo-day-{demo_day.id}-project-cards.json"'},
    )


def match_profile_dict(profile: AcceleratorMatchProfile, person: User, active_matches: int = 0) -> dict:
    return {
        "id": profile.id,
        "cohort_id": profile.cohort_id,
        "user_id": profile.user_id,
        "membership_id": profile.membership_id,
        "role": profile.role,
        "name": person.name,
        "email": person.email,
        "bio": profile.bio,
        "expertise": profile.expertise or [],
        "needs": profile.needs or [],
        "industries": profile.industries or [],
        "goals": profile.goals or [],
        "preferred_formats": profile.preferred_formats or [],
        "max_matches": profile.max_matches,
        "active": profile.active,
        "active_matches": active_matches,
        "updated_at": profile.updated_at,
    }


def apply_match_profile_data(
    profile: AcceleratorMatchProfile, payload: MatchProfileData, actor_user_id: int
) -> None:
    profile.bio = payload.bio
    profile.expertise = payload.expertise
    profile.needs = payload.needs
    profile.industries = payload.industries
    profile.goals = payload.goals
    profile.preferred_formats = payload.preferred_formats
    profile.max_matches = payload.max_matches
    profile.active = payload.active
    profile.updated_by_user_id = actor_user_id


def normalized_tag_set(values: list[str] | None) -> set[str]:
    return {" ".join(value.casefold().split()) for value in (values or []) if value.strip()}


def calculate_match_score(
    resident_profile: AcceleratorMatchProfile, counterpart: AcceleratorMatchProfile
) -> tuple[int, list[str]]:
    needs = normalized_tag_set(resident_profile.needs)
    expertise = normalized_tag_set(counterpart.expertise)
    shared_needs = needs & expertise
    resident_industries = normalized_tag_set(resident_profile.industries)
    shared_industries = resident_industries & normalized_tag_set(counterpart.industries)
    resident_goals = normalized_tag_set(resident_profile.goals)
    shared_goals = resident_goals & (expertise | normalized_tag_set(counterpart.goals))
    shared_formats = normalized_tag_set(resident_profile.preferred_formats) & normalized_tag_set(
        counterpart.preferred_formats
    )
    score = 10
    reasons: list[str] = []
    if needs:
        score += round(55 * len(shared_needs) / len(needs))
    elif expertise:
        score += 15
    if shared_needs:
        reasons.append("Закрывает запросы: " + ", ".join(sorted(shared_needs)[:3]))
    if shared_industries:
        score += 20
        reasons.append("Опыт в отрасли: " + ", ".join(sorted(shared_industries)[:2]))
    if shared_goals:
        score += 10
        reasons.append("Совпадают цели и компетенции")
    if shared_formats:
        score += 5
        reasons.append("Подходит формат взаимодействия")
    if not reasons:
        reasons.append("Общий кандидат из пула потока")
    return min(100, score), reasons


async def match_profile_relationship_count(
    db: AsyncSession, profile: AcceleratorMatchProfile
) -> int:
    conditions = [AcceleratorMatch.counterpart_profile_id == profile.id]
    if profile.membership_id:
        conditions.append(AcceleratorMatch.resident_membership_id == profile.membership_id)
    return int((await db.execute(select(func.count(AcceleratorMatch.id)).where(
        AcceleratorMatch.status == "active", or_(*conditions)
    ))).scalar_one() or 0)


async def get_match_profile_or_404(db: AsyncSession, profile_id: int) -> AcceleratorMatchProfile:
    profile = await db.get(AcceleratorMatchProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Профиль матчмейкинга не найден")
    return profile


async def require_matchmaking_person_access(
    db: AsyncSession, user: User, cohort: AcceleratorCohort
) -> str:
    if user.is_admin:
        return "global_admin"
    if await is_accelerator_organizer(db, user.id, cohort.accelerator_id):
        return "organizer"
    resident = (await db.execute(select(AcceleratorMembership.id).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalar_one_or_none()
    if resident is not None:
        return "resident"
    role = (await db.execute(
        select(AcceleratorMatchProfile.role)
        .join(AcceleratorMatch, AcceleratorMatch.counterpart_profile_id == AcceleratorMatchProfile.id)
        .where(
            AcceleratorMatch.cohort_id == cohort.id,
            AcceleratorMatch.status == "active",
            AcceleratorMatchProfile.user_id == user.id,
        )
        .limit(1)
    )).scalar_one_or_none()
    if role in ("tracker", "expert"):
        return role
    raise HTTPException(status_code=403, detail="Нет доступа к матчмейкингу этого потока")


async def matchmaking_match_dict(db: AsyncSession, match: AcceleratorMatch) -> dict:
    membership = await db.get(AcceleratorMembership, match.resident_membership_id)
    resident = await db.get(User, membership.user_id) if membership else None
    profile = await db.get(AcceleratorMatchProfile, match.counterpart_profile_id)
    counterpart = await db.get(User, profile.user_id) if profile else None
    return {
        "id": match.id,
        "cohort_id": match.cohort_id,
        "resident": {
            "membership_id": membership.id,
            "user_id": resident.id,
            "name": resident.name,
            "email": resident.email,
        } if membership and resident else None,
        "counterpart": match_profile_dict(
            profile, counterpart, await match_profile_relationship_count(db, profile)
        ) if profile and counterpart else None,
        "counterpart_role": match.counterpart_role,
        "score": match.score,
        "reasons": match.reasons or [],
        "status": match.status,
        "created_at": match.created_at,
        "ended_at": match.ended_at,
    }


@router.get("/cohorts/{cohort_id}/matchmaking/candidates")
async def search_matchmaking_candidates(
    cohort_id: int,
    role: str = Query(pattern="^(tracker|expert)$"),
    q: str = Query(min_length=2, max_length=200),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_matchmaking_module(db, cohort)
    search = f"%{q.strip()}%"
    existing_ids = select(AcceleratorMatchProfile.user_id).where(
        AcceleratorMatchProfile.cohort_id == cohort.id,
        AcceleratorMatchProfile.role == role,
    )
    organizer_ids = select(AcceleratorStaff.user_id).where(
        AcceleratorStaff.accelerator_id == cohort.accelerator_id,
        AcceleratorStaff.role == "organizer",
    )
    resident_ids = select(AcceleratorMembership.user_id).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == "resident",
    )
    rows = (await db.execute(select(User).where(
        User.is_active.is_(True), User.deleted_at.is_(None),
        User.id.not_in(existing_ids), User.id.not_in(organizer_ids), User.id.not_in(resident_ids),
        or_(User.name.ilike(search), User.email.ilike(search)),
    ).order_by(User.name, User.email).limit(20))).scalars().all()
    return [{"id": row.id, "name": row.name, "email": row.email} for row in rows]


@router.get("/cohorts/{cohort_id}/matchmaking/profiles")
async def list_matchmaking_profiles(
    cohort_id: int,
    role: str | None = Query(default=None, pattern="^(resident|tracker|expert)$"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_matchmaking_module(db, cohort)
    query = select(AcceleratorMatchProfile, User).join(
        User, User.id == AcceleratorMatchProfile.user_id
    ).where(AcceleratorMatchProfile.cohort_id == cohort.id)
    if role:
        query = query.where(AcceleratorMatchProfile.role == role)
    rows = (await db.execute(query.order_by(
        AcceleratorMatchProfile.role, User.name
    ))).all()
    return [match_profile_dict(profile, person, await match_profile_relationship_count(db, profile))
            for profile, person in rows]


@router.post("/cohorts/{cohort_id}/matchmaking/profiles")
async def create_matchmaking_pool_profile(
    cohort_id: int,
    payload: MatchPoolProfileCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_matchmaking_module(db, cohort)
    person = await db.get(User, payload.user_id)
    if not person or not person.is_active or person.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Активный пользователь не найден")
    if await is_accelerator_organizer(db, person.id, cohort.accelerator_id):
        raise HTTPException(status_code=409, detail="Организатора нельзя добавить в пул")
    resident_membership = (await db.execute(select(AcceleratorMembership.id).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == person.id,
        AcceleratorMembership.role == "resident",
    ))).scalar_one_or_none()
    if resident_membership is not None:
        raise HTTPException(status_code=409, detail="Резидент уже участвует в подборе как резидент")
    existing = (await db.execute(select(AcceleratorMatchProfile.id).where(
        AcceleratorMatchProfile.cohort_id == cohort.id,
        AcceleratorMatchProfile.user_id == person.id,
        AcceleratorMatchProfile.role == payload.role,
    ))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Пользователь уже добавлен в этот пул")
    profile = AcceleratorMatchProfile(
        cohort_id=cohort.id, user_id=person.id, role=payload.role,
        created_by_user_id=user.id, updated_by_user_id=user.id,
    )
    apply_match_profile_data(profile, payload, user.id)
    db.add(profile)
    await db.flush()
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="matchmaking.profile_created",
        target_type="match_profile", target_id=profile.id,
        details={"role": profile.role, "user_id": profile.user_id},
    )
    await db.commit()
    return match_profile_dict(profile, person)


@router.put("/matchmaking/profiles/{profile_id}")
async def update_matchmaking_profile(
    profile_id: int,
    payload: MatchProfileData,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    profile = await get_match_profile_or_404(db, profile_id)
    cohort = await get_cohort_or_404(db, profile.cohort_id)
    await require_matchmaking_module(db, cohort)
    manager = user.is_admin or await is_accelerator_organizer(db, user.id, cohort.accelerator_id)
    if not manager and profile.user_id != user.id:
        raise HTTPException(status_code=403, detail="Можно менять только свой профиль")
    if not manager and payload.active != profile.active:
        raise HTTPException(status_code=403, detail="Статус профиля меняет организатор")
    apply_match_profile_data(profile, payload, user.id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="matchmaking.profile_updated",
        target_type="match_profile", target_id=profile.id,
    )
    await db.commit()
    person = await db.get(User, profile.user_id)
    return match_profile_dict(profile, person, await match_profile_relationship_count(db, profile))


@router.get("/memberships/{membership_id}/match-profile")
async def get_resident_match_profile(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident":
        raise HTTPException(status_code=404, detail="Резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_matchmaking_module(db, cohort)
    manager = user.is_admin or await is_accelerator_organizer(db, user.id, cohort.accelerator_id)
    if not manager and membership.user_id != user.id:
        raise HTTPException(status_code=403, detail="Нет доступа к профилю резидента")
    row = (await db.execute(
        select(AcceleratorMatchProfile, User)
        .join(User, User.id == AcceleratorMatchProfile.user_id)
        .where(AcceleratorMatchProfile.membership_id == membership.id)
    )).one_or_none()
    if not row:
        return None
    profile, person = row
    return match_profile_dict(profile, person, await match_profile_relationship_count(db, profile))


@router.put("/memberships/{membership_id}/match-profile")
async def upsert_resident_match_profile(
    membership_id: int,
    payload: MatchProfileData,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident" or membership.status != "enrolled":
        raise HTTPException(status_code=404, detail="Активный резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_matchmaking_module(db, cohort)
    manager = user.is_admin or await is_accelerator_organizer(db, user.id, cohort.accelerator_id)
    if not manager and membership.user_id != user.id:
        raise HTTPException(status_code=403, detail="Можно менять только свой профиль")
    profile = (await db.execute(select(AcceleratorMatchProfile).where(
        AcceleratorMatchProfile.membership_id == membership.id
    ).with_for_update())).scalar_one_or_none()
    if not profile:
        profile = AcceleratorMatchProfile(
            cohort_id=cohort.id, user_id=membership.user_id, membership_id=membership.id,
            role="resident", created_by_user_id=user.id, updated_by_user_id=user.id,
        )
        db.add(profile)
    apply_match_profile_data(profile, payload, user.id)
    await db.flush()
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="matchmaking.resident_profile_upserted",
        target_type="match_profile", target_id=profile.id,
        details={"membership_id": membership.id},
    )
    await db.commit()
    person = await db.get(User, membership.user_id)
    return match_profile_dict(profile, person, await match_profile_relationship_count(db, profile))


@router.get("/memberships/{membership_id}/matchmaking/recommendations")
async def matchmaking_recommendations(
    membership_id: int,
    role: str = Query(default="expert", pattern="^(resident|tracker|expert)$"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident" or membership.status != "enrolled":
        raise HTTPException(status_code=404, detail="Активный резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_matchmaking_module(db, cohort)
    manager = user.is_admin or await is_accelerator_organizer(db, user.id, cohort.accelerator_id)
    if not manager and membership.user_id != user.id:
        raise HTTPException(status_code=403, detail="Нет доступа к рекомендациям")
    resident_profile = (await db.execute(select(AcceleratorMatchProfile).where(
        AcceleratorMatchProfile.membership_id == membership.id,
        AcceleratorMatchProfile.active.is_(True),
    ))).scalar_one_or_none()
    if not resident_profile:
        raise HTTPException(status_code=409, detail="Сначала заполните профиль матчмейкинга резидента")
    query = (
        select(AcceleratorMatchProfile, User)
        .join(User, User.id == AcceleratorMatchProfile.user_id)
        .where(
            AcceleratorMatchProfile.cohort_id == cohort.id,
            AcceleratorMatchProfile.role == role,
            AcceleratorMatchProfile.active.is_(True),
            AcceleratorMatchProfile.user_id != membership.user_id,
        )
    )
    if role == "resident":
        query = query.join(
            AcceleratorMembership, AcceleratorMembership.id == AcceleratorMatchProfile.membership_id
        ).where(AcceleratorMembership.status == "enrolled")
    candidates = []
    for profile, person in (await db.execute(query)).all():
        active_count = await match_profile_relationship_count(db, profile)
        if active_count >= profile.max_matches:
            continue
        score, reasons = calculate_match_score(resident_profile, profile)
        existing_status = (await db.execute(select(AcceleratorMatch.status).where(
            AcceleratorMatch.resident_membership_id == membership.id,
            AcceleratorMatch.counterpart_profile_id == profile.id,
        ))).scalar_one_or_none()
        data = match_profile_dict(profile, person, active_count)
        if not manager:
            data.pop("email", None)
        candidates.append({"profile": data, "score": score, "reasons": reasons,
                           "existing_status": existing_status})
    return sorted(candidates, key=lambda row: (-row["score"], row["profile"]["name"]))


async def ensure_tracker_match_assignment(
    db: AsyncSession,
    cohort: AcceleratorCohort,
    match: AcceleratorMatch,
    profile: AcceleratorMatchProfile,
    actor_user_id: int,
) -> None:
    staff = (await db.execute(select(AcceleratorStaff).where(
        AcceleratorStaff.accelerator_id == cohort.accelerator_id,
        AcceleratorStaff.user_id == profile.user_id,
    ))).scalar_one_or_none()
    if staff and staff.role != "tracker":
        raise HTTPException(status_code=409, detail="Кандидат уже назначен организатором")
    if not staff:
        db.add(AcceleratorStaff(
            accelerator_id=cohort.accelerator_id, user_id=profile.user_id,
            role="tracker", created_by_user_id=actor_user_id,
        ))
    assignment = (await db.execute(select(AcceleratorTrackerAssignment).where(
        AcceleratorTrackerAssignment.tracker_user_id == profile.user_id,
        AcceleratorTrackerAssignment.membership_id == match.resident_membership_id,
    ))).scalar_one_or_none()
    if not assignment:
        assignment = AcceleratorTrackerAssignment(
            tracker_user_id=profile.user_id, membership_id=match.resident_membership_id,
            assigned_by_user_id=actor_user_id,
        )
        db.add(assignment)
        await db.flush()
        match.tracker_assignment_id = assignment.id


@router.post("/memberships/{membership_id}/matches")
async def create_accelerator_match(
    membership_id: int,
    payload: MatchCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident" or membership.status != "enrolled":
        raise HTTPException(status_code=404, detail="Активный резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_matchmaking_module(db, cohort)
    profile = await get_match_profile_or_404(db, payload.counterpart_profile_id)
    if profile.cohort_id != cohort.id or not profile.active or profile.user_id == membership.user_id:
        raise HTTPException(status_code=422, detail="Кандидат недоступен для этого резидента")
    if profile.role == "resident":
        peer = await db.get(AcceleratorMembership, profile.membership_id)
        if not peer or peer.status != "enrolled":
            raise HTTPException(status_code=422, detail="Резидент-кандидат не активен")
    active_count = await match_profile_relationship_count(db, profile)
    existing = (await db.execute(select(AcceleratorMatch).where(
        AcceleratorMatch.resident_membership_id == membership.id,
        AcceleratorMatch.counterpart_profile_id == profile.id,
    ).with_for_update())).scalar_one_or_none()
    if existing and existing.status == "active":
        raise HTTPException(status_code=409, detail="Связка уже подтверждена")
    if active_count >= profile.max_matches:
        raise HTTPException(status_code=409, detail="У кандидата закончились свободные слоты")
    resident_profile = (await db.execute(select(AcceleratorMatchProfile).where(
        AcceleratorMatchProfile.membership_id == membership.id,
        AcceleratorMatchProfile.active.is_(True),
    ))).scalar_one_or_none()
    if not resident_profile:
        raise HTTPException(status_code=409, detail="Сначала заполните профиль резидента")
    if await match_profile_relationship_count(db, resident_profile) >= resident_profile.max_matches:
        raise HTTPException(status_code=409, detail="У резидента закончились свободные слоты")
    if profile.role == "resident":
        reverse_match = (await db.execute(select(AcceleratorMatch.id).where(
            AcceleratorMatch.resident_membership_id == profile.membership_id,
            AcceleratorMatch.counterpart_profile_id == resident_profile.id,
            AcceleratorMatch.status == "active",
        ))).scalar_one_or_none()
        if reverse_match is not None:
            raise HTTPException(status_code=409, detail="Связка между резидентами уже подтверждена")
    score, reasons = calculate_match_score(resident_profile, profile)
    match = existing or AcceleratorMatch(
        cohort_id=cohort.id, resident_membership_id=membership.id,
        counterpart_profile_id=profile.id, counterpart_role=profile.role,
        created_by_user_id=user.id,
    )
    if not existing:
        db.add(match)
    match.status = "active"
    match.score = score
    match.reasons = reasons
    match.ended_at = None
    match.ended_by_user_id = None
    if profile.role == "tracker":
        await ensure_tracker_match_assignment(db, cohort, match, profile, user.id)
    await db.flush()
    resident = await db.get(User, membership.user_id)
    counterpart = await db.get(User, profile.user_id)
    notification_ids = []
    for recipient, other_name in ((resident, counterpart.name), (counterpart, resident.name)):
        notification = await enqueue_notification(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            recipient_email=recipient.email, event_type="matchmaking_match_created",
            subject="Новая связка в акселераторе",
            body=(f"Для вас подтверждена связка с {other_name}."
                  f"\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator"),
            idempotency_key=f"match-created:{match.id}:{match.updated_at.isoformat()}:{recipient.id}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="matchmaking.match_created",
        target_type="match", target_id=match.id,
        details={"membership_id": membership.id, "counterpart_profile_id": profile.id,
                 "role": profile.role, "score": score},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return await matchmaking_match_dict(db, match)


@router.get("/cohorts/{cohort_id}/matches")
async def list_accelerator_matches(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_matchmaking_module(db, cohort)
    rows = (await db.execute(select(AcceleratorMatch).where(
        AcceleratorMatch.cohort_id == cohort.id
    ).order_by(AcceleratorMatch.status, AcceleratorMatch.created_at.desc()))).scalars().all()
    return [await matchmaking_match_dict(db, row) for row in rows]


@router.get("/cohorts/{cohort_id}/matchmaking/me")
async def my_accelerator_matches(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_matchmaking_module(db, cohort)
    access_role = await require_matchmaking_person_access(db, user, cohort)
    profiles = (await db.execute(select(AcceleratorMatchProfile).where(
        AcceleratorMatchProfile.cohort_id == cohort.id,
        AcceleratorMatchProfile.user_id == user.id,
    ))).scalars().all()
    own_membership_ids = set((await db.execute(select(AcceleratorMembership.id).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == user.id,
    ))).scalars().all())
    own_profile_ids = {profile.id for profile in profiles}
    query = select(AcceleratorMatch).where(AcceleratorMatch.cohort_id == cohort.id)
    if access_role not in ("global_admin", "organizer"):
        query = query.where(or_(
            AcceleratorMatch.resident_membership_id.in_(own_membership_ids),
            AcceleratorMatch.counterpart_profile_id.in_(own_profile_ids),
        ))
    matches = (await db.execute(query.order_by(
        AcceleratorMatch.status, AcceleratorMatch.created_at.desc()
    ))).scalars().all()
    return {
        "access_role": access_role,
        "profiles": [match_profile_dict(profile, user, await match_profile_relationship_count(db, profile))
                     for profile in profiles],
        "matches": [await matchmaking_match_dict(db, row) for row in matches],
    }


@router.patch("/matches/{match_id}")
async def update_accelerator_match(
    match_id: int,
    payload: MatchStatusUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    match = (await db.execute(select(AcceleratorMatch).where(
        AcceleratorMatch.id == match_id
    ).with_for_update())).scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=404, detail="Связка не найдена")
    cohort = await get_cohort_or_404(db, match.cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_matchmaking_module(db, cohort)
    if match.status == payload.status:
        return await matchmaking_match_dict(db, match)
    profile = await get_match_profile_or_404(db, match.counterpart_profile_id)
    if payload.status == "active":
        if not profile.active or await match_profile_relationship_count(db, profile) >= profile.max_matches:
            raise HTTPException(status_code=409, detail="Кандидат сейчас недоступен")
        resident_profile = (await db.execute(select(AcceleratorMatchProfile).where(
            AcceleratorMatchProfile.membership_id == match.resident_membership_id,
            AcceleratorMatchProfile.active.is_(True),
        ))).scalar_one_or_none()
        if not resident_profile or await match_profile_relationship_count(db, resident_profile) >= resident_profile.max_matches:
            raise HTTPException(status_code=409, detail="Резидент сейчас недоступен")
        match.status = "active"
        match.ended_at = None
        match.ended_by_user_id = None
        if profile.role == "tracker":
            await ensure_tracker_match_assignment(db, cohort, match, profile, user.id)
    else:
        match.status = "ended"
        match.ended_at = datetime.utcnow()
        match.ended_by_user_id = user.id
        if match.tracker_assignment_id:
            assignment = await db.get(AcceleratorTrackerAssignment, match.tracker_assignment_id)
            match.tracker_assignment_id = None
            if assignment:
                await db.delete(assignment)
                await db.flush()
                await remove_tracker_staff_if_unused(
                    db, accelerator_id=cohort.accelerator_id,
                    tracker_user_id=profile.user_id,
                )
    await db.flush()
    membership = await db.get(AcceleratorMembership, match.resident_membership_id)
    resident = await db.get(User, membership.user_id)
    counterpart = await db.get(User, profile.user_id)
    notification_ids = []
    for recipient in (resident, counterpart):
        notification = await enqueue_notification(
            db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            recipient_email=recipient.email, event_type="matchmaking_match_status_changed",
            subject="Связка матчмейкинга изменена",
            body=(f"Статус вашей связки изменён: {'активна' if match.status == 'active' else 'завершена'}."
                  f"\n\nОткрыть: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator"),
            idempotency_key=f"match-status:{match.id}:{match.updated_at.isoformat()}:{recipient.id}",
        )
        notification_ids.append(notification.id)
    add_audit(
        db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
        actor_user_id=user.id, action="matchmaking.match_status_changed",
        target_type="match", target_id=match.id, details={"status": match.status},
    )
    await db.commit()
    for notification_id in notification_ids:
        background_tasks.add_task(process_notification_event, notification_id)
    return await matchmaking_match_dict(db, match)


@router.put("/memberships/{membership_id}/quota")
async def assign_resident_quota(
    membership_id: int,
    payload: ResidentQuotaAssign,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    require_global_admin_user(admin)
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership:
        raise HTTPException(status_code=404, detail="Резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    assignment = await assign_quota_override(
        db,
        membership=membership,
        source="individual",
        limits=payload.limits.model_dump(),
        created_by_user_id=admin.id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at or cohort.ends_at,
        reason=payload.reason,
    )
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=admin.id,
        action="resident_quota.assigned",
        target_type="membership",
        target_id=membership.id,
        details={"quota_override_id": assignment.id, "limits": assignment.limits, "source": "individual"},
    )
    await db.commit()
    return {"id": assignment.id, "membership_id": membership.id, "source": assignment.source, "limits": assignment.limits, "starts_at": assignment.starts_at, "ends_at": assignment.ends_at}


@router.put("/cohorts/{cohort_id}/quota-template")
async def assign_cohort_quota(
    cohort_id: int,
    payload: CohortQuotaAssign,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    require_global_admin_user(admin)
    cohort = await get_cohort_or_404(db, cohort_id)
    limits = normalize_resident_limits(payload.limits.model_dump())
    cohort.default_quota_config = limits
    cohort.default_quota_updated_by_user_id = admin.id
    affected = 0
    skipped_personal = 0
    if payload.apply_to_existing:
        memberships = (await db.execute(select(AcceleratorMembership).where(
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorMembership.role == "resident",
            AcceleratorMembership.status == "enrolled",
        ))).scalars().all()
        for membership in memberships:
            if not payload.overwrite_personal and await has_active_personal_override(db, membership.id):
                skipped_personal += 1
                continue
            if payload.overwrite_personal:
                effective_at = payload.starts_at or datetime.utcnow()
                personal_rows = (await db.execute(
                    select(AcceleratorResidentQuotaOverride).where(
                        AcceleratorResidentQuotaOverride.membership_id == membership.id,
                        AcceleratorResidentQuotaOverride.source == "individual",
                        (
                            AcceleratorResidentQuotaOverride.superseded_at.is_(None)
                            | (AcceleratorResidentQuotaOverride.superseded_at > effective_at)
                        ),
                    ).with_for_update()
                )).scalars().all()
                for personal in personal_rows:
                    personal.superseded_at = effective_at
            await assign_quota_override(
                db,
                membership=membership,
                source="cohort",
                limits=limits,
                created_by_user_id=admin.id,
                starts_at=payload.starts_at,
                ends_at=payload.ends_at or cohort.ends_at,
                reason=payload.reason or "Массовое назначение лимитов потока",
            )
            affected += 1
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=admin.id,
        action="cohort_quota.assigned",
        target_type="cohort",
        target_id=cohort.id,
        details={
            "limits": limits,
            "apply_to_existing": payload.apply_to_existing,
            "overwrite_personal": payload.overwrite_personal,
            "affected": affected,
            "skipped_personal": skipped_personal,
        },
    )
    await db.commit()
    return {"cohort_id": cohort.id, "limits": limits, "affected": affected, "skipped_personal": skipped_personal}


@router.get("/memberships/{membership_id}/quota")
async def get_resident_quota(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership:
        raise HTTPException(status_code=404, detail="Резидент не найден")
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    if user.id != membership.user_id:
        await require_cohort_manager(db, user, cohort)
    resources = {}
    for resource in ("messages", "roadmaps", "custdev", "grants"):
        snapshot = await accelerator_membership_quota_snapshot(db, membership.id, resource)
        if snapshot:
            resources[resource] = {
                "limit": snapshot["limit"],
                "used": snapshot["used"],
                "remaining": snapshot["remaining"],
                "source": snapshot["override"].source,
                "starts_at": snapshot["override"].starts_at,
                "ends_at": snapshot["override"].ends_at,
            }
    return {"membership_id": membership.id, "resources": resources}


@router.get("/{accelerator_id}/audit")
async def list_audit(
    accelerator_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    await get_accelerator_or_404(db, accelerator_id)
    if not user.is_admin and not await is_accelerator_organizer(db, user.id, accelerator_id):
        raise HTTPException(status_code=403, detail="Нет доступа к журналу акселератора")
    rows = (await db.execute(
        select(AcceleratorAuditLog)
        .where(AcceleratorAuditLog.accelerator_id == accelerator_id)
        .order_by(AcceleratorAuditLog.created_at.desc())
        .limit(limit)
    )).scalars().all()
    return [{
        "id": row.id,
        "cohort_id": row.cohort_id,
        "actor_user_id": row.actor_user_id,
        "action": row.action,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "details": row.details,
        "created_at": row.created_at,
    } for row in rows]
