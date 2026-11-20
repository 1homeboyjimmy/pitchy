"""Attendance corrections remain pending until an organizer reviews them."""
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_async_current_user
from db_async import get_async_db
from models import AcceleratorAttendanceCorrection as Correction, AcceleratorEvent, AcceleratorFile, AcceleratorMembership, User
from accelerator_service import add_audit, require_cohort_manager
from accelerator_team_attendance import record_team_attendance, team_attendance_members
from routers.accelerators import (
    accelerator_file_dict, attendance_write_context, get_cohort_or_404,
    get_resident_membership, require_attendance_module, save_accelerator_file,
)

router = APIRouter(prefix="/api/accelerators", tags=["attendance-corrections"])


class CorrectionCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    was_present: bool
    description: str = Field(min_length=3, max_length=5000)
    attachments: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("full_name", "description", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class CorrectionReview(BaseModel):
    decision: Literal["approved", "rejected"]
    comment: str = Field(default="", max_length=3000)


def correction_dict(row):
    return {key: getattr(row, key) for key in (
        "id", "event_id", "membership_id", "full_name", "was_present", "description",
        "attachments", "status", "review_comment", "reviewed_at", "created_at",
    )}


async def resident_event_context(db, membership_id, event_id, user):
    # Lock event first, matching QR/manual attendance lock ordering.
    event, cohort = await attendance_write_context(db, event_id, edit_event=True)
    membership = await get_resident_membership(db, membership_id, user)
    if membership.cohort_id != cohort.id:
        raise HTTPException(404, "Мероприятие не найдено")
    if event.status not in {"published", "completed"} or event.ends_at > datetime.utcnow():
        raise HTTPException(409, "Заявку можно подать после завершения мероприятия")
    return membership, event, cohort


@router.get("/memberships/{membership_id}/attendance-corrections")
async def resident_corrections(membership_id: int, user: User = Depends(get_async_current_user), db: AsyncSession = Depends(get_async_db)):
    membership = await get_resident_membership(db, membership_id, user)
    cohort = await get_cohort_or_404(db, membership.cohort_id)
    await require_attendance_module(db, cohort)
    rows = (await db.execute(select(Correction).where(Correction.membership_id == membership.id)
                            .order_by(Correction.created_at.desc()).limit(200))).scalars().all()
    return {"full_name": user.name, "items": [correction_dict(row) for row in rows]}


@router.post("/memberships/{membership_id}/events/{event_id}/attendance-corrections/files")
async def upload_correction_file(membership_id: int, event_id: int, file: UploadFile = File(...),
                                 user: User = Depends(get_async_current_user), db: AsyncSession = Depends(get_async_db)):
    _, _, cohort = await resident_event_context(db, membership_id, event_id, user)
    if Path(file.filename or "").suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".pdf"}:
        raise HTTPException(415, "Приложите изображение JPG, PNG, WebP или PDF")
    row = await save_accelerator_file(db, cohort=cohort, upload=file,
                                      purpose="attendance_correction_draft", uploader_user_id=user.id)
    return accelerator_file_dict(row)


@router.post("/memberships/{membership_id}/events/{event_id}/attendance-corrections", status_code=201)
async def create_correction(membership_id: int, event_id: int, payload: CorrectionCreate,
                             user: User = Depends(get_async_current_user), db: AsyncSession = Depends(get_async_db)):
    membership, event, cohort = await resident_event_context(db, membership_id, event_id, user)
    pending = await db.scalar(select(Correction.id).where(Correction.membership_id == membership.id,
                                Correction.event_id == event.id, Correction.status == "pending"))
    if pending:
        raise HTTPException(409, "Заявка по этому мероприятию уже находится на проверке")
    attachments = []
    for url in dict.fromkeys(payload.attachments):
        prefix = "/api/accelerators/files/"
        if not url.startswith(prefix) or "/" in url[len(prefix):] or "?" in url:
            raise HTTPException(422, "Недоступное вложение")
        file = await db.scalar(select(AcceleratorFile).where(AcceleratorFile.token == url[len(prefix):]).with_for_update())
        if (not file or file.uploader_user_id != user.id or file.cohort_id != cohort.id
                or file.purpose != "attendance_correction_draft"):
            raise HTTPException(422, "Недоступное вложение")
        file.purpose = "attendance_correction"
        attachments.append(accelerator_file_dict(file))
    row = Correction(cohort_id=cohort.id, membership_id=membership.id, event_id=event.id,
                     full_name=payload.full_name, was_present=payload.was_present,
                     description=payload.description, attachments=attachments)
    db.add(row)
    try:
        await db.flush()
        add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=user.id,
                  action="attendance_correction.created", target_type="attendance_correction", target_id=row.id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Заявка по этому мероприятию уже находится на проверке")
    return correction_dict(row)


