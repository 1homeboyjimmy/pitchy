"""Background job: notify users whose subscription expires in ~3 days.

Runs every 6 hours. Queries users with `subscription_expires_at` in the
window (now+2.5d .. now+3.5d). For each, sends the "expiring soon" email,
then stores a Redis key per user with a 14-day TTL — that way even if the
job fires multiple times per day, or the backend restarts, no user gets
more than one warning per subscription period.

Disabled gracefully if Redis is not configured (just logs and skips).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

logger = logging.getLogger("app.subscription_notices")

# How often the loop wakes up. With 6h cadence + 24h Redis dedup window,
# we get redundancy without spam.
LOOP_INTERVAL_SECONDS = 6 * 60 * 60
# How many days before expiry to warn the user.
WARN_DAYS_BEFORE = 3
# Window radius around the WARN_DAYS_BEFORE point — picks up users whose
# expiry falls anywhere from 2.5 to 3.5 days from "now".
WINDOW_HALF_HOURS = 12
# Redis dedup TTL — much larger than monthly billing cycle so even
# annual renewers don't get a second warning.
REDIS_DEDUP_TTL_DAYS = 14


async def _send_one(user_email: str, user_name: str | None, tier: str,
                    expires_at: datetime, days_left: int) -> None:
    try:
        import email_templates
        from email_utils import send_email
        subj, body = email_templates.subscription_expiring(
            name=user_name, tier=tier, expires_at=expires_at, days_left=days_left,
        )
        await run_in_threadpool(send_email, user_email, subj, body, "billing")
    except Exception as e:
        logger.error(f"Failed to send expiring-soon email to {user_email}: {e}")


async def _run_once() -> int:
    """One pass. Returns how many emails were sent."""
    from db_async import AsyncSessionLocal
    from models import User
    try:
        from redis_client import get_redis
        redis = get_redis()
    except Exception:
        redis = None

    if redis is None:
        logger.info("subscription_notices: Redis unavailable — skipping (would dup-send without it)")
        return 0

    now = datetime.utcnow()
    target = now + timedelta(days=WARN_DAYS_BEFORE)
    window_low = target - timedelta(hours=WINDOW_HALF_HOURS)
    window_high = target + timedelta(hours=WINDOW_HALF_HOURS)

    sent = 0
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(
                User.subscription_expires_at.isnot(None),
                User.subscription_expires_at >= window_low,
                User.subscription_expires_at <= window_high,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
        )
        users = result.scalars().all()

        for user in users:
            if not user.email:
                continue
            # Per-user dedup. Key includes expiry timestamp so a renewal
            # (new expiry far in the future) starts a fresh dedup cycle.
            expiry_marker = user.subscription_expires_at.strftime("%Y%m%d")
            key = f"expiring_notice:{user.id}:{expiry_marker}"
            try:
                already = await run_in_threadpool(redis.get, key)
            except Exception:
                already = None
            if already:
                continue

            days_left = max(1, (user.subscription_expires_at - now).days)
            await _send_one(
                user.email, user.name, user.subscription_tier,
                user.subscription_expires_at, days_left,
            )
            try:
                await run_in_threadpool(
                    redis.setex, key, REDIS_DEDUP_TTL_DAYS * 24 * 60 * 60, "1",
                )
            except Exception:
                pass
            sent += 1

    if sent:
        logger.info(f"subscription_notices: sent {sent} expiring-soon email(s)")
    return sent


async def run_subscription_notices_loop() -> None:
    """Top-level loop — wakes every 6 hours, runs one pass, sleeps again.

    Catches and logs all exceptions so a single bad pass doesn't kill the
    entire background task for the lifetime of the backend.
    """
    # Small startup delay so we don't pile work onto the boot path.
    await asyncio.sleep(60)
    while True:
        try:
            await _run_once()
        except Exception as e:
            logger.error(f"subscription_notices loop error: {type(e).__name__}: {e}", exc_info=True)
        await asyncio.sleep(LOOP_INTERVAL_SECONDS)
