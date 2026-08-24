"""Private in-app notification center for accelerator events."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_async_current_user
from db_async import get_async_db
from models import (
    AcceleratorNotification,
    AcceleratorNotificationPreference,
    User,
)
from schemas.notifications import (
    AcceleratorNotificationPage,
    AcceleratorNotificationPreferenceResponse,
    AcceleratorNotificationPreferenceUpdate,
    AcceleratorNotificationReadAllResponse,
    AcceleratorNotificationResponse,
    AcceleratorNotificationUnreadCount,
)


router = APIRouter(prefix="/api/accelerators", tags=["accelerator-notifications"])


def _notification_response(row: AcceleratorNotification) -> AcceleratorNotificationResponse:
    return AcceleratorNotificationResponse(
        id=row.id,
        accelerator_id=row.accelerator_id,
        cohort_id=row.cohort_id,
        membership_id=row.membership_id,
        event_type=row.event_type,
        title=row.title,
        body=row.body,
        action_url=row.action_url,
        metadata=row.event_metadata or {},
        read_at=row.read_at,
        is_read=row.read_at is not None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/notifications", response_model=AcceleratorNotificationPage)
async def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    cursor: int | None = Query(default=None, gt=0),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> AcceleratorNotificationPage:
    query = select(AcceleratorNotification).where(
        AcceleratorNotification.user_id == user.id
    )
    if unread_only:
        query = query.where(AcceleratorNotification.read_at.is_(None))
    if cursor is not None:
        query = query.where(AcceleratorNotification.id < cursor)
    rows = list((await db.execute(
        query.order_by(AcceleratorNotification.id.desc()).limit(limit + 1)
    )).scalars().all())
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    return AcceleratorNotificationPage(
        items=[_notification_response(row) for row in page_rows],
        next_cursor=page_rows[-1].id if has_more and page_rows else None,
    )


@router.get(
    "/notifications/unread-count",
    response_model=AcceleratorNotificationUnreadCount,
)
async def unread_notification_count(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> AcceleratorNotificationUnreadCount:
    count = (await db.execute(
        select(func.count(AcceleratorNotification.id)).where(
            AcceleratorNotification.user_id == user.id,
            AcceleratorNotification.read_at.is_(None),
        )
    )).scalar_one()
    return AcceleratorNotificationUnreadCount(count=count)


@router.patch(
    "/notifications/{notification_id}/read",
    response_model=AcceleratorNotificationResponse,
)
async def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> AcceleratorNotificationResponse:
    row = (await db.execute(
        select(AcceleratorNotification).where(
            AcceleratorNotification.id == notification_id,
            AcceleratorNotification.user_id == user.id,
        ).with_for_update()
    )).scalar_one_or_none()
    if not row:
        # The same response is used for absent and foreign rows to avoid
        # disclosing another user's notification identifiers.
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    if row.read_at is None:
        row.read_at = datetime.utcnow()
        await db.commit()
        await db.refresh(row)
    return _notification_response(row)


@router.post(
    "/notifications/read-all",
    response_model=AcceleratorNotificationReadAllResponse,
)
async def mark_all_notifications_read(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> AcceleratorNotificationReadAllResponse:
    now = datetime.utcnow()
    result = await db.execute(
        update(AcceleratorNotification)
        .where(
            AcceleratorNotification.user_id == user.id,
            AcceleratorNotification.read_at.is_(None),
        )
        .values(read_at=now, updated_at=now)
    )
    await db.commit()
    return AcceleratorNotificationReadAllResponse(
        updated=max(result.rowcount or 0, 0),
        read_at=now,
    )


@router.get(
    "/notifications/preferences",
    response_model=AcceleratorNotificationPreferenceResponse,
)
async def get_notification_preferences(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> AcceleratorNotificationPreferenceResponse:
    preference = (await db.execute(
        select(AcceleratorNotificationPreference).where(
            AcceleratorNotificationPreference.user_id == user.id
        )
    )).scalar_one_or_none()
    return AcceleratorNotificationPreferenceResponse(
        email_enabled=preference.email_enabled if preference else True
    )


@router.patch(
    "/notifications/preferences",
    response_model=AcceleratorNotificationPreferenceResponse,
)
async def update_notification_preferences(
    payload: AcceleratorNotificationPreferenceUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> AcceleratorNotificationPreferenceResponse:
    now = datetime.utcnow()
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:  # pragma: no cover - supported deployments use PostgreSQL/SQLite.
        raise RuntimeError(f"Unsupported notification database dialect: {dialect}")
    statement = insert(AcceleratorNotificationPreference).values(
        user_id=user.id,
        email_enabled=payload.email_enabled,
        created_at=now,
        updated_at=now,
    ).on_conflict_do_update(
        index_elements=["user_id"],
        set_={"email_enabled": payload.email_enabled, "updated_at": now},
    )
    await db.execute(statement)
    await db.commit()
    return AcceleratorNotificationPreferenceResponse(
        email_enabled=payload.email_enabled
    )
