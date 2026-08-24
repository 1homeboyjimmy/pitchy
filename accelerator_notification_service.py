"""Durable accelerator notification outbox with retryable email delivery."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db_async import AsyncSessionLocal
from email_utils import send_email
from models import (
    AcceleratorCohort,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission,
    AcceleratorHomeworkTarget,
    AcceleratorMembership,
    AcceleratorNotification,
    AcceleratorNotificationOutbox,
    AcceleratorNotificationPreference,
    AcceleratorProgramConfig,
    User,
)


logger = logging.getLogger(__name__)


def _insert_do_nothing(db: AsyncSession, model, values: dict, conflict_column: str):
    """Build a portable idempotent insert for supported production/test DBs."""
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:  # pragma: no cover - the application supports PostgreSQL and SQLite.
        raise RuntimeError(f"Unsupported notification database dialect: {dialect}")
    return insert(model).values(**values).on_conflict_do_nothing(
        index_elements=[conflict_column]
    )


async def _active_recipient(
    db: AsyncSession,
    *,
    recipient_email: str,
    recipient_user_id: int | None,
) -> User | None:
    filters = [
        User.is_active.is_(True),
        User.deleted_at.is_(None),
        func.lower(User.email) == recipient_email,
    ]
    if recipient_user_id is not None:
        return (await db.execute(
            select(User).where(User.id == recipient_user_id, *filters)
        )).scalar_one_or_none()
    return (await db.execute(select(User).where(*filters))).scalar_one_or_none()


async def enqueue_notification(
    db: AsyncSession,
    *,
    accelerator_id: int,
    cohort_id: int | None,
    recipient_email: str,
    event_type: str,
    subject: str,
    body: str,
    idempotency_key: str,
    recipient_user_id: int | None = None,
    action_url: str | None = None,
    membership_id: int | None = None,
    event_metadata: dict | None = None,
) -> AcceleratorNotificationOutbox:
    normalized_email = recipient_email.strip().lower()
    recipient = await _active_recipient(
        db,
        recipient_email=normalized_email,
        recipient_user_id=recipient_user_id,
    )
    now = datetime.utcnow()

    # Outbox and in-app delivery use independent unique keys inside the same
    # caller-owned transaction. This also repairs a historical outbox event
    # that was committed before in-app notifications existed.
    await db.execute(_insert_do_nothing(
        db,
        AcceleratorNotificationOutbox.__table__,
        {
            "accelerator_id": accelerator_id,
            "cohort_id": cohort_id,
            "recipient_user_id": recipient.id if recipient else None,
            "recipient_email": normalized_email,
            "event_type": event_type,
            "subject": subject,
            "body": body,
            "status": "pending",
            "attempts": 0,
            "idempotency_key": idempotency_key,
            "available_at": now,
            "created_at": now,
        },
        "idempotency_key",
    ))
    existing = (await db.execute(
        select(AcceleratorNotificationOutbox).where(
            AcceleratorNotificationOutbox.idempotency_key == idempotency_key
        )
    )).scalar_one_or_none()
    if existing is None:  # Defensive: the insert/select run on one transaction.
        raise RuntimeError("Notification outbox insert was not persisted")
    if (
        existing.recipient_email.strip().lower() != normalized_email
        or existing.accelerator_id != accelerator_id
        or existing.cohort_id != cohort_id
        or existing.event_type != event_type
    ):
        raise ValueError("idempotency_key is already used by another notification")
    if existing.recipient_user_id is not None:
        recipient = await _active_recipient(
            db,
            recipient_email=normalized_email,
            recipient_user_id=existing.recipient_user_id,
        )
    if recipient and existing.recipient_user_id is None:
        existing.recipient_user_id = recipient.id

    if recipient:
        await db.execute(_insert_do_nothing(
            db,
            # Use the raw table here because the database column is named
            # ``metadata`` while the safe Declarative attribute is
            # ``event_metadata`` (``Base.metadata`` is reserved).
            AcceleratorNotification.__table__,
            {
                "user_id": recipient.id,
                "accelerator_id": existing.accelerator_id,
                "cohort_id": existing.cohort_id,
                "membership_id": membership_id,
                "event_type": existing.event_type,
                "title": existing.subject,
                "body": existing.body,
                "action_url": action_url,
                "metadata": event_metadata or {},
                "read_at": None,
                "idempotency_key": idempotency_key,
                "created_at": now,
                "updated_at": now,
            },
            "idempotency_key",
        ))
    await db.flush()
    return existing


async def process_notification_event(event_id: int) -> bool:
    """Send one committed outbox event. Failures remain retryable."""
    async with AsyncSessionLocal() as db:
        event = (await db.execute(
            select(AcceleratorNotificationOutbox)
            .where(AcceleratorNotificationOutbox.id == event_id)
            .with_for_update()
        )).scalar_one_or_none()
        if not event or event.status in ("sent", "suppressed"):
            return bool(event)
        if event.available_at > datetime.utcnow():
            return False

        recipient = None
        if event.recipient_user_id is not None:
            recipient = (await db.execute(select(User).where(
                User.id == event.recipient_user_id,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
                func.lower(User.email) == event.recipient_email.strip().lower(),
            ))).scalar_one_or_none()
            if recipient is None:
                event.status = "suppressed"
                event.last_error = None
                await db.commit()
                return True
        else:
            recipient = await _active_recipient(
                db,
                recipient_email=event.recipient_email.strip().lower(),
                recipient_user_id=None,
            )
            if recipient:
                event.recipient_user_id = recipient.id

        if recipient:
            preference = (await db.execute(
                select(AcceleratorNotificationPreference).where(
                    AcceleratorNotificationPreference.user_id == recipient.id
                )
            )).scalar_one_or_none()
            if preference and not preference.email_enabled:
                event.status = "suppressed"
                event.last_error = None
                await db.commit()
                return True
        try:
            await asyncio.to_thread(
                send_email,
                event.recipient_email,
                event.subject,
                event.body,
                "noreply",
            )
        except Exception as exc:
            event.attempts += 1
            event.status = "pending" if event.attempts < 8 else "failed"
            event.last_error = str(exc)[:2000]
            event.available_at = datetime.utcnow() + timedelta(minutes=min(60, 2 ** min(event.attempts, 6)))
            await db.commit()
            return False
        event.attempts += 1
        event.status = "sent"
        event.sent_at = datetime.utcnow()
        event.last_error = None
        await db.commit()
        return True


async def process_pending_notifications(limit: int = 50) -> dict[str, int]:
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(
            select(AcceleratorNotificationOutbox.id)
            .where(
                AcceleratorNotificationOutbox.status == "pending",
                AcceleratorNotificationOutbox.available_at <= datetime.utcnow(),
            )
            .order_by(AcceleratorNotificationOutbox.created_at)
            .limit(limit)
        )).scalars().all()
    sent = 0
    for event_id in ids:
        sent += int(await process_notification_event(event_id))
    return {"selected": len(ids), "sent": sent, "failed_or_deferred": len(ids) - sent}


async def enqueue_due_homework_reminders(
    *, now: datetime | None = None, window_hours: int = 24
) -> dict[str, int]:
    """Queue one reminder for homework entering the deadline window."""
    now = now or datetime.utcnow()
    deadline = now + timedelta(hours=window_hours)
    frontend_url = os.getenv("FRONTEND_URL", "https://pitchy.pro").rstrip("/")
    eligible = 0
    created = 0
    async with AsyncSessionLocal() as db:
        assignments = (await db.execute(
            select(
                AcceleratorHomeworkAssignment,
                AcceleratorCohort,
                AcceleratorProgramConfig,
            )
            .join(
                AcceleratorCohort,
                AcceleratorCohort.id == AcceleratorHomeworkAssignment.cohort_id,
            )
            .join(
                AcceleratorProgramConfig,
                AcceleratorProgramConfig.cohort_id == AcceleratorCohort.id,
            )
            .where(
                AcceleratorHomeworkAssignment.status == "published",
                AcceleratorHomeworkAssignment.due_at.is_not(None),
                AcceleratorHomeworkAssignment.due_at >= now,
                AcceleratorHomeworkAssignment.due_at <= deadline,
            )
        )).all()
        for assignment, cohort, config in assignments:
            if not (config.modules or {}).get("homework"):
                continue
            recipient_query = (
                select(AcceleratorMembership, User)
                .join(User, User.id == AcceleratorMembership.user_id)
                .where(
                    AcceleratorMembership.cohort_id == cohort.id,
                    AcceleratorMembership.role == "resident",
                    AcceleratorMembership.status == "enrolled",
                    User.is_active.is_(True),
                    User.deleted_at.is_(None),
                )
            )
            if assignment.audience == "selected":
                target_ids = select(AcceleratorHomeworkTarget.membership_id).where(
                    AcceleratorHomeworkTarget.assignment_id == assignment.id
                )
                recipient_query = recipient_query.where(
                    AcceleratorMembership.id.in_(target_ids)
                )
            recipients = (await db.execute(recipient_query)).all()
            inactive_ids = set((await db.execute(
                select(AcceleratorHomeworkSubmission.membership_id).where(
                    AcceleratorHomeworkSubmission.assignment_id == assignment.id,
                    AcceleratorHomeworkSubmission.status.in_(("submitted", "accepted")),
                )
            )).scalars().all())
            for membership, resident in recipients:
                if membership.id in inactive_ids:
                    continue
                eligible += 1
                key = (
                    f"homework-deadline-{window_hours}h:{assignment.id}:"
                    f"{membership.id}:{assignment.due_at.isoformat()}"
                )
                exists = (await db.execute(
                    select(AcceleratorNotificationOutbox.id).where(
                        AcceleratorNotificationOutbox.idempotency_key == key
                    )
                )).scalar_one_or_none()
                if exists is not None:
                    continue
                try:
                    timezone_name = cohort.timezone or "Europe/Moscow"
                    try:
                        cohort_timezone = ZoneInfo(timezone_name)
                    except ZoneInfoNotFoundError:
                        timezone_name = "UTC"
                        cohort_timezone = timezone.utc
                    local_due_at = assignment.due_at.replace(
                        tzinfo=timezone.utc
                    ).astimezone(cohort_timezone)
                    async with db.begin_nested():
                        await enqueue_notification(
                            db,
                            accelerator_id=cohort.accelerator_id,
                            cohort_id=cohort.id,
                            recipient_email=resident.email,
                            event_type="homework_deadline_reminder",
                            subject=f"Скоро дедлайн: {assignment.title}",
                            body=(
                                f"Здравствуйте, {resident.name}!\n\nДо дедлайна задания "
                                f"«{assignment.title}» осталось меньше {window_hours} часов.\n"
                                f"Дедлайн: {local_due_at.strftime('%d.%m.%Y %H:%M')} "
                                f"({timezone_name}).\n\nОткрыть: {frontend_url}/accelerator"
                            ),
                            idempotency_key=key,
                        )
                    created += 1
                except IntegrityError:
                    # Another application instance created the same durable
                    # reminder after our existence check.
                    continue
        await db.commit()
    return {"eligible": eligible, "created": created}


async def run_accelerator_notifications_loop(interval_seconds: int = 300) -> None:
    """Generate deadline reminders and drain the durable outbox."""
    while True:
        try:
            reminders = await enqueue_due_homework_reminders()
            delivery = await process_pending_notifications()
            if reminders["created"] or delivery["selected"]:
                logger.info(
                    "Accelerator notifications: reminders=%s delivery=%s",
                    reminders,
                    delivery,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Accelerator notification loop failed")
        await asyncio.sleep(interval_seconds)
