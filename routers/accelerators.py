from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
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
    has_active_personal_override,
    is_accelerator_organizer,
    normalize_resident_limits,
    require_cohort_manager,
)
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
    AcceleratorEvent,
    AcceleratorInvitation,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission,
    AcceleratorHomeworkTarget,
    AcceleratorMembership,
    AcceleratorOrganization,
    AcceleratorProgramConfig,
    AcceleratorProgramMaterial,
    AcceleratorProgramMaterialProgress,
    AcceleratorProgramStage,
    AcceleratorProgramStageProgress,
    AcceleratorResidentQuotaOverride,
    AcceleratorStaff,
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
    ProgramConfigUpdate,
    ProgramStageCreate,
    ProgramStageReorder,
    PublicApplicationCreate,
    ResidentQuotaAssign,
    StatusUpdate,
)


router = APIRouter(prefix="/api/accelerators", tags=["accelerators"])

DEFAULT_MODULES = {
    "applications": True,
    "program": True,
    "homework": False,
    "attendance": False,
}
LOCKED_BASE_MODULES = {"applications": True, "program": True}
COHORT_STATUS_TRANSITIONS = {
    "draft": {"accepting", "archived"},
    "accepting": {"draft", "active", "archived"},
    "active": {"completed", "archived"},
    "completed": {"archived"},
    "archived": set(),
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
            select(AcceleratorStaff.accelerator_id).where(AcceleratorStaff.user_id == user.id)
        )).scalars().all()
        resident_rows = (await db.execute(
            select(AcceleratorCohort.accelerator_id)
            .join(AcceleratorMembership, AcceleratorMembership.cohort_id == AcceleratorCohort.id)
            .where(AcceleratorMembership.user_id == user.id)
        )).scalars().all()
        staff_ids = set(staff_rows)
        resident_ids = set(resident_rows)
        access_roles = {
            accelerator_id: "organizer" if accelerator_id in staff_ids else "resident"
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
        member = (await db.execute(select(AcceleratorMembership.id).where(
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorMembership.user_id == user.id,
            AcceleratorMembership.status == "enrolled",
        ))).scalar_one_or_none()
        if member is None:
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
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    assignments = (await db.execute(
        select(AcceleratorHomeworkAssignment)
        .where(
            AcceleratorHomeworkAssignment.cohort_id == cohort.id,
            AcceleratorHomeworkAssignment.status != "archived",
        )
        .order_by(AcceleratorHomeworkAssignment.created_at.desc())
    )).scalars().all()
    result = []
    enrolled_count = (await db.execute(select(func.count(AcceleratorMembership.id)).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ))).scalar_one()
    for assignment in assignments:
        target_ids = list((await db.execute(select(AcceleratorHomeworkTarget.membership_id).where(
            AcceleratorHomeworkTarget.assignment_id == assignment.id
        ))).scalars().all())
        status_rows = (await db.execute(
            select(AcceleratorHomeworkSubmission.status, func.count(AcceleratorHomeworkSubmission.id))
            .where(AcceleratorHomeworkSubmission.assignment_id == assignment.id)
            .group_by(AcceleratorHomeworkSubmission.status)
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
    notification = None
    if reviewer and reviewer.is_active and reviewer.deleted_at is None:
        accelerator = await get_accelerator_or_404(db, cohort.accelerator_id)
        notification = await enqueue_notification(
            db,
            accelerator_id=accelerator.id,
            cohort_id=cohort.id,
            recipient_email=reviewer.email,
            event_type="homework_submitted",
            subject=f"Получен ответ: {assignment.title}",
            body=f"Резидент {user.name} отправил ответ на задание «{assignment.title}».\n\nОткрыть проверку: {os.getenv('FRONTEND_URL', 'https://pitchy.pro').rstrip('/')}/accelerator",
            idempotency_key=f"homework-submitted:{submission.id}:{submission.attempt_count}",
        )
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
    if notification:
        background_tasks.add_task(process_notification_event, notification.id)
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
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    rows = (await db.execute(
        select(AcceleratorHomeworkSubmission, User)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorHomeworkSubmission.membership_id)
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(AcceleratorHomeworkSubmission.assignment_id == assignment.id)
        .order_by(AcceleratorHomeworkSubmission.submitted_at.desc())
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
    await require_cohort_manager(db, user, cohort)
    await require_homework_module(db, cohort)
    if submission.status not in ("submitted", "needs_revision"):
        raise HTTPException(status_code=409, detail="Ответ уже проверен")
    submission.status = payload.status
    submission.review_comment = (payload.comment or "").strip() or None
    submission.reviewed_by_user_id = user.id
    submission.reviewed_at = datetime.utcnow()
    membership = await db.get(AcceleratorMembership, submission.membership_id)
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
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    rows = (await db.execute(select(AcceleratorEvent).where(
        AcceleratorEvent.cohort_id == cohort.id,
        AcceleratorEvent.status != "archived",
    ).order_by(AcceleratorEvent.starts_at))).scalars().all()
    counts = dict((await db.execute(
        select(AcceleratorAttendanceRecord.event_id, func.count(AcceleratorAttendanceRecord.id))
        .where(AcceleratorAttendanceRecord.status == "present")
        .group_by(AcceleratorAttendanceRecord.event_id)
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
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    rows = (await db.execute(
        select(AcceleratorMembership, User, AcceleratorAttendanceRecord)
        .join(User, User.id == AcceleratorMembership.user_id)
        .outerjoin(AcceleratorAttendanceRecord, (
            (AcceleratorAttendanceRecord.membership_id == AcceleratorMembership.id)
            & (AcceleratorAttendanceRecord.event_id == event.id)
        ))
        .where(AcceleratorMembership.cohort_id == cohort.id,
               AcceleratorMembership.role == "resident",
               AcceleratorMembership.status == "enrolled")
        .order_by(User.name)
    )).all()
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
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    membership = await db.get(AcceleratorMembership, payload.membership_id)
    if not membership or membership.cohort_id != cohort.id or membership.status != "enrolled":
        raise HTTPException(status_code=422, detail="Резидент не зачислен в этот поток")
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
    await require_cohort_manager(db, user, cohort)
    rows = (await db.execute(
        select(AcceleratorMembership, User)
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(AcceleratorMembership.cohort_id == cohort.id, AcceleratorMembership.role == "resident")
        .order_by(AcceleratorMembership.created_at.desc())
    )).all()
    return [{
        "membership_id": membership.id,
        "user_id": resident.id,
        "name": resident.name,
        "email": resident.email,
        "status": membership.status,
        "accepted_at": membership.accepted_at,
        "enrolled_at": membership.enrolled_at,
    } for membership, resident in rows]


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
