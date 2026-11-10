"""Regression coverage for QR capabilities, lifecycle, concurrency and teacher overrides."""
import asyncio
from datetime import datetime, timedelta
import secrets
import time
import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from db_async import AsyncSessionLocal
from models import AcceleratorAttendanceRecord, AcceleratorAuditLog, AcceleratorCohort, AcceleratorEvent, AcceleratorMembership, AcceleratorProgramConfig, AcceleratorProgramStage, AcceleratorProgramStageProgress, User
from routers import accelerators as routes
from schemas.accelerators import AttendanceMark, EventCreate, ProgramStageCreate
from tests.test_accelerator_resident_import import seed
from accelerator_attendance_service import checkin_session, validate_checkin_token, utc_datetime


async def context(db, *, event_status='published', member_status='enrolled', cohort_status='active', start=None, end=None):
    actor, cohort = await seed(db)
    cohort.status = cohort_status
    config = (await db.execute(select(AcceleratorProgramConfig).where(AcceleratorProgramConfig.cohort_id == cohort.id))).scalar_one()
    config.modules = {'attendance': True}
    user = User(name='QR audit student', email=f'{uuid.uuid4().hex}@example.com', is_active=True)
    db.add(user); await db.flush()
    member = AcceleratorMembership(cohort_id=cohort.id, user_id=user.id, role='resident', status=member_status, accepted_by_user_id=actor.id, enrolled_at=datetime.utcnow())
    db.add(member)
    now = datetime.utcnow()
    event = AcceleratorEvent(cohort_id=cohort.id, title='QR audit', starts_at=start or now-timedelta(minutes=10), ends_at=end or now+timedelta(minutes=20), status=event_status, checkin_code=secrets.token_urlsafe(24), checkin_opens_minutes=0, checkin_closes_minutes=0, created_by_user_id=actor.id, updated_by_user_id=actor.id)
    db.add(event); await db.commit()
    return actor, cohort, user, member, event


@pytest.mark.asyncio
async def test_qr_happy_path_and_repeat_are_idempotent():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event = await context(db)
        first = await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        second = await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        assert first['checked_in'] and second['checked_in']
        assert first['event']['attendance']['checked_in_at'] == second['event']['attendance']['checked_in_at']
        assert (await db.execute(select(func.count()).select_from(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event.id))).scalar_one() == 1
        assert (await db.execute(select(func.count()).select_from(AcceleratorAuditLog).where(AcceleratorAuditLog.cohort_id == cohort.id, AcceleratorAuditLog.action == 'attendance.checked_in'))).scalar_one() == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['draft', 'cancelled', 'archived'])
async def test_unavailable_event_rejects_qr(status):
    async with AsyncSessionLocal() as db:
        _, _, user, _, event = await context(db, event_status=status)
        with pytest.raises(HTTPException) as error: await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        assert error.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['accepted', 'suspended', 'completed', 'withdrawn'])
async def test_non_enrolled_member_rejects_qr(status):
    async with AsyncSessionLocal() as db:
        _, _, user, _, event = await context(db, member_status=status)
        with pytest.raises(HTTPException) as error: await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        assert error.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize('when', ['before', 'after'])
async def test_checkin_window_rejects_early_and_late(when):
    now = datetime.utcnow()
    start, end = (now+timedelta(minutes=30), now+timedelta(minutes=60)) if when=='before' else (now-timedelta(minutes=60), now-timedelta(minutes=30))
    async with AsyncSessionLocal() as db:
        _, _, user, _, event = await context(db, start=start, end=end)
        with pytest.raises(HTTPException) as error: await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_outsider_unknown_code_and_disabled_module_rejected():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, _, event = await context(db)
        for code, as_user, expected in [('invalid-code', user, 404), (checkin_session(event)["token"], actor, 403)]:
            with pytest.raises(HTTPException) as error: await routes.check_in_to_event(code, as_user, db)
            assert error.value.status_code == expected
        config = (await db.execute(select(AcceleratorProgramConfig).where(AcceleratorProgramConfig.cohort_id==cohort.id))).scalar_one()
        config.modules={'attendance': False}; await db.commit()
        with pytest.raises(HTTPException) as error: await routes.check_in_to_event(checkin_session(event)["token"], user, db)
        assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_only_manager_can_get_qr_or_change_attendance():
    async with AsyncSessionLocal() as db:
        actor, _, user, member, event = await context(db)
        with pytest.raises(HTTPException) as error: await routes.event_checkin_qr(event.id, user, db)
        assert error.value.status_code == 403
        with pytest.raises(HTTPException) as error: await routes.mark_event_attendance(event.id, AttendanceMark(membership_id=member.id,status='present'), user, db)
        assert error.value.status_code == 403
        qr=await routes.event_checkin_qr(event.id, actor, db)
        assert qr.media_type=='image/svg+xml' and qr.headers['cache-control']=='no-store' and b'<svg' in qr.body


@pytest.mark.asyncio
async def test_resident_event_list_does_not_disclose_checkin_secret():
    async with AsyncSessionLocal() as db:
        _, _, user, member, event = await context(db)
        rows=await routes.list_resident_events(member.id,user,db)
        assert not rows[0].get('checkin_url')


@pytest.mark.asyncio
@pytest.mark.parametrize('status',['archived','completed'])
async def test_frozen_cohort_disallows_qr_mutation(status):
    async with AsyncSessionLocal() as db:
        _, _, user, _, event = await context(db, cohort_status=status)
        status_code = None
        try: await routes.check_in_to_event(checkin_session(event)["token"],user,db)
        except HTTPException as error: status_code = error.status_code
        assert status_code == 409


