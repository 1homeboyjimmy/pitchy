"""Resident snapshot isolation, native composition and live access checks."""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select

import accelerator_dashboard_cache as cache
from db_async import AsyncSessionLocal
from models import AcceleratorProgramConfig, AcceleratorTrackingTask, AcceleratorAttendanceRecord
from routers import accelerators as routes
from routers.accelerator_operations import resident_live_config, _resident_live_context
from tests.test_accelerator_dashboard_cache import redis  # shared in-memory Redis fixture
from tests.test_accelerator_team_attendance import group


@pytest.mark.asyncio
async def test_resident_events_cache_is_private_and_invalidates_after_attendance(redis, monkeypatch):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db, shared=False)
        calls = 0
        execute = db.execute
        async def counted(*args, **kwargs):
            nonlocal calls
            calls += 1
            return await execute(*args, **kwargs)
        monkeypatch.setattr(db, 'execute', counted)
        cold = await routes.list_resident_events(member.id, user, db)
        cold_queries = calls
        calls = 0
        warm = await routes.list_resident_events(member.id, user, db)
        assert jsonable_encoder(cold) == warm
        assert calls < cold_queries
        with pytest.raises(HTTPException) as error:
            await routes.list_resident_events(member.id, peer, db)
        assert error.value.status_code == 404
        unrelated = await cache.revision(redis, cohort.id + 10000)
        db.add(AcceleratorAttendanceRecord(event_id=event.id, membership_id=member.id, status='present'))
        await db.commit()
        assert await cache.revision(redis, cohort.id + 10000) == unrelated
        updated = await routes.list_resident_events(member.id, user, db)
        assert updated[0]['attendance']['status'] == 'present'
        other = await routes.list_resident_events(peer_member.id, peer, db)
        assert other[0]['attendance'] is None
        member.status = 'suspended'
        await db.commit()
        with pytest.raises(HTTPException):
            await routes.list_resident_events(member.id, user, db)


@pytest.mark.asyncio
async def test_today_composes_native_dates_even_when_tracking_cache_is_warm(redis):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        config = await db.scalar(select(AcceleratorProgramConfig).where(AcceleratorProgramConfig.cohort_id == cohort.id))
        config.modules = {'attendance': True, 'progress_tracking': True}
        db.add(AcceleratorTrackingTask(membership_id=member.id, created_by_user_id=actor.id,
                                      title='Private task', due_at=datetime.utcnow()+timedelta(days=1)))
        await db.commit()
        await routes.membership_tracking(member.id, user, db)
        await routes.membership_tracking(member.id, user, db)  # JSON hit contains ISO dates
        before = await cache.revision(redis, cohort.id)
        today = await routes.membership_today(member.id, user, db)
        assert today['required_actions'][0]['title'] == 'Private task'
        assert today['unavailable_sections'] == []
        # Persisting derived recommendations must not trigger a cohort-wide reload.
        assert await cache.revision(redis, cohort.id) == before
        warm = await routes.membership_today(member.id, user, db)
        assert jsonable_encoder(today) == warm
        other = await routes.membership_today(peer_member.id, peer, db)
        assert not any(row['title'] == 'Private task' for row in other['required_actions'])


@pytest.mark.asyncio
async def test_workspace_tracks_each_owned_cohort_revision_and_user_scope(redis):
    calls = []
    async def factory():
        calls.append(1)
        return {'count': len(calls)}
    assert await cache.cached_workspace([8,9], 'resident:workspace:user:1', factory) == {'count':1}
    assert await cache.cached_workspace([8,9], 'resident:workspace:user:1', factory) == {'count':1}
    await cache.invalidate(({9}, False))
    assert await cache.cached_workspace([8,9], 'resident:workspace:user:1', factory) == {'count':2}
    assert await cache.cached_workspace([8,9], 'resident:workspace:user:2', factory) == {'count':3}
    assert await cache.cached_workspace([8], 'resident:workspace:user:1', factory) == {'count':4}


@pytest.mark.asyncio
async def test_partial_today_snapshot_is_not_cached(redis):
    calls = []
    async def calculate():
        calls.append(1)
        return {'unavailable_sections': ['events'] if len(calls) == 1 else []}
    predicate = lambda result: not result['unavailable_sections']
    assert (await cache.cached_snapshot(8, 'partial', calculate, cache_if=predicate))['unavailable_sections']
    assert not (await cache.cached_snapshot(8, 'partial', calculate, cache_if=predicate))['unavailable_sections']
    await cache.cached_snapshot(8, 'partial', calculate, cache_if=predicate)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_resident_live_access_requires_owned_active_membership(redis):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        assert (await resident_live_config(member.id, user, db))['enabled'] is True
        for viewer in (actor, peer):
            with pytest.raises(HTTPException) as error:
                await resident_live_config(member.id, viewer, db)
            assert error.value.status_code == 404
        member.status = 'suspended'
        await db.commit()
        with pytest.raises(HTTPException):
            await _resident_live_context(db, member.id, user)


@pytest.mark.asyncio
async def test_initial_workspace_is_owned_and_refreshes_profile_changes(redis):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        first = await routes.list_my_accelerator_memberships(user, db)
        assert [row['membership_id'] for row in first['memberships']] == [member.id]
        warm = await routes.list_my_accelerator_memberships(user, db)
        assert jsonable_encoder(first) == warm
        other = await routes.list_my_accelerator_memberships(peer, db)
        assert [row['membership_id'] for row in other['memberships']] == [peer_member.id]
        member.status = 'withdrawn'
        await db.commit()
        assert not (await routes.list_my_accelerator_memberships(user, db))['memberships']
