from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

import accelerator_notification_service as notification_service
from accelerator_notification_service import (
    enqueue_notification,
    process_notification_event,
)
from db_async import AsyncSessionLocal
from models import (
    Accelerator,
    AcceleratorNotification,
    AcceleratorNotificationOutbox,
    AcceleratorNotificationPreference,
    User,
)
from routers.accelerator_notifications import (
    get_notification_preferences,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    unread_notification_count,
    update_notification_preferences,
)
from schemas.notifications import AcceleratorNotificationPreferenceUpdate


@pytest.mark.asyncio
async def test_enqueue_notification_is_atomic_and_idempotent_under_race():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        recipient = User(
            email=f"notifications-{suffix}@example.test",
            name="Notification recipient",
        )
        inactive = User(
            email=f"notifications-inactive-{suffix}@example.test",
            name="Inactive recipient",
            is_active=False,
        )
        db.add_all([recipient, inactive])
        await db.flush()
        accelerator = Accelerator(
            name="Notification accelerator",
            created_by_user_id=recipient.id,
        )
        db.add(accelerator)
        await db.commit()
        recipient_id = recipient.id
        inactive_id = inactive.id
        accelerator_id = accelerator.id

    idempotency_key = f"notification-race:{suffix}"

    async def enqueue_once() -> int:
        async with AsyncSessionLocal() as db:
            event = await enqueue_notification(
                db,
                accelerator_id=accelerator_id,
                cohort_id=None,
                recipient_user_id=recipient_id,
                recipient_email=f"NOTIFICATIONS-{suffix}@EXAMPLE.TEST",
                event_type="test_race",
                subject="Одно событие",
                body="Это событие не должно задвоиться.",
                action_url="/accelerator?tab=homework",
                event_metadata={"source": "race-test"},
                idempotency_key=idempotency_key,
            )
            await db.commit()
            return event.id

    event_ids = await asyncio.gather(enqueue_once(), enqueue_once())
    assert event_ids[0] == event_ids[1]

    async with AsyncSessionLocal() as db:
        outbox_rows = (await db.execute(
            select(AcceleratorNotificationOutbox).where(
                AcceleratorNotificationOutbox.idempotency_key == idempotency_key
            )
        )).scalars().all()
        in_app_rows = (await db.execute(
            select(AcceleratorNotification).where(
                AcceleratorNotification.idempotency_key == idempotency_key
            )
        )).scalars().all()
        assert len(outbox_rows) == 1
        assert len(in_app_rows) == 1
        assert outbox_rows[0].recipient_user_id == recipient_id
        assert in_app_rows[0].user_id == recipient_id
        assert in_app_rows[0].action_url == "/accelerator?tab=homework"
        assert in_app_rows[0].event_metadata == {"source": "race-test"}

        await enqueue_notification(
            db,
            accelerator_id=accelerator_id,
            cohort_id=None,
            recipient_email=f"missing-{suffix}@example.test",
            event_type="email_only",
            subject="Email only",
            body="No account exists for this address.",
            idempotency_key=f"notification-email-only:{suffix}",
        )
        await enqueue_notification(
            db,
            accelerator_id=accelerator_id,
            cohort_id=None,
            recipient_user_id=inactive_id,
            recipient_email=f"notifications-inactive-{suffix}@example.test",
            event_type="inactive_email_only",
            subject="Inactive email only",
            body="Inactive accounts do not get in-app events.",
            idempotency_key=f"notification-inactive:{suffix}",
        )
        await db.commit()

        in_app_count = (await db.execute(
            select(func.count(AcceleratorNotification.id)).where(
                AcceleratorNotification.accelerator_id == accelerator_id
            )
        )).scalar_one()
        assert in_app_count == 1
        email_only_events = (await db.execute(
            select(AcceleratorNotificationOutbox).where(
                AcceleratorNotificationOutbox.idempotency_key.in_((
                    f"notification-email-only:{suffix}",
                    f"notification-inactive:{suffix}",
                ))
            )
        )).scalars().all()
        assert len(email_only_events) == 2
        assert all(event.recipient_user_id is None for event in email_only_events)


