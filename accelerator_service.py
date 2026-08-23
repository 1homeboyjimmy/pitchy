"""Core rules for accelerator access, enrollment and resident quotas."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func as sa_func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AcceleratorAuditLog,
    AcceleratorCohort,
    AcceleratorMembership,
    AcceleratorQuotaUsageEvent,
    AcceleratorResidentQuotaOverride,
    AcceleratorStaff,
)

ACCELERATOR_RESOURCES = ("messages", "roadmaps", "custdev", "grants")
UNLIMITED = -1


def normalize_resident_limits(raw: dict[str, Any]) -> dict[str, int]:
    if set(raw) != set(ACCELERATOR_RESOURCES):
        raise ValueError(f"ожидаются лимиты: {', '.join(ACCELERATOR_RESOURCES)}")
    result: dict[str, int] = {}
    for resource in ACCELERATOR_RESOURCES:
        value = raw[resource]
        if isinstance(value, bool):
            raise ValueError(f"{resource}: ожидается целое число")
        try:
            value = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{resource}: ожидается целое число") from exc
        if value < UNLIMITED:
            raise ValueError(f"{resource}: минимум -1 (безлимит)")
        result[resource] = value
    return result


def entitlement_is_greater(candidate: int, current: int) -> bool:
    if current == UNLIMITED:
        return False
    return candidate == UNLIMITED or candidate > current


async def is_accelerator_organizer(db: AsyncSession, user_id: int, accelerator_id: int) -> bool:
    return (await db.execute(
        select(AcceleratorStaff.id).where(
            AcceleratorStaff.accelerator_id == accelerator_id,
            AcceleratorStaff.user_id == user_id,
            AcceleratorStaff.role == "organizer",
        )
    )).scalar_one_or_none() is not None


async def require_cohort_manager(db: AsyncSession, user, cohort: AcceleratorCohort) -> None:
    if user.is_admin:
        return
    if not await is_accelerator_organizer(db, user.id, cohort.accelerator_id):
        raise HTTPException(status_code=403, detail="Нет прав на управление этим акселератором")


def add_audit(
    db: AsyncSession,
    *,
    accelerator_id: int,
    actor_user_id: int | None,
    action: str,
    target_type: str,
    target_id: int | None = None,
    cohort_id: int | None = None,
    details: dict | None = None,
) -> None:
    db.add(AcceleratorAuditLog(
        accelerator_id=accelerator_id,
        cohort_id=cohort_id,
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
    ))


async def has_active_personal_override(
    db: AsyncSession, membership_id: int, now: datetime | None = None
) -> bool:
    now = now or datetime.utcnow()
    row = (await db.execute(
        select(AcceleratorResidentQuotaOverride.id).where(
            AcceleratorResidentQuotaOverride.membership_id == membership_id,
            AcceleratorResidentQuotaOverride.source == "individual",
            (AcceleratorResidentQuotaOverride.superseded_at.is_(None) | (AcceleratorResidentQuotaOverride.superseded_at > now)),
            AcceleratorResidentQuotaOverride.starts_at <= now,
            (AcceleratorResidentQuotaOverride.ends_at.is_(None) | (AcceleratorResidentQuotaOverride.ends_at > now)),
        )
    )).scalar_one_or_none()
    return row is not None


async def assign_quota_override(
    db: AsyncSession,
    *,
    membership: AcceleratorMembership,
    source: str,
    limits: dict[str, Any],
    created_by_user_id: int,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    reason: str | None = None,
) -> AcceleratorResidentQuotaOverride:
    if source not in ("individual", "cohort"):
        raise ValueError("source must be individual or cohort")
    if membership.role != "resident" or membership.status != "enrolled":
        raise HTTPException(status_code=409, detail="Лимиты можно назначить только зачисленному резиденту")

    now = datetime.utcnow()
    starts_at = starts_at or now
    if ends_at is not None and ends_at <= starts_at:
        raise HTTPException(status_code=422, detail="Дата окончания должна быть позже даты начала")

    active_rows = (await db.execute(
        select(AcceleratorResidentQuotaOverride).where(
            AcceleratorResidentQuotaOverride.membership_id == membership.id,
            AcceleratorResidentQuotaOverride.source == source,
            (AcceleratorResidentQuotaOverride.superseded_at.is_(None) | (AcceleratorResidentQuotaOverride.superseded_at > now)),
        ).with_for_update()
    )).scalars().all()
    for previous in active_rows:
        previous.superseded_at = starts_at

    assignment = AcceleratorResidentQuotaOverride(
        membership_id=membership.id,
        source=source,
        limits=normalize_resident_limits(limits),
        starts_at=starts_at,
        ends_at=ends_at,
        created_by_user_id=created_by_user_id,
        reason=reason,
    )
    db.add(assignment)
    await db.flush()
    return assignment


async def active_quota_override(
    db: AsyncSession,
    user_id: int,
    resource: str,
    *,
    for_update: bool = False,
    now: datetime | None = None,
) -> tuple[AcceleratorResidentQuotaOverride, AcceleratorMembership, int] | None:
    if resource not in ACCELERATOR_RESOURCES:
        return None
    now = now or datetime.utcnow()
    query = (
        select(AcceleratorResidentQuotaOverride, AcceleratorMembership)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorResidentQuotaOverride.membership_id)
        .where(
            AcceleratorMembership.user_id == user_id,
            AcceleratorMembership.role == "resident",
            AcceleratorMembership.status == "enrolled",
            (AcceleratorResidentQuotaOverride.superseded_at.is_(None) | (AcceleratorResidentQuotaOverride.superseded_at > now)),
            AcceleratorResidentQuotaOverride.starts_at <= now,
            (AcceleratorResidentQuotaOverride.ends_at.is_(None) | (AcceleratorResidentQuotaOverride.ends_at > now)),
        )
    )
    if for_update:
        query = query.with_for_update()
    rows = (await db.execute(query)).all()

    by_membership: dict[int, list] = {}
    for override, membership in rows:
        try:
            limit = normalize_resident_limits(override.limits)[resource]
        except (TypeError, ValueError):
            continue
        by_membership.setdefault(membership.id, []).append((limit, override, membership))

    # Within one membership an individual assignment replaces the cohort template,
    # even when it intentionally lowers the limit. Across simultaneous cohorts the
    # strongest active entitlement wins.
    candidates = []
    for membership_rows in by_membership.values():
        individual_rows = [item for item in membership_rows if item[1].source == "individual"]
        pool = individual_rows or membership_rows
        candidates.append(max(pool, key=lambda item: item[1].starts_at))
    if not candidates:
        return None

    def rank(item):
        limit, override, _ = item
        return (float("inf") if limit == UNLIMITED else limit, override.starts_at)

    limit, override, membership = max(candidates, key=rank)
    return override, membership, limit


async def accelerator_quota_snapshot(
    db: AsyncSession, user_id: int, resource: str
) -> dict | None:
    active = await active_quota_override(db, user_id, resource)
    if not active:
        return None
    override, membership, limit = active
    period_start = max(override.starts_at, datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0))
    used = (await db.execute(
        select(sa_func.coalesce(sa_func.sum(AcceleratorQuotaUsageEvent.quantity), 0)).where(
            AcceleratorQuotaUsageEvent.quota_override_id == override.id,
            AcceleratorQuotaUsageEvent.resource == resource,
            AcceleratorQuotaUsageEvent.created_at >= period_start,
        )
    )).scalar_one()
    return {
        "override": override,
        "membership": membership,
        "limit": limit,
        "used": int(used or 0),
        "remaining": None if limit == UNLIMITED else max(0, limit - int(used or 0)),
        "period_start": period_start,
    }


async def require_accelerator_quota_access(db: AsyncSession, user_id: int, resource: str) -> bool:
    snapshot = await accelerator_quota_snapshot(db, user_id, resource)
    if not snapshot:
        return False
    if snapshot["limit"] != UNLIMITED and snapshot["used"] >= snapshot["limit"]:
        raise HTTPException(status_code=402, detail=f"quota_exceeded: лимит резидента {resource} исчерпан ({snapshot['limit']})")
    return True


async def consume_accelerator_quota(
    db: AsyncSession,
    *,
    user_id: int,
    resource: str,
    idempotency_key: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
    metadata: dict | None = None,
) -> bool:
    existing = (await db.execute(
        select(AcceleratorQuotaUsageEvent.id).where(
            AcceleratorQuotaUsageEvent.idempotency_key == idempotency_key
        )
    )).scalar_one_or_none()
    if existing is not None:
        return True

    active = await active_quota_override(db, user_id, resource, for_update=True)
    if not active:
        return False
    override, membership, limit = active
    period_start = max(override.starts_at, datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0))
    used = (await db.execute(
        select(sa_func.coalesce(sa_func.sum(AcceleratorQuotaUsageEvent.quantity), 0)).where(
            AcceleratorQuotaUsageEvent.quota_override_id == override.id,
            AcceleratorQuotaUsageEvent.resource == resource,
            AcceleratorQuotaUsageEvent.created_at >= period_start,
        )
    )).scalar_one()
    if limit != UNLIMITED and int(used or 0) >= limit:
        raise HTTPException(status_code=402, detail=f"quota_exceeded: лимит резидента {resource} исчерпан ({limit})")

    db.add(AcceleratorQuotaUsageEvent(
        membership_id=membership.id,
        quota_override_id=override.id,
        user_id=user_id,
        resource=resource,
        quantity=1,
        idempotency_key=idempotency_key,
        reference_type=reference_type,
        reference_id=reference_id,
        event_metadata=metadata,
    ))
    await db.flush()
    return True