@router.get("/cohorts/{cohort_id}/attendance-corrections")
async def organizer_corrections(cohort_id: int, status: Literal["pending", "approved", "rejected", "all"] = "pending",
                                 offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100),
                                 user: User = Depends(get_async_current_user), db: AsyncSession = Depends(get_async_db)):
    cohort = await get_cohort_or_404(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await require_attendance_module(db, cohort)
    filters = [Correction.cohort_id == cohort.id]
    if status != "all":
        filters.append(Correction.status == status)
    total = await db.scalar(select(func.count()).select_from(Correction).where(*filters))
    pending = await db.scalar(select(func.count()).select_from(Correction).where(Correction.cohort_id == cohort.id, Correction.status == "pending"))
    rows = (await db.execute(select(Correction, AcceleratorEvent, User).join(AcceleratorEvent, AcceleratorEvent.id == Correction.event_id)
            .join(AcceleratorMembership, AcceleratorMembership.id == Correction.membership_id)
            .join(User, User.id == AcceleratorMembership.user_id).where(*filters)
            .order_by(Correction.created_at.desc(), Correction.id.desc()).offset(offset).limit(limit))).all()
    return {"total": total, "pending": pending, "timezone": cohort.timezone, "team_attendance": cohort.attendance_scope == "team", "items": [
        {**correction_dict(row), "event_title": event.title, "event_starts_at": event.starts_at,
         "account_name": person.name, "account_email": person.email} for row, event, person in rows]}


@router.patch("/attendance-corrections/{correction_id}")
async def review_correction(correction_id: int, payload: CorrectionReview,
                             user: User = Depends(get_async_current_user), db: AsyncSession = Depends(get_async_db)):
    existing = await db.get(Correction, correction_id)
    if not existing:
        raise HTTPException(404, "Заявка не найдена")
    cohort = await get_cohort_or_404(db, existing.cohort_id)
    await require_cohort_manager(db, user, cohort)
    event, cohort = await attendance_write_context(db, existing.event_id, edit_event=True)
    row = await db.scalar(select(Correction).where(Correction.id == correction_id).with_for_update().execution_options(populate_existing=True))
    if row.status != "pending":
        raise HTTPException(409, "Заявка уже рассмотрена. Обновите список")
    if payload.decision == "approved":
        if event.status not in {"published", "completed"} or event.ends_at > datetime.utcnow():
            raise HTTPException(409, "Нельзя изменить посещаемость этого мероприятия")
        membership = await db.scalar(select(AcceleratorMembership).where(AcceleratorMembership.id == row.membership_id)
                                      .with_for_update().execution_options(populate_existing=True))
        if membership.status != "enrolled":
            raise HTTPException(409, "Участник больше не зачислен в поток")
        members = await team_attendance_members(db, cohort, membership) if cohort.attendance_scope == "team" else [membership]
        await record_team_attendance(db, cohort=cohort, event=event, members=members, actor=user,
                                     status="present" if row.was_present else "absent", method="manual",
                                     comment=f"Заявка на корректировку №{row.id}. {payload.comment}".strip())
    row.status = payload.decision
    row.review_comment = payload.comment.strip() or None
    row.reviewed_by_user_id = user.id
    row.reviewed_at = datetime.utcnow()
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=user.id,
              action=f"attendance_correction.{row.status}", target_type="attendance_correction", target_id=row.id,
              details={"membership_id": row.membership_id, "event_id": row.event_id, "was_present": row.was_present})
    await db.commit()
    return correction_dict(row)
