"""Configurable monthly subscriptions and atomic quota accounting."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from models import CustomSubscription, SubscriptionUsageEvent, User

BASE_PRICE = 2490
BASE_CONFIG = {"messages": 50, "roadmaps": 3, "custdev": 2, "grants": 0}
UNIT_PRICES = {"messages": 7, "roadmaps": 150, "custdev": 750, "grants": 1000}
RESOURCES = tuple(BASE_CONFIG)


def normalize_config(raw: dict[str, Any] | None) -> dict[str, int]:
    raw = raw or {}
    config: dict[str, int] = {}
    for resource, minimum in BASE_CONFIG.items():
        value = raw.get(resource, minimum)
        if isinstance(value, bool):
            raise ValueError(f"{resource}: ожидается целое число")
        try:
            value = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{resource}: ожидается целое число") from exc
        if value < minimum:
            raise ValueError(f"{resource}: минимум {minimum}")
        config[resource] = value
    if (config["messages"] - BASE_CONFIG["messages"]) % 10 != 0:
        raise ValueError("messages: дополнительные сообщения выбираются шагом 10")
    return config


def calculate_price(config: dict[str, Any] | None) -> int:
    normalized = normalize_config(config)
    return BASE_PRICE + sum(
        (normalized[key] - BASE_CONFIG[key]) * UNIT_PRICES[key] for key in RESOURCES
    )


def empty_usage() -> dict[str, int]:
    return {key: 0 for key in RESOURCES}


def is_active(subscription: CustomSubscription | None, now: datetime | None = None) -> bool:
    now = now or datetime.utcnow()
    return bool(
        subscription
        and subscription.status == "active"
        and subscription.current_period_end
        and subscription.current_period_end > now
    )


def require_legacy_access(user: User, resource: str) -> None:
    """Temporary bridge for paid legacy plans until their expiry date."""
    from plan_limits import get_limits_for, resolve_tier
    tier = resolve_tier(user.subscription_tier, user.subscription_expires_at)
    limits = get_limits_for(user.subscription_tier, user.subscription_expires_at)
    allowed = {
        "roadmaps": limits.can_use_tree,
        "custdev": limits.can_use_custdev,
        "grants": tier not in ("free", "tester"),
    }.get(resource, tier != "free")
    if not allowed:
        raise HTTPException(status_code=402, detail=f"{resource} недоступны без активной подписки")


async def get_subscription(db: AsyncSession, user_id: int, *, for_update: bool = False):
    query = select(CustomSubscription).where(CustomSubscription.user_id == user_id)
    if for_update:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


async def consume_quota(
    db: AsyncSession,
    user: User,
    resource: str,
    *,
    idempotency_key: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
    metadata: dict | None = None,
) -> bool:
    """Debit one custom-plan unit. Returns False for legacy users.

    The caller owns the transaction. A row lock plus a unique idempotency key
    prevents parallel requests and retries from spending more than once.
    """
    if user.is_admin:
        return True
    if resource not in RESOURCES:
        raise ValueError(f"Unknown quota resource: {resource}")

    existing = (await db.execute(
        select(SubscriptionUsageEvent).where(
            SubscriptionUsageEvent.idempotency_key == idempotency_key
        )
    )).scalar_one_or_none()
    if existing:
        return True

    subscription = await get_subscription(db, user.id, for_update=True)
    if not subscription:
        return False
    if not is_active(subscription):
        raise HTTPException(
            status_code=402,
            detail="subscription_inactive: подписка не активна или срок действия закончился",
        )

    config = normalize_config(subscription.current_config)
    used = {**empty_usage(), **(subscription.used or {})}
    if used[resource] >= config[resource]:
        raise HTTPException(
            status_code=402,
            detail=f"quota_exceeded: лимит {resource} исчерпан ({config[resource]})",
        )

    used[resource] += 1
    subscription.used = used
    flag_modified(subscription, "used")
    db.add(SubscriptionUsageEvent(
        user_id=user.id,
        subscription_id=subscription.id,
        resource=resource,
        quantity=1,
        event_type="debit",
        idempotency_key=idempotency_key,
        reference_type=reference_type,
        reference_id=reference_id,
        event_metadata=metadata,
    ))
    await db.flush()
    return True


def subscription_snapshot(subscription: CustomSubscription) -> dict:
    current = normalize_config(subscription.current_config)
    next_config = normalize_config(subscription.next_config or current)
    used = {**empty_usage(), **(subscription.used or {})}
    return {
        "status": subscription.status,
        "auto_renew": subscription.auto_renew,
        "payment_method_saved": bool(subscription.payment_method_id),
        "current_period_start": subscription.current_period_start,
        "current_period_end": subscription.current_period_end,
        "current_config": current,
        "next_config": next_config,
        "used": used,
        "remaining": {key: max(0, current[key] - used[key]) for key in RESOURCES},
        "current_price": calculate_price(current),
        "next_price": calculate_price(next_config),
    }
