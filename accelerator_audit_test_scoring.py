"""Explicitly configured, short-lived synthetic score fixture for platform testing."""
from __future__ import annotations
import json
import os
from datetime import datetime, timezone


def synthetic_score_bonus(*, project_id: int | None, cohort_id: int | None, now: datetime | None = None) -> int:
    """Fail closed; never select projects by text supplied in their passport."""
    try:
        config = json.loads(os.getenv('PROJECT_AUDIT_SYNTHETIC_SCORE', '{}'))
        if not isinstance(config, dict):
            return 0
        expected_project = config.get('project_id')
        expected_cohort = config.get('cohort_id')
        bonus = config.get('bonus')
        if any(type(value) is not int or value <= 0 for value in [expected_project, expected_cohort, bonus]):
            return 0
        if bonus > 5 or project_id != expected_project or cohort_id != expected_cohort:
            return 0
        expires = datetime.fromisoformat(config['expires_at'].replace('Z', '+00:00'))
        if expires.tzinfo is None:
            return 0
        current = now or datetime.now(timezone.utc)
        seconds_left = (expires - current).total_seconds()
        return bonus if 0 < seconds_left <= 86400 else 0
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return 0
