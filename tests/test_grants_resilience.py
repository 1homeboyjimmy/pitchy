from types import SimpleNamespace
from datetime import datetime, timedelta

import pytest

import grants_service
import makura_client
from schemas import GrantResponse


@pytest.mark.asyncio
async def test_generation_fails_when_every_model_group_fails(monkeypatch):
    async def unavailable(*_args, **_kwargs):
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(makura_client, "call_makura", unavailable)

    grant = SimpleNamespace(
        name="Старт-ИИ",
        organization="Фонд содействия инновациям",
        requirements={},
        application_template=None,
    )

    with pytest.raises(RuntimeError, match="grant_generation_empty"):
        await grants_service.generate_application({}, grant)


def test_unrestricted_grant_stays_eligible_with_incomplete_passport():
    grant = SimpleNamespace(geo="RF", stages=[], sectors=[], entity_types=[])

    score, hard_pass, reasons = grants_service.match_grant({}, grant)

    assert score == 50
    assert hard_pass is True
    assert reasons["conflict"] is False


def test_legacy_null_grant_lists_do_not_break_catalogue_serialization():
    grant = GrantResponse.model_validate({
        "id": 1,
        "name": "Legacy grant",
        "stages": None,
        "sectors": None,
        "entity_types": None,
    })

    assert grant.stages == []
    assert grant.sectors == []
    assert grant.entity_types == []


def test_status_from_dates_closes_at_deadline_and_opens_on_start():
    now = datetime(2026, 8, 9, 12, 0, 0)

    assert grants_service._status_from_dates(None, now, now=now) == "closed"
    assert grants_service._status_from_dates(now + timedelta(hours=1), None, now=now) == "upcoming"
    assert grants_service._status_from_dates(now - timedelta(hours=1), now + timedelta(days=1), now=now) == "open"


@pytest.mark.asyncio
async def test_deadline_sync_closes_expired_and_does_not_reopen_manual_closure():
    now = datetime(2026, 8, 9, 12, 0, 0)
    expired = SimpleNamespace(status="open", opens_at=None, deadline=now - timedelta(seconds=1))
    ready = SimpleNamespace(status="upcoming", opens_at=now, deadline=now + timedelta(days=1))
    manually_closed = SimpleNamespace(status="closed", opens_at=None, deadline=now + timedelta(days=1))

    class ScalarRows:
        def all(self):
            return [expired, ready, manually_closed]

    class QueryResult:
        def scalars(self):
            return ScalarRows()

    class FakeDb:
        commits = 0

        async def execute(self, _query):
            return QueryResult()

        async def commit(self):
            self.commits += 1

    db = FakeDb()
    result = await grants_service.sync_grant_deadline_statuses(db, now=now)

    assert expired.status == "closed"
    assert ready.status == "open"
    assert manually_closed.status == "closed"
    assert result == {"changed": 2, "closed": 1, "opened": 1, "upcoming": 0}
    assert db.commits == 1
