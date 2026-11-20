"""Participant corrections are private, reviewed once and applied atomically."""
from datetime import datetime, timedelta
import io

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from sqlalchemy import func, select

from db_async import AsyncSessionLocal
from models import AcceleratorAttendanceCorrection, AcceleratorAttendanceRecord, AcceleratorFile
from routers import accelerators as events
from routers.accelerator_attendance_corrections import (
    CorrectionCreate, CorrectionReview, create_correction, organizer_corrections,
    resident_corrections, review_correction, upload_correction_file,
)
from tests.test_accelerator_team_attendance import group


async def finished(db, shared=True):
    result = await group(db, shared=shared)
    result[4].ends_at = datetime.utcnow()-timedelta(minutes=5)
    result[4].starts_at = datetime.utcnow()-timedelta(hours=2)
    result[4].status = 'completed'
    await db.commit()
    return result


def request(was_present=True, attachments=None):
    return CorrectionCreate(full_name='Иван Иванов', was_present=was_present,
                            description='Присутствовал, но отметка не появилась', attachments=attachments or [])


@pytest.mark.asyncio
async def test_pending_duplicate_and_owner_manager_permissions():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await finished(db)
        row = await create_correction(member.id, event.id, request(), user, db)
        assert row['status'] == 'pending'
        assert await db.scalar(select(func.count()).select_from(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event.id)) == 0
        with pytest.raises(HTTPException) as error:
            await create_correction(member.id, event.id, request(), user, db)
        assert error.value.status_code == 409
        mine = await resident_corrections(member.id, user, db)
        assert mine['items'][0]['id'] == row['id']
        assert (await resident_corrections(peer_member.id, peer, db))['items'] == []
        with pytest.raises(HTTPException):
            await resident_corrections(member.id, peer, db)
        with pytest.raises(HTTPException):
            await organizer_corrections(cohort.id, 'pending', 0, 30, user, db)
        queue = await organizer_corrections(cohort.id, 'pending', 0, 30, actor, db)
        assert queue['pending'] == queue['total'] == 1
        assert queue['items'][0]['event_title'] == event.title
        summary = await events._cohort_overview_summary(db, cohort)
        assert summary['attendance_corrections_pending'] == 1
        with pytest.raises(HTTPException):
            await review_correction(row['id'], CorrectionReview(decision='approved'), user, db)


@pytest.mark.asyncio
@pytest.mark.parametrize('shared,was_present', [(True, True), (False, True), (True, False)])
async def test_approval_updates_attendance_and_prevents_repeat_decisions(shared, was_present):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await finished(db, shared)
        row = await create_correction(member.id, event.id, request(was_present), user, db)
        result = await review_correction(row['id'], CorrectionReview(decision='approved', comment='Проверено'), actor, db)
        assert result['status'] == 'approved'
        records = (await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event.id))).scalars().all()
        assert len(records) == (2 if shared else 1)
        assert all(record.status == ('present' if was_present else 'absent') for record in records)
        visible = await events.list_resident_events(member.id, user, db)
        assert visible[0]['attendance']['status'] == ('present' if was_present else 'absent')
        with pytest.raises(HTTPException) as error:
            await review_correction(row['id'], CorrectionReview(decision='rejected'), actor, db)
        assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_rejection_does_not_change_marks_and_allows_new_request():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await finished(db)
        row = await create_correction(member.id, event.id, request(), user, db)
        await review_correction(row['id'], CorrectionReview(decision='rejected', comment='Уточните ситуацию'), actor, db)
        assert await db.scalar(select(func.count()).select_from(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event.id)) == 0
        assert (await resident_corrections(member.id, user, db))['items'][0]['review_comment'] == 'Уточните ситуацию'
        second = await create_correction(member.id, event.id, request(), user, db)
        assert second['id'] != row['id']


@pytest.mark.asyncio
async def test_private_attachment_claim_and_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr(events, 'ACCELERATOR_UPLOAD_DIR', tmp_path)
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await finished(db)
        def png():
            return UploadFile(filename='screen.png', file=io.BytesIO(b'\x89PNG\r\n\x1a\n'+b'1234'*32),headers=Headers({'content-type':'image/png'}))
        file = await upload_correction_file(member.id, event.id, png(), user, db)
        with pytest.raises(HTTPException) as error:
            await create_correction(peer_member.id, event.id, request(attachments=[file['url']]), peer, db)
        assert error.value.status_code == 422
        row = await create_correction(member.id, event.id, request(attachments=[file['url']]), user, db)
        assert row['attachments'][0]['name'] == 'screen.png'
        download = await events.download_accelerator_file(file['url'].rsplit('/',1)[-1], False, actor, db)
        assert download.media_type == 'image/png'
        with pytest.raises(HTTPException):
            await events.download_accelerator_file(file['url'].rsplit('/',1)[-1], False, peer, db)
        stored = await db.scalar(select(AcceleratorFile).where(AcceleratorFile.token==file['url'].rsplit('/',1)[-1]))
        stored.created_at = datetime.utcnow()-timedelta(days=2)
        await db.commit()
        await upload_correction_file(member.id,event.id,png(),user,db)
        assert (tmp_path/stored.stored_name).is_file()


@pytest.mark.asyncio
async def test_future_cancelled_and_foreign_events_rejected():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        with pytest.raises(HTTPException):
            await create_correction(member.id, event.id, request(), user, db)
        event.ends_at = datetime.utcnow()-timedelta(minutes=1)
        event.status = 'cancelled'
        await db.commit()
        with pytest.raises(HTTPException):
            await create_correction(member.id, event.id, request(), user, db)


@pytest.mark.asyncio
async def test_concurrent_reviews_have_one_winner_on_postgres():
    import asyncio
    from sqlalchemy.engine import make_url
    from models import User
    from tests.conftest import TEST_DATABASE_URL
    if make_url(TEST_DATABASE_URL).get_backend_name() != 'postgresql':
        pytest.skip('PostgreSQL row locking required')
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await finished(db)
        row = await create_correction(member.id, event.id, request(), user, db)
        actor_id, correction_id, event_id = actor.id, row['id'], event.id
    async def review():
        async with AsyncSessionLocal() as db:
            actor = await db.get(User, actor_id)
            try:
                await review_correction(correction_id, CorrectionReview(decision='approved'), actor, db)
                return 200
            except HTTPException as error:
                await db.rollback()
                return error.status_code
    assert sorted(await asyncio.gather(review(), review())) == [200, 409]
    async with AsyncSessionLocal() as db:
        records = (await db.execute(select(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event_id))).scalars().all()
        assert len(records) == 2 and all(row.status == 'present' for row in records)


@pytest.mark.asyncio
async def test_failed_attendance_update_rolls_back_the_entire_review(monkeypatch):
    from routers import accelerator_attendance_corrections as routes
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await finished(db)
        row = await create_correction(member.id, event.id, request(), user, db)
        correction_id, event_id = row['id'], event.id
        original = routes.record_team_attendance
        async def failing(*args, **kwargs):
            await original(*args, **kwargs)
            await db.flush()
            raise RuntimeError('Simulated reconciliation failure')
        monkeypatch.setattr(routes, 'record_team_attendance', failing)
        with pytest.raises(RuntimeError):
            await review_correction(correction_id, CorrectionReview(decision='approved'), actor, db)
        await db.rollback()
        assert (await db.get(AcceleratorAttendanceCorrection, correction_id)).status == 'pending'
        assert await db.scalar(select(func.count()).select_from(AcceleratorAttendanceRecord).where(AcceleratorAttendanceRecord.event_id == event_id)) == 0
