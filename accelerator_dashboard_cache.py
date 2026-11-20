"""Bounded Redis snapshots and commit-driven invalidation for organizer dashboards."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
import json
import hashlib
import logging
import os
import secrets
import time

from fastapi.encoders import jsonable_encoder
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession, AsyncSessionTransaction

logger = logging.getLogger(__name__)
PREFIX = "pitchy:accelerator:dashboard:v1"
PENDING = "accelerator_dashboard_changes"
TTL = 30


def feature_enabled(name: str, cohort_id: int | None = None) -> bool:
    if os.getenv(f"DASHBOARD_{name}_ENABLED", "true").lower() in {"0", "false", "off"}:
        return False
    cohorts = os.getenv("DASHBOARD_LIVE_COHORTS", "*").split(",")
    return cohort_id is None or "*" in cohorts or str(cohort_id) in cohorts


@asynccontextmanager
async def connection(*, streaming=False):
    url = os.getenv("REDIS_URL")
    if not url:
        yield None
        return
    client = Redis.from_url(url, decode_responses=True, socket_connect_timeout=0.3,
                            socket_timeout=20 if streaming else 0.3)
    try:
        yield client
    finally:
        await client.aclose()


def channel(cohort_id):
    return f"{PREFIX}:cohort:{cohort_id}:changed"


async def revision(client, cohort_id):
    values = await client.mget(f"{PREFIX}:global:revision", f"{PREFIX}:cohort:{cohort_id}:revision")
    return ":".join(str(value or 0) for value in values)


async def cached_json(cohort_id, kind, factory, *, cache_if=None):
    if not feature_enabled("CACHE", cohort_id) or not os.getenv("REDIS_URL"):
        return await factory()
    result = None
    computed = False
    try:
        async with connection() as client:
            version = await revision(client, cohort_id)
            key = f"{PREFIX}:cohort:{cohort_id}:{kind}:{version}"
            value = await client.get(key)
            if value is not None:
                return json.loads(value)
            lock = key + ":lock"
            token = secrets.token_hex(12)
            acquired = await client.set(lock, token, nx=True, ex=5)
            if not acquired:
                # Coalesce simultaneous cold reads, without waiting indefinitely.
                deadline = time.monotonic() + 1.5
                while time.monotonic() < deadline:
                    await asyncio.sleep(0.05)
                    value = await client.get(key)
                    if value is not None:
                        return json.loads(value)
                    if not await client.exists(lock):
                        break
            try:
                result = await factory()
                computed = True
                # An older in-flight calculation must never populate the new revision.
                if (cache_if is None or cache_if(result)) and await revision(client, cohort_id) == version:
                    await client.set(key, json.dumps(jsonable_encoder(result), ensure_ascii=False), ex=TTL)
                return result
            finally:
                if acquired:
                    await client.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end return 0", 1, lock, token)
    except (RedisError, OSError, json.JSONDecodeError) as exc:
        logger.warning("Dashboard cache unavailable: %s", type(exc).__name__)
        return result if computed else await factory()


_calculating_snapshot = ContextVar("calculating_accelerator_snapshot", default=False)


async def cached_snapshot(cohort_id, kind, factory, *, cache_if=None):
    """Cache an authorized projection; nested services keep their native date types.

    A page such as Today composes several endpoint functions. Reading their JSON
    snapshots internally would turn datetimes into strings before comparisons.
    Only the outer projection uses Redis; inner calculations stay native.
    """
    if _calculating_snapshot.get():
        return await factory()

    async def calculate():
        token = _calculating_snapshot.set(True)
        try:
            return await factory()
        finally:
            _calculating_snapshot.reset(token)

    return await cached_json(cohort_id, kind, calculate, cache_if=cache_if)


async def cached_workspace(cohort_ids, kind, factory):
    """The caller loads the current owned roster before consulting this cache."""
    ids = sorted(set(cohort_ids))
    if not ids or not os.getenv("REDIS_URL") or not all(feature_enabled("CACHE", cid) for cid in ids):
        return await factory()
    try:
        async with connection() as client:
            versions = await client.mget(*(f"{PREFIX}:cohort:{cid}:revision" for cid in ids))
    except (RedisError, OSError):
        return await factory()
    digest = hashlib.sha256(json.dumps([ids, versions]).encode()).hexdigest()
    # Global revision covers account permissions; the vector covers every owned cohort.
    return await cached_snapshot(ids[0], f"{kind}:roster:{digest}", factory)


async def invalidate(changes):
    if not changes or not os.getenv("REDIS_URL"):
        return
    ids, global_change = changes
    ids = {cid for cid in ids if feature_enabled("CACHE", cid) or feature_enabled("SSE", cid)}
    if not ids and not global_change:
        return
    try:
        async with connection() as client:
            pipe = client.pipeline(transaction=True)
            if global_change:
                pipe.incr(f"{PREFIX}:global:revision")
                pipe.publish(channel("all"), "changed")
            for cid in sorted(ids):
                pipe.incr(f"{PREFIX}:cohort:{cid}:revision")
                pipe.publish(channel(cid), "changed")
            await pipe.execute()
    except Exception as exc:
        logger.warning("Dashboard invalidation unavailable: %s", type(exc).__name__)


def _collect_changes(session, flush_context, instances):
    if not os.getenv("REDIS_URL") or not (feature_enabled("CACHE") or feature_enabled("SSE")):
        return
    ids, global_change = session.info.get(PENDING, (set(), False))
    references = {"membership_id": set(), "event_id": set(), "team_id": set(),
                  "stage_id": set(), "assignment_id": set(), "project_id": set()}
    for obj in set(session.new) | set(session.dirty) | set(session.deleted):
        if obj in session.dirty and not session.is_modified(obj, include_collections=False):
            continue
        name = type(obj).__name__
        # Derived recommendations do not change any participant input or permission.
        if name == "AcceleratorTodayRecommendationCache":
            continue
        # Account/staff changes can revoke access or change names in any cohort.
        # Unresolved accelerator references use the global revision as a safe fallback.
        if name in {"User", "AcceleratorStaff"} or (name.startswith("Accelerator") and not getattr(obj, "cohort_id", None)
                and not any(getattr(obj, attr, None) for attr in references)):
            global_change = True
        if name == "AcceleratorModuleRuntimeOverride":
            global_change = True
        if name == "AcceleratorCohort":
            if obj.id:
                ids.add(obj.id)
        elif name.startswith("Accelerator"):
            if hasattr(obj, "cohort_id") and obj.cohort_id:
                ids.add(obj.cohort_id)
                ids.update(inspect(obj).attrs.cohort_id.history.deleted)
            for attr in references:
                if hasattr(obj, attr):
                    value = getattr(obj, attr)
                    if value:
                        references[attr].add(value)
                        references[attr].update(inspect(obj).attrs[attr].history.deleted)
        elif name == "Project" and obj.id:
            references["project_id"].add(obj.id)
    from models import AcceleratorMembership, AcceleratorEvent, AcceleratorTeam, AcceleratorProgramStage, AcceleratorHomeworkAssignment
    for attr, model in (("membership_id", AcceleratorMembership), ("event_id", AcceleratorEvent),
                        ("team_id", AcceleratorTeam), ("stage_id", AcceleratorProgramStage),
                        ("assignment_id", AcceleratorHomeworkAssignment)):
        if references[attr]:
            ids.update(session.execute(select(model.cohort_id).where(model.id.in_(references[attr]))).scalars())
    if references["project_id"]:
        ids.update(session.execute(select(AcceleratorMembership.cohort_id).where(
            AcceleratorMembership.project_id.in_(references["project_id"]))).scalars())
        ids.update(session.execute(select(AcceleratorTeam.cohort_id).where(
            AcceleratorTeam.project_id.in_(references["project_id"]))).scalars())
    if ids or global_change:
        session.info[PENDING] = (ids, global_change)


def _bulk_changes(state):
    if not os.getenv("REDIS_URL") or not (state.is_update or state.is_delete or state.is_insert):
        return
    table = getattr(state.statement, "table", None)
    if table is not None and (table.name.startswith("accelerator_") or table.name == "projects"):
        ids, _ = state.session.info.get(PENDING, (set(), False))
        state.session.info[PENDING] = (ids, True)


def _rollback(session, previous_transaction):
    if previous_transaction.parent is None:
        session.info.pop(PENDING, None)


def _dispatch(changes):
    if not changes:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(invalidate(changes))
    else:
        task = loop.create_task(invalidate(changes))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)


def _after_commit(session):
    if not session.in_nested_transaction() and not session.info.get("dashboard_await_commit"):
        _dispatch(session.info.pop(PENDING, None))


event.listen(Session, "before_flush", _collect_changes)
event.listen(Session, "do_orm_execute", _bulk_changes)
event.listen(Session, "after_soft_rollback", _rollback)
event.listen(Session, "after_commit", _after_commit)


class DashboardSession(Session):
    def commit(self):
        self.info["dashboard_await_commit"] = True
        try:
            super().commit()
        finally:
            self.info.pop("dashboard_await_commit", None)
        _dispatch(self.info.pop(PENDING, None))


class DashboardAsyncSession(AsyncSession):
    async def commit(self):
        self.sync_session.info["dashboard_await_commit"] = True
        try:
            await super().commit()
        finally:
            self.sync_session.info.pop("dashboard_await_commit", None)
        changes = self.sync_session.info.pop(PENDING, None)
        if changes:
            await invalidate(changes)

    def begin(self):
        return DashboardTransaction(self)

    def begin_nested(self):
        return DashboardTransaction(self, nested=True)


class DashboardTransaction(AsyncSessionTransaction):
    async def _finish(self, action):
        info = self.session.sync_session.info
        info["dashboard_await_commit"] = True
        try:
            result = await action()
        finally:
            info.pop("dashboard_await_commit", None)
        if not self.nested:
            await invalidate(info.pop(PENDING, None))
        return result

    async def commit(self):
        return await self._finish(super().commit)

    async def __aexit__(self, *args):
        return await self._finish(lambda: super(DashboardTransaction, self).__aexit__(*args))


_tasks = set()
