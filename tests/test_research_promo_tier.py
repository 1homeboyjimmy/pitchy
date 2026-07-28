from datetime import datetime, timedelta

from plan_limits import PLAN_LIMITS, get_limits_for, resolve_tier


def test_research_promo_tier_is_recognized_with_required_limits():
    expires_at = datetime.utcnow() + timedelta(days=30)

    assert resolve_tier("research", expires_at) == "research"

    limits = get_limits_for("research", expires_at)
    assert limits.messages == 20
    assert limits.search_messages == 10
    assert limits.deep_research == 3
    assert limits.roadmaps == 5
    assert limits.can_use_research is True
    assert limits.can_use_deep_search is True
    assert limits.can_use_import_context is True
    assert limits.can_use_tree is True
    assert limits.can_use_presentation is False
    assert limits.can_use_custdev is False


def test_plan_limits_json_contains_search_messages_for_every_tier():
    assert all(hasattr(limits, "search_messages") for limits in PLAN_LIMITS.values())