@pytest.mark.asyncio
async def test_qr_does_not_erase_manual_teacher_decision():
    async with AsyncSessionLocal() as db:
        actor, _, user, member, event = await context(db)
        await routes.mark_event_attendance(event.id,AttendanceMark(membership_id=member.id,status='absent',comment='Teacher verified absence'),actor,db)
        with pytest.raises(HTTPException) as error:
            await routes.check_in_to_event(checkin_session(event)["token"],user,db)
        assert error.value.status_code == 409
        record=(await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id==event.id))).scalar_one()
        assert record.status=='absent' and record.comment=='Teacher verified absence' and record.marked_by_user_id==actor.id


@pytest.mark.asyncio
async def test_concurrent_scans_both_succeed_with_one_record():
    async with AsyncSessionLocal() as db:
        if db.get_bind().dialect.name!='postgresql': pytest.skip('Real PostgreSQL isolation required')
        _, _, user, _, event = await context(db)
        uid, code, eid=user.id,checkin_session(event)["token"],event.id
    barrier=asyncio.Barrier(4)
    async def scan():
        async with AsyncSessionLocal() as db:
            user=await db.get(User,uid)
            await asyncio.wait_for(barrier.wait(),timeout=10)
            return await routes.check_in_to_event(code,user,db)
    results=await asyncio.gather(*(scan() for _ in range(4)),return_exceptions=True)
    for result in results:
        if isinstance(result, BaseException):
            raise result
    assert all(isinstance(r,dict) and r['checked_in'] for r in results),[type(r).__name__ for r in results]
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id==eid))).scalar_one()==1


def test_event_timezone_and_invalid_dates():
    row=EventCreate(title='Offline',event_format='offline',location='Test room', starts_at='2026-11-10T16:00:00+03:00',ends_at='2026-11-10T17:00:00+03:00')
    assert row.starts_at==datetime(2026,11,10,13)
    from pydantic import ValidationError
    with pytest.raises(ValidationError):EventCreate(title='Bad',starts_at='2026-11-10T16:00:00+03:00',ends_at='2026-11-10T15:00:00+03:00',meeting_url='https://example.com')


@pytest.mark.asyncio
async def test_signed_session_expiry_forgery_and_legacy_codes():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event = await context(db)
        session = checkin_session(event)
        expired = checkin_session(event, now=int(time.time())-601)["token"]
        forged = session["token"][:-1] + ("A" if session["token"][-1] != "A" else "B")
        for token, expected in [(event.checkin_code,404),(expired,409),(forged,404),("q1.9999999999999999999.999999999999."+"A"*43,404)]:
            with pytest.raises(HTTPException) as error:
                await routes.check_in_to_event(token,user,db)
            assert error.value.status_code == expected
        assert (await db.execute(select(func.count()).select_from(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id==event.id))).scalar_one()==0
        with pytest.raises(HTTPException) as error: await routes.event_checkin_session(event.id,user,db)
        assert error.value.status_code==403
        import json
        response=await routes.event_checkin_session(event.id,actor,db)
        data=json.loads(response.body)
        assert response.headers["cache-control"]=="no-store"
        assert "q1." in data["checkin_url"] and event.checkin_code not in data["checkin_url"]
        assert data["expires_at"].endswith("+00:00") and "<svg" in data["qr_svg"]
        event.checkin_code=secrets.token_urlsafe(24);await db.commit()
        with pytest.raises(HTTPException) as error:await routes.check_in_to_event(session["token"],user,db)
        assert error.value.status_code==404


@pytest.mark.asyncio
async def test_manual_present_is_idempotent_and_metadata_is_retained():
    async with AsyncSessionLocal() as db:
        actor, _, user, member, event=await context(db)
        await routes.mark_event_attendance(event.id,AttendanceMark(membership_id=member.id,status="present",comment="Teacher confirmation"),actor,db)
        before=(await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id==event.id))).scalar_one()
        timestamp=before.checked_in_at
        response=await routes.check_in_to_event(checkin_session(event)["token"],user,db)
        assert response["checked_in"]
        assert before.checkin_method=="manual" and before.marked_by_user_id==actor.id
        assert before.comment=="Teacher confirmation" and before.checked_in_at==timestamp
        assert response["event"]["starts_at"].utcoffset()==timedelta(0)
        assert "checkin_url" not in response["event"]


@pytest.mark.asyncio
async def test_qr_reconciles_stage_once_and_manual_absence_revokes_it():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event=await context(db)
        policy=ProgramStageCreate(title="Attendance",completion_policy={"attendance":"all_required"}).completion_policy
        stage=AcceleratorProgramStage(cohort_id=cohort.id,title="Attendance",position=1,status="published",completion_policy=policy,created_by_user_id=actor.id,updated_by_user_id=actor.id)
        db.add(stage);await db.flush();event.stage_id=stage.id;await db.commit()
        for _ in range(2):await routes.check_in_to_event(checkin_session(event)["token"],user,db)
        assert (await db.execute(select(func.count()).select_from(AcceleratorProgramStageProgress).where(AcceleratorProgramStageProgress.stage_id==stage.id))).scalar_one()==1
        await routes.mark_event_attendance(event.id,AttendanceMark(membership_id=member.id,status="absent"),actor,db)
        assert (await db.execute(select(func.count()).select_from(AcceleratorProgramStageProgress).where(AcceleratorProgramStageProgress.stage_id==stage.id))).scalar_one()==0
        with pytest.raises(HTTPException):await routes.check_in_to_event(checkin_session(event)["token"],user,db)
