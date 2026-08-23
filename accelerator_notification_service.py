"""Durable accelerator notification outbox with retryable email delivery."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db_async import AsyncSessionLocal
from email_utils import send_email
from models import AcceleratorNotificationOutbox


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
) -> AcceleratorNotificationOutbox:
    existing = (await db.execute(
        select(AcceleratorNotificationOutbox).where(
            AcceleratorNotificationOutbox.idempotency_key == idempotency_key
        )
    )).scalar_one_or_none()
    if existing:
        return existing
    event = AcceleratorNotificationOutbox(
        accelerator_id=accelerator_id,
        cohort_id=cohort_id,
        recipient_email=recipient_email.strip().lower(),
        event_type=event_type,
        subject=subject,
        body=body,
        idempotency_key=idempotency_key,
    )
    db.add(event)
    await db.flush()
    return event


async def process_notification_event(event_id: int) -> bool:
    """Send one committed outbox event. Failures remain retryable."""
    async with AsyncSessionLocal() as db:
        event = (await db.execute(
            select(AcceleratorNotificationOutbox)
            .where(AcceleratorNotificationOutbox.id == event_id)
            .with_for_update()
        )).scalar_one_or_none()
        if not event or event.status == "sent":
            return bool(event)
        if event.available_at > datetime.utcnow():
            return False
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
