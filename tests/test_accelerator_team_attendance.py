"""Shared team credit, teacher decisions, isolation and concurrent QR scans."""
import asyncio
from datetime import datetime
import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import select

from accelerator_attendance_service import checkin_session
from db_async import AsyncSessionLocal
from models import AcceleratorAttendanceRecord, AcceleratorTeam, AcceleratorTeamMember, AcceleratorMembership, User
from routers import accelerators as routes
from schemas.accelerators import AttendanceMark
from tests.test_qr_attendance_audit import context


async def group(db, *, shared=True):
    actor, cohort, user, member, event = await context(db)
    cohort.attendance_scope = "team" if shared else "individual"
    peer = User(name="Peer", email=f"{uuid.uuid4().hex}@example.test", is_active=True)
    db.add(peer)
    await db.flush()
    peer_member = AcceleratorMembership(cohort_id=cohort.id, user_id=peer.id, role="resident", status="enrolled", accepted_by_user_id=actor.id)
    db.add(peer_member)
    await db.flush()
    team = AcceleratorTeam(cohort_id=cohort.id, owner_membership_id=member.id, name="Team", max_members=5, status="active", created_by_user_id=actor.id)
    db.add(team)
    await db.flush()
    db.add_all([AcceleratorTeamMember(team_id=team.id, membership_id=member.id, role="owner", status="active"), AcceleratorTeamMember(team_id=team.id, membership_id=peer_member.id, role="member", status="active")])
    await db.commit()
    return actor, cohort, user, member, event, peer, peer_member


@pytest.mark.asyncio
async def test_team_qr_credits_peers_and_preserves_first_scan():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        first = await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        records = list((await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event.id))).scalars())
        assert {r.membership_id for r in records} == {member.id, peer_member.id}
        assert all(r.status == "present" for r in records)
        times = {r.membership_id: r.checked_in_at for r in records}
        await routes.check_in_to_event(checkin_session(event)["token"], peer, db)
        await db.refresh(records[0]); await db.refresh(records[1])
        assert times == {r.membership_id: r.checked_in_at for r in records}
        assert first["checked_in"] and "checkin_url" not in first["event"]
        visible = await routes.list_resident_events(peer_member.id, peer, db)
        assert visible[0]["attendance"]["status"] == "present"


@pytest.mark.asyncio
async def test_team_manual_decision_applies_to_everyone_and_blocks_qr():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        await routes.mark_event_attendance(event.id, AttendanceMark(membership_id=member.id, status="absent", comment="Teacher decision"), actor, db)
        with pytest.raises(HTTPException) as error:
            await routes.check_in_to_event(checkin_session(event)["token"], peer, db)
        assert error.value.status_code == 409
        records = list((await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event.id))).scalars())
        assert len(records) == 2 and all(r.status == "absent" and r.comment == "Teacher decision" for r in records)
        await routes.mark_event_attendance(event.id, AttendanceMark(membership_id=peer_member.id, status="present"), actor, db)
        await db.refresh(records[0]); await db.refresh(records[1])
        assert all(r.status == "present" for r in records)


@pytest.mark.asyncio
@pytest.mark.parametrize("scope,status,expected", [("individual", "enrolled", 1), ("team", "suspended", 1), ("team", "enrolled", 2)])
async def test_team_scope_and_enrollment_are_respected(scope, status, expected):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db, shared=scope == "team")
        peer_member.status = status
        await db.commit()
        await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        rows = list((await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event.id))).scalars())
        assert len(rows) == expected


@pytest.mark.asyncio
async def test_team_scans_are_serialized_on_postgres():
    from sqlalchemy.engine import make_url
    from tests.conftest import TEST_DATABASE_URL
    if make_url(TEST_DATABASE_URL).get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL row locking required")
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        event_id, token = event.id, checkin_session(event)["token"]
        user_ids = [user.id, peer.id, user.id, peer.id]
    async def scan(user_id):
        async with AsyncSessionLocal() as db:
            person = await db.get(User, user_id)
            return await routes.check_in_to_event(token, person, db)
    results = await asyncio.gather(*(scan(user_id) for user_id in user_ids))
    assert all(r["checked_in"] for r in results)
    async with AsyncSessionLocal() as db:
        rows = list((await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event_id))).scalars())
        assert len(rows) == 2 and all(r.status == "present" for r in rows)
