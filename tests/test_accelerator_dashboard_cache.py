import asyncio
from contextlib import asynccontextmanager
import json
import time

import pytest
from fastapi import HTTPException
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import update

import accelerator_dashboard_cache as cache
import accelerator_dashboard_stream as stream
from db_async import AsyncSessionLocal
from models import AcceleratorEvent
from routers.accelerators import cohort_attendance_insights
from tests.test_accelerator_team_attendance import group


class MemoryRedis:
    def __init__(self):
        self.values = {}
        self.expires = {}
        self.subscribers = []
        self.now = 0

    async def get(self, key):
        if key in self.expires and self.expires[key] <= self.now:
            self.values.pop(key, None)
        return self.values.get(key)

    async def mget(self, *keys):
        return [await self.get(key) for key in keys]

    async def set(self, key, value, nx=False, ex=None):
        if nx and await self.get(key) is not None:
            return False
        self.values[key] = value
        if ex:
            self.expires[key] = self.now + ex
        return True

    async def exists(self, key):
        return await self.get(key) is not None

    async def eval(self, script, count, key, token):
        if await self.get(key) == token:
            self.values.pop(key, None)
            return 1
        return 0

    def pipeline(self, **kwargs):
        client = self
        class Pipeline:
            def __init__(self): self.ops = []
            def incr(self, key): self.ops.append(('incr', key))
            def publish(self, channel, value): self.ops.append(('publish', channel, value))
            async def execute(self):
                for op in self.ops:
                    if op[0] == 'incr': client.values[op[1]] = int(client.values.get(op[1], 0)) + 1
                    else:
                        for sub in client.subscribers:
                            if op[1] in sub.channels:
                                await sub.queue.put({'type':'message','data':op[2]})
        return Pipeline()

    def pubsub(self):
        client = self
        class Subscription:
            def __init__(self): self.channels = []; self.queue = asyncio.Queue()
            async def __aenter__(self): client.subscribers.append(self); return self
            async def __aexit__(self, *args): client.subscribers.remove(self)
            async def subscribe(self, *channels): self.channels = channels
            async def get_message(self, **kwargs):
                try: return await asyncio.wait_for(self.queue.get(), timeout=0.01)
                except asyncio.TimeoutError: return None
        return Subscription()


@pytest.fixture
def redis(monkeypatch):
    client = MemoryRedis()
    @asynccontextmanager
    async def connection(**kwargs): yield client
    monkeypatch.setenv('REDIS_URL', 'redis://test.invalid/0')
    monkeypatch.setenv('DASHBOARD_LIVE_COHORTS', '*')
    monkeypatch.setattr(cache, 'connection', connection)
    monkeypatch.setattr(stream, 'connection', connection)
    return client


@pytest.mark.asyncio
async def test_cache_hits_expiry_scoping_and_feature_flag(redis, monkeypatch):
    calls = 0
    async def calculate():
        nonlocal calls
        calls += 1
        return {'count':calls}
    assert await cache.cached_json(8, 'attendance', calculate) == {'count':1}
    assert await cache.cached_json(8, 'attendance', calculate) == {'count':1}
    assert await cache.cached_json(9, 'attendance', calculate) == {'count':2}
    assert await cache.cached_json(8, 'summary', calculate) == {'count':3}
    redis.now += cache.TTL + 1
    assert await cache.cached_json(8, 'attendance', calculate) == {'count':4}
    monkeypatch.setenv('DASHBOARD_CACHE_ENABLED', 'false')
    assert await cache.cached_json(8, 'attendance', calculate) == {'count':5}


