from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import subscription_service


@pytest.mark.asyncio
async def test_grant_save_requires_an_available_submission(monkeypatch):
    subscription = SimpleNamespace(current_config={"grants": 0}, used={"grants": 0})

    async def fake_get_subscription(_db, _user_id):
        return subscription

    monkeypatch.setattr(subscription_service, "get_subscription", fake_get_subscription)
    monkeypatch.setattr(subscription_service, "is_active", lambda _subscription: True)

    user = SimpleNamespace(id=10, is_admin=False)
    with pytest.raises(HTTPException) as exc:
        await subscription_service.require_quota_access(object(), user, "grants")

    assert exc.value.status_code == 402
    assert "quota_exceeded" in exc.value.detail


@pytest.mark.asyncio
async def test_grant_save_does_not_consume_available_submission(monkeypatch):
    subscription = SimpleNamespace(current_config={"grants": 2}, used={"grants": 1})

    async def fake_get_subscription(_db, _user_id):
        return subscription

    monkeypatch.setattr(subscription_service, "get_subscription", fake_get_subscription)
    monkeypatch.setattr(subscription_service, "is_active", lambda _subscription: True)

    user = SimpleNamespace(id=10, is_admin=False)
    await subscription_service.require_quota_access(object(), user, "grants")

    assert subscription.used["grants"] == 1
