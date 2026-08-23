"""Application lifecycle and atomic admission into an accelerator cohort."""
from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import os
import secrets

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

import passport as passport_lib
from accelerator_notification_service import enqueue_notification
from auth import hash_password
from models import (
    Accelerator,
    AcceleratorApplication,
    AcceleratorApplicationEvent,
    AcceleratorCohort,
    AcceleratorInvitation,
    AcceleratorMembership,
    AcceleratorMembershipEvent,
    AcceleratorParticipantProfile,
    Project,
    User,
)


MANAGER_TRANSITIONS: dict[str, set[str]] = {
    "submitted": {"under_review", "needs_info", "waitlisted", "approved", "rejected", "archived"},
    "under_review": {"needs_info", "waitlisted", "approved", "rejected", "archived"},
    "needs_info": {"under_review", "approved", "rejected", "archived"},
    "waitlisted": {"under_review", "approved", "rejected", "archived"},
    "approved": {"archived"},
    "rejected": {"archived"},
}


def record_application_event(
    db: AsyncSession,
    *,
    application: AcceleratorApplication,
    to_status: str,
    actor_user_id: int | None,
    comment: str | None = None,
) -> None:
    previous = application.status
    application.status = to_status
    application.updated_at = datetime.utcnow()
    db.add(AcceleratorApplicationEvent(
        application_id=application.id,
        from_status=previous,
        to_status=to_status,
        actor_user_id=actor_user_id,
        comment=comment,
    ))


def transition_application(
    db: AsyncSession,
    *,
    application: AcceleratorApplication,
    to_status: str,
    actor_user_id: int | None,
    comment: str | None = None,
) -> None:
    allowed = MANAGER_TRANSITIONS.get(application.status, set())
    if to_status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Недопустимый переход заявки: {application.status} → {to_status}",
        )
    record_application_event(
        db,
        application=application,
        to_status=to_status,
        actor_user_id=actor_user_id,
        comment=comment,
    )


def _project_passport_fields(payload: dict) -> dict:
    mapping = {
        "project_name": "core.name",
        "problem": "core.problem",
        "solution": "core.solution",
        "target_audience": "core.target_audience",
        "stage": "core.stage",
        "business_model": "core.business_model",
        "geo": "core.geo",
        "market_size": "market.size",
        "competitors": "market.competitors",
        "mrr": "metrics.mrr",
        "users": "metrics.users",
        "team": "team",
        "entity_type": "legal.entity_type",
    }
    fields = {
        passport_path: payload[key]
        for key, passport_path in mapping.items()
        if payload.get(key) not in (None, "", [])
    }
    fields["custom.accelerator_application"] = {
        key: value for key, value in payload.items() if value not in (None, "", [])
    }
    return fields


def _merge_application_passport(project: Project, form_payload: dict) -> None:
    fields = _project_passport_fields(form_payload)
    safe_fields = {
        path: value
        for path, value in fields.items()
        if passport_lib.field_source(project.passport or {}, path) != "manual"
    }
    merged = passport_lib.merge_patch(project.passport or {}, safe_fields, source="application")
    project.passport = merged
    project.readiness_index = passport_lib.compute_readiness(merged)
    project.passport_updated_at = datetime.utcnow()
    flag_modified(project, "passport")


async def _resolve_user(db: AsyncSession, application: AcceleratorApplication) -> tuple[User, bool]:
    if application.user_id:
        user = await db.get(User, application.user_id)
        if user:
            return user, False
    email = (application.applicant_email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=422, detail="В заявке отсутствует email")
    user = (await db.execute(
        select(User).where(func.lower(User.email) == email, User.deleted_at.is_(None))
    )).scalar_one_or_none()
    if user:
        application.user_id = user.id
        return user, False
    user = User(
        email=email,
        name=(application.applicant_name or email.split("@", 1)[0])[:120],
        password_hash=None,
        email_verified=False,
        privacy_consent_at=application.privacy_consent_at,
    )
    db.add(user)
    await db.flush()
    application.user_id = user.id
    return user, True


async def _resolve_project(
    db: AsyncSession, application: AcceleratorApplication, user: User
) -> Project | None:
    if application.application_type == "participant":
        return None
    project = None
    if application.project_id:
        project = (await db.execute(select(Project).where(
            Project.id == application.project_id,
            Project.user_id == user.id,
        ))).scalar_one_or_none()
    if project is None:
        name = (
            application.form_payload.get("project_name")
            or application.form_payload.get("name")
            or "Проект из заявки"
        )
        project = Project(user_id=user.id, name=str(name)[:200], passport={})
        db.add(project)
        await db.flush()
        application.project_id = project.id
    _merge_application_passport(project, application.form_payload or {})
    return project


