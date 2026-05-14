"""Subscription tier definitions and quota lookups.

Single source of truth for what each tier can do. Mirror this in
frontend/lib/planLimits.ts when changing — both files are kept in sync
by hand because the frontend ships a static config and runtime check
both sides defensively.

Spec (per user requirement, 2026-05):
- free:    3 messages in main chat. NO extras. Locks on every other
           feature with an upgrade prompt.
- starter: 100 messages in main chat. ALL chat extras (deep_search,
           research, presentation, import) allowed. Tree/Roadmap
           allowed. CustDev: 2 runs per month (counter is filled from
           the external CustDev server which writes Analysis rows
           into this database — already synced).
- pro:     500 messages in main chat. All extras. Tree allowed.
           CustDev: unlimited.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone

UNLIMITED = -1


@dataclass(frozen=True)
class PlanLimits:
    # Per-month main chat user-messages
    messages: int
    # Per-month CustDev runs (Analysis rows)
    custdev: int
    # Per-month tree/roadmap creations
    roadmaps: int
    # Per-month "deep research" mode messages
    deep_research: int

    # Feature gates — True if the tier may use the feature.
    can_use_deep_search: bool = False
    can_use_research: bool = False
    can_use_presentation: bool = False
    can_use_import_context: bool = False
    can_use_tree: bool = False
    can_use_custdev: bool = False


PLAN_LIMITS: dict[str, PlanLimits] = {
    "free": PlanLimits(
        messages=3,
        custdev=0,
        roadmaps=0,
        deep_research=0,
        # All advanced chat extras and other features are blocked on free.
    ),
    "starter": PlanLimits(
        messages=100,
        custdev=2,
        roadmaps=5,
        deep_research=20,
        can_use_deep_search=True,
        can_use_research=True,
        can_use_presentation=True,
        can_use_import_context=True,
        can_use_tree=True,
        can_use_custdev=True,
    ),
    "pro": PlanLimits(
        messages=500,
        custdev=UNLIMITED,
        roadmaps=UNLIMITED,
        deep_research=UNLIMITED,
        can_use_deep_search=True,
        can_use_research=True,
        can_use_presentation=True,
        can_use_import_context=True,
        can_use_tree=True,
        can_use_custdev=True,
    ),
    # Legacy aliases — kept so old DB rows don't break authorization.
    "premium": PlanLimits(
        messages=UNLIMITED,
        custdev=UNLIMITED,
        roadmaps=UNLIMITED,
        deep_research=UNLIMITED,
        can_use_deep_search=True,
        can_use_research=True,
        can_use_presentation=True,
        can_use_import_context=True,
        can_use_tree=True,
        can_use_custdev=True,
    ),
    "tester": PlanLimits(
        messages=25,
        custdev=0,
        roadmaps=0,
        deep_research=0,
    ),
}


def resolve_tier(subscription_tier: str | None, subscription_expires_at: datetime | None) -> str:
    """Return effective tier — falls back to `free` if subscription is expired
    or the stored tier name is unknown."""
    tier = (subscription_tier or "free").lower()
    if tier not in PLAN_LIMITS:
        return "free"
    if tier == "free":
        return "free"
    if subscription_expires_at is None:
        return tier
    # Compare in UTC; DB stores naive UTC.
    now = datetime.utcnow()
    if subscription_expires_at.tzinfo is not None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
    if subscription_expires_at < now:
        return "free"
    return tier


def get_limits_for(subscription_tier: str | None, subscription_expires_at: datetime | None) -> PlanLimits:
    return PLAN_LIMITS[resolve_tier(subscription_tier, subscription_expires_at)]


def limits_as_dict(limits: PlanLimits) -> dict:
    """For JSON serialization to the frontend."""
    return asdict(limits)


def start_of_month_utc() -> datetime:
    """First moment of the current calendar month, naive UTC.
    Used for monthly-window counters across the codebase."""
    now = datetime.utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