@pytest.mark.asyncio
async def test_single_flight_and_invalidation_during_calculation(redis):
    calls = 0
    async def slow():
        nonlocal calls
        calls += 1
        await asyncio.sleep(.08)
        return {'count':calls}
    results = await asyncio.gather(*(cache.cached_json(8, 'summary', slow) for _ in range(10)))
    assert calls == 1 and results == [{'count':1}] * 10
    entered, release = asyncio.Event(), asyncio.Event()
    async def stale():
        entered.set(); await release.wait(); return {'stale':True}
    task = asyncio.create_task(cache.cached_json(8, 'attendance', stale))
    await entered.wait()
    await cache.invalidate(({8}, False))
    release.set(); await task
    async def fresh(): return {'fresh':True}
    assert await cache.cached_json(8, 'attendance', fresh) == {'fresh':True}


@pytest.mark.asyncio
async def test_redis_failure_does_not_block_database_or_hide_calculation_error(redis, monkeypatch):
    @asynccontextmanager
    async def broken(**kwargs): raise RedisConnectionError('unavailable'); yield
    monkeypatch.setattr(cache, 'connection', broken)
    calls = []
    async def calculate(): calls.append(1); return {'ok':True}
    assert await cache.cached_json(8, 'summary', calculate) == {'ok':True}
    assert calls == [1]
    await cache.invalidate(({8}, False))  # A committed write remains successful.
    async def invalid(): raise ValueError('invalid database calculation')
    with pytest.raises(ValueError): await cache.cached_json(8, 'summary', invalid)


@pytest.mark.asyncio
async def test_commit_rollback_nested_import_and_bulk_invalidate(redis):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        cohort_id = cohort.id
        before = await cache.revision(redis, cohort_id)
        event.title = 'Saved update'
        await db.commit()
        saved = await cache.revision(redis, cohort_id)
        assert saved != before
        event_id = event.id
        event.title = 'Rolled back update'
        await db.flush(); await db.rollback()
        assert await cache.revision(redis, cohort_id) == saved
        async with db.begin():
            row = await db.get(AcceleratorEvent, event_id)
            row.title = 'Import batch'
            async with db.begin_nested():
                row.title = 'Nested import batch'
        assert await cache.revision(redis, cohort_id) != saved
        before_bulk = await cache.revision(redis, cohort_id)
        await db.execute(update(AcceleratorEvent).where(AcceleratorEvent.cohort_id == cohort_id).values(title='Bulk update'))
        await db.commit()
        assert await cache.revision(redis, cohort_id) != before_bulk


@pytest.mark.asyncio
async def test_warm_cache_never_bypasses_cohort_permissions(redis):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        await cohort_attendance_insights(cohort.id, actor, db)
        with pytest.raises(HTTPException) as error:
            await cohort_attendance_insights(cohort.id, user, db)
        assert error.value.status_code == 403


class Request:
    disconnected = False
    async def is_disconnected(self): return self.disconnected


@pytest.mark.asyncio
async def test_sse_publishes_only_after_commit_and_cleans_up(redis):
    request = Request()
    async def allowed(): return True
    generator = stream.dashboard_events(request, 8, allowed)
    first = await anext(generator)
    assert 'event: ready' in first
    await cache.invalidate(({8}, False))
    changed = await anext(generator)
    assert 'event: changed' in changed and 'participants' not in changed
    request.disconnected = True
    with pytest.raises(StopAsyncIteration): await anext(generator)
    assert redis.subscribers == []


@pytest.mark.asyncio
async def test_sse_revocation_and_redis_outage(redis, monkeypatch):
    monkeypatch.setattr(stream, 'AUTH_INTERVAL', 0)
    async def forbidden(): return False
    generator = stream.dashboard_events(Request(), 8, forbidden)
    await anext(generator)
    assert 'event: forbidden' in await anext(generator)
    await generator.aclose()
    assert not redis.subscribers
    @asynccontextmanager
    async def broken(**kwargs): raise RedisConnectionError('unavailable'); yield
    monkeypatch.setattr(stream, 'connection', broken)
    generator = stream.dashboard_events(Request(), 8, forbidden)
    assert 'event: fallback' in await anext(generator)
    await generator.aclose()