async def _create_invitation(
    db: AsyncSession, application: AcceleratorApplication, user: User
) -> tuple[AcceleratorInvitation, str]:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    invitation = (await db.execute(select(AcceleratorInvitation).where(
        AcceleratorInvitation.application_id == application.id
    ))).scalar_one_or_none()
    if invitation is None:
        invitation = AcceleratorInvitation(
            application_id=application.id,
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.utcnow() + timedelta(hours=72),
        )
        db.add(invitation)
    elif invitation.accepted_at is None:
        invitation.token_hash = token_hash
        invitation.expires_at = datetime.utcnow() + timedelta(hours=72)
    await db.flush()
    return invitation, raw_token


async def approve_application(
    db: AsyncSession,
    *,
    application: AcceleratorApplication,
    cohort: AcceleratorCohort,
    accelerator: Accelerator,
    actor_user_id: int,
    comment: str | None,
) -> dict:
    existing_membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.application_id == application.id
    ))).scalar_one_or_none()
    if application.status == "approved" and existing_membership:
        return {
            "membership": existing_membership,
            "user": await db.get(User, existing_membership.user_id),
            "project": await db.get(Project, existing_membership.project_id) if existing_membership.project_id else None,
            "notification": None,
            "created_user": False,
        }
    if "approved" not in MANAGER_TRANSITIONS.get(application.status, set()):
        raise HTTPException(status_code=409, detail="Эту заявку нельзя одобрить из текущего статуса")

    user, created_user = await _resolve_user(db, application)
    project = await _resolve_project(db, application, user)
    now = datetime.utcnow()
    membership = AcceleratorMembership(
        cohort_id=cohort.id,
        user_id=user.id,
        project_id=project.id if project else None,
        application_id=application.id,
        role="resident",
        status="accepted",
        accepted_by_user_id=actor_user_id,
        accepted_at=now,
    )
    db.add(membership)
    await db.flush()
    db.add(AcceleratorMembershipEvent(
        membership_id=membership.id,
        from_status=None,
        to_status="accepted",
        actor_user_id=actor_user_id,
        reason=comment or "Заявка одобрена",
    ))
    db.add(AcceleratorParticipantProfile(
        membership_id=membership.id,
        profile={
            "name": application.applicant_name or user.name,
            "email": application.applicant_email or user.email,
            "application_type": application.application_type,
            "application_data": application.form_payload or {},
        },
        visibility={"organizer": True, "mentor": False, "public": False},
    ))
    transition_application(
        db,
        application=application,
        to_status="approved",
        actor_user_id=actor_user_id,
        comment=comment,
    )
    application.reviewed_by_user_id = actor_user_id
    application.review_comment = comment
    application.reviewed_at = now

    frontend_url = os.getenv("FRONTEND_URL", "https://pitchy.pro").rstrip("/")
    if created_user or not user.password_hash:
        _, raw_token = await _create_invitation(db, application, user)
        action_url = f"{frontend_url}/accelerator-invite?token={raw_token}"
        subject = f"Вы приняты в акселератор «{accelerator.name}»"
        body = (
            f"Здравствуйте, {user.name}!\n\n"
            f"Ваша заявка в поток «{cohort.name}» одобрена. "
            f"Установите пароль и активируйте единый аккаунт Pitchy по ссылке:\n\n{action_url}\n\n"
            "Ссылка действует 72 часа и может быть использована один раз."
        )
    else:
        action_url = f"{frontend_url}/login"
        subject = f"Вы приняты в акселератор «{accelerator.name}»"
        body = (
            f"Здравствуйте, {user.name}!\n\n"
            f"Ваша заявка в поток «{cohort.name}» одобрена. "
            f"Войдите в существующий аккаунт Pitchy:\n\n{action_url}"
        )
    notification = await enqueue_notification(
        db,
        accelerator_id=accelerator.id,
        cohort_id=cohort.id,
        recipient_email=user.email,
        event_type="application_approved",
        subject=subject,
        body=body,
        idempotency_key=f"application-approved:{application.id}",
    )
    return {
        "membership": membership,
        "user": user,
        "project": project,
        "notification": notification,
        "created_user": created_user,
    }


async def accept_invitation(db: AsyncSession, token: str, password: str) -> User:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    invitation = (await db.execute(
        select(AcceleratorInvitation)
        .where(AcceleratorInvitation.token_hash == token_hash)
        .with_for_update()
    )).scalar_one_or_none()
    if not invitation or invitation.accepted_at is not None or invitation.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Ссылка недействительна или срок её действия истёк")
    user = await db.get(User, invitation.user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user.password_hash = hash_password(password)
    user.email_verified = True
    invitation.accepted_at = datetime.utcnow()
    return user