@pytest.mark.asyncio
async def test_notification_center_is_private_paginated_and_honors_preferences(
    monkeypatch,
):
    suffix = uuid.uuid4().hex[:10]
    sent_emails: list[tuple] = []
    monkeypatch.setattr(
        notification_service,
        "send_email",
        lambda *args: sent_emails.append(args),
    )

    async with AsyncSessionLocal() as db:
        alice = User(
            email=f"notifications-alice-{suffix}@example.test",
            name="Alice",
        )
        bob = User(
            email=f"notifications-bob-{suffix}@example.test",
            name="Bob",
        )
        db.add_all([alice, bob])
        await db.flush()
        accelerator = Accelerator(
            name="Private notification accelerator",
            created_by_user_id=alice.id,
        )
        db.add(accelerator)
        await db.commit()

        async def enqueue_for(
            user: User,
            sequence: str,
        ) -> AcceleratorNotificationOutbox:
            return await enqueue_notification(
                db,
                accelerator_id=accelerator.id,
                cohort_id=None,
                recipient_user_id=user.id,
                recipient_email=user.email,
                event_type="private_test",
                subject=f"Notification {sequence}",
                body=f"Private body {sequence}",
                idempotency_key=f"notification-private:{suffix}:{sequence}",
            )

        await enqueue_for(alice, "alice-oldest")
        await enqueue_for(bob, "bob-only")
        await enqueue_for(alice, "alice-middle")
        await enqueue_for(alice, "alice-newest")
        await db.commit()

        first_page = await list_notifications(
            unread_only=False,
            limit=2,
            cursor=None,
            user=alice,
            db=db,
        )
        assert len(first_page.items) == 2
        assert first_page.next_cursor is not None
        assert [item.title for item in first_page.items] == [
            "Notification alice-newest",
            "Notification alice-middle",
        ]
        assert all(not item.is_read for item in first_page.items)

        second_page = await list_notifications(
            unread_only=False,
            limit=2,
            cursor=first_page.next_cursor,
            user=alice,
            db=db,
        )
        assert [item.title for item in second_page.items] == [
            "Notification alice-oldest"
        ]
        assert second_page.next_cursor is None
        alice_ids = {item.id for item in first_page.items + second_page.items}
        assert len(alice_ids) == 3

        # A cursor obtained by another account is still evaluated inside the
        # current user's scope and cannot disclose Alice's rows.
        bob_page = await list_notifications(
            unread_only=False,
            limit=10,
            cursor=first_page.next_cursor,
            user=bob,
            db=db,
        )
        assert [item.title for item in bob_page.items] == ["Notification bob-only"]
        assert all(item.id not in alice_ids for item in bob_page.items)

        alice_count = await unread_notification_count(user=alice, db=db)
        bob_count = await unread_notification_count(user=bob, db=db)
        assert alice_count.count == 3
        assert bob_count.count == 1

        alice_notification_id = first_page.items[0].id
        with pytest.raises(HTTPException) as foreign_read:
            await mark_notification_read(
                notification_id=alice_notification_id,
                user=bob,
                db=db,
            )
        assert foreign_read.value.status_code == 404
        with pytest.raises(HTTPException) as missing_read:
            await mark_notification_read(
                notification_id=alice_notification_id + 1_000_000,
                user=bob,
                db=db,
            )
        assert missing_read.value.status_code == foreign_read.value.status_code
        assert missing_read.value.detail == foreign_read.value.detail

        read = await mark_notification_read(
            notification_id=alice_notification_id,
            user=alice,
            db=db,
        )
        assert read.is_read is True
        assert read.read_at is not None
        assert (await unread_notification_count(user=alice, db=db)).count == 2
        assert (await unread_notification_count(user=bob, db=db)).count == 1

        # Reading the same row and read-all are both safe to retry.
        repeated_read = await mark_notification_read(
            notification_id=alice_notification_id,
            user=alice,
            db=db,
        )
        assert repeated_read.read_at == read.read_at
        read_all = await mark_all_notifications_read(user=alice, db=db)
        assert read_all.updated == 2
        repeated_read_all = await mark_all_notifications_read(user=alice, db=db)
        assert repeated_read_all.updated == 0
        assert (await unread_notification_count(user=alice, db=db)).count == 0
        assert (await unread_notification_count(user=bob, db=db)).count == 1
        unread_page = await list_notifications(
            unread_only=True,
            limit=10,
            cursor=None,
            user=alice,
            db=db,
        )
        assert unread_page.items == []

        assert (
            await get_notification_preferences(user=alice, db=db)
        ).email_enabled is True
        assert (
            await get_notification_preferences(user=bob, db=db)
        ).email_enabled is True
        updated_preference = await update_notification_preferences(
            payload=AcceleratorNotificationPreferenceUpdate(email_enabled=False),
            user=alice,
            db=db,
        )
        assert updated_preference.email_enabled is False
        assert (
            await get_notification_preferences(user=alice, db=db)
        ).email_enabled is False
        assert (
            await get_notification_preferences(user=bob, db=db)
        ).email_enabled is True

        suppressed_event = await enqueue_for(alice, "alice-email-disabled")
        email_only_event = await enqueue_notification(
            db,
            accelerator_id=accelerator.id,
            cohort_id=None,
            recipient_email=f"no-account-{suffix}@example.test",
            event_type="email_only_delivery",
            subject="Email-only delivery",
            body="This address has no Pitchy account.",
            idempotency_key=f"notification-private:{suffix}:email-only",
        )
        await db.commit()
        suppressed_event_id = suppressed_event.id
        email_only_event_id = email_only_event.id

    assert await process_notification_event(suppressed_event_id) is True
    assert sent_emails == []
    assert await process_notification_event(email_only_event_id) is True
    assert len(sent_emails) == 1
    assert sent_emails[0][0] == f"no-account-{suffix}@example.test"

    async with AsyncSessionLocal() as db:
        suppressed_event = await db.get(
            AcceleratorNotificationOutbox, suppressed_event_id
        )
        email_only_event = await db.get(
            AcceleratorNotificationOutbox, email_only_event_id
        )
        assert suppressed_event is not None
        assert suppressed_event.status == "suppressed"
        assert email_only_event is not None
        assert email_only_event.status == "sent"
        assert email_only_event.recipient_user_id is None

        suppressed_in_app = (await db.execute(
            select(AcceleratorNotification).where(
                AcceleratorNotification.idempotency_key
                == f"notification-private:{suffix}:alice-email-disabled"
            )
        )).scalar_one()
        assert suppressed_in_app.user_id == alice.id
        assert suppressed_in_app.read_at is None
        email_only_in_app_count = (await db.execute(
            select(func.count(AcceleratorNotification.id)).where(
                AcceleratorNotification.idempotency_key
                == f"notification-private:{suffix}:email-only"
            )
        )).scalar_one()
        assert email_only_in_app_count == 0

        preference_rows = (await db.execute(
            select(AcceleratorNotificationPreference).where(
                AcceleratorNotificationPreference.user_id == alice.id
            )
        )).scalars().all()
        assert len(preference_rows) == 1
        assert preference_rows[0].email_enabled is False
