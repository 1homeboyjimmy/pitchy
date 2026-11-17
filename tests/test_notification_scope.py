"""Regression checks for recipient, cohort and role isolation."""
from types import SimpleNamespace
import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from db_async import AsyncSessionLocal
from models import (User, Accelerator, AcceleratorCohort, AcceleratorMembership,
                    AcceleratorStaff, AcceleratorTrackerAssignment, AcceleratorNotification as N)
from routers.accelerator_notifications import (list_notifications, unread_notification_count,
                                              mark_notification_read, mark_all_notifications_read)
from accelerator_notification_service import enqueue_notification


async def setup(db, *, admin=False, status='enrolled'):
    users = [User(name=name, email=f'{uuid.uuid4().hex}@example.test', is_admin=admin if name=='Viewer' else False)
             for name in ['Viewer', 'Other']]
    db.add_all(users); await db.flush()
    viewer, other = users
    accelerators = [Accelerator(name=name, created_by_user_id=viewer.id) for name in ['Аксель A', 'Аксель B']]
    db.add_all(accelerators); await db.flush()
    cohorts = [AcceleratorCohort(accelerator_id=a.id, name=str(i), status='active', created_by_user_id=viewer.id)
               for i, a in enumerate([accelerators[0], accelerators[0], accelerators[1]])]
    db.add_all(cohorts); await db.flush()
    memberships = [AcceleratorMembership(cohort_id=c.id, user_id=u.id, role='resident', status=status,
                                        accepted_by_user_id=viewer.id) for c in cohorts[:2] for u in users]
    db.add_all(memberships); await db.flush()
    async def note(user=viewer, cohort=cohorts[0], event='homework_published', audience=None, membership=None):
        row = N(user_id=user.id, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
                event_type=event, title=event, body='Тест', idempotency_key=uuid.uuid4().hex,
                membership_id=membership, event_metadata={} if audience is None else {'audience':audience})
        db.add(row); await db.flush(); return row
    personal = await note()
    staff = await note(event='homework_submitted')
    second = await note(cohort=cohorts[1])
    foreign = await note(user=other)
    another = await note(cohort=cohorts[2])
    await db.commit()
    return SimpleNamespace(viewer=viewer, other=other, cohorts=cohorts, memberships=memberships,
                           personal=personal, staff=staff, second=second, foreign=foreign, another=another, note=note)


async def page(db, user, cohort=None, context='resident', cursor=None, limit=30):
    return await list_notifications(False, limit, cursor, user, db, cohort, context)


@pytest.mark.asyncio
@pytest.mark.parametrize('admin', [False, True])
@pytest.mark.parametrize('status', ['invited', 'enrolled'])
async def test_participant_only_sees_own_current_cohort_even_with_global_admin(admin, status):
    async with AsyncSessionLocal() as db:
        s = await setup(db, admin=admin, status=status)
        for cohort, expected in [(s.cohorts[0], s.personal), (s.cohorts[1], s.second)]:
            assert [n.id for n in (await page(db, s.viewer, cohort.id)).items] == [expected.id]
            assert (await unread_notification_count(s.viewer, db, cohort.id, 'resident')).count == 1
        with pytest.raises(HTTPException) as error:
            await page(db, s.viewer, s.cohorts[2].id)
        assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_staff_and_resident_streams_and_read_all_are_independent():
    async with AsyncSessionLocal() as db:
        s=await setup(db, admin=True); cid=s.cohorts[0].id
        assert [n.id for n in (await page(db,s.viewer,cid,'staff')).items] == [s.staff.id]
        assert (await mark_all_notifications_read(s.viewer,db,cid,'resident')).updated == 1
        assert (await unread_notification_count(s.viewer,db,cid,'resident')).count == 0
        assert (await unread_notification_count(s.viewer,db,cid,'staff')).count == 1
        assert (await unread_notification_count(s.viewer,db,s.cohorts[1].id,'resident')).count == 1
        assert (await unread_notification_count(s.other,db,cid,'resident')).count == 1
        with pytest.raises(HTTPException) as error:
            await mark_notification_read(s.staff.id,s.viewer,db,cid,'resident')
        assert error.value.status_code == 404
        assert (await mark_all_notifications_read(s.viewer,db,cid,'staff')).updated == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('operation',['list','count','read','read_all'])
async def test_ordinary_participant_cannot_request_staff_context(operation):
    async with AsyncSessionLocal() as db:
        s=await setup(db); cid=s.cohorts[0].id
        with pytest.raises(HTTPException) as error:
            if operation=='list': await page(db,s.viewer,cid,'staff')
            elif operation=='count': await unread_notification_count(s.viewer,db,cid,'staff')
            elif operation=='read': await mark_notification_read(s.staff.id,s.viewer,db,cid,'staff')
            else: await mark_all_notifications_read(s.viewer,db,cid,'staff')
        assert error.value.status_code == 403
        await db.refresh(s.staff); assert s.staff.read_at is None


@pytest.mark.asyncio
async def test_no_scope_returns_nothing_and_cannot_mark_anything_read():
    async with AsyncSessionLocal() as db:
        s=await setup(db,admin=True)
        assert (await page(db,s.viewer)).items == []
        assert (await unread_notification_count(s.viewer,db)).count == 0
        assert (await mark_all_notifications_read(s.viewer,db)).updated == 0
        with pytest.raises(HTTPException) as error:
            await mark_notification_read(s.personal.id,s.viewer,db)
        assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_foreign_cursor_and_read_id_cannot_cross_cohort_or_recipient():
    async with AsyncSessionLocal() as db:
        s=await setup(db,admin=True); cid=s.cohorts[0].id
        for row in [s.second,s.foreign,s.another]:
            with pytest.raises(HTTPException) as error:
                await mark_notification_read(row.id,s.viewer,db,cid,'resident')
            assert error.value.status_code == 404
        result=await page(db,s.viewer,cid,cursor=s.another.id,limit=1)
        assert [n.id for n in result.items] == [s.personal.id]


@pytest.mark.asyncio
async def test_legacy_unknown_events_and_foreign_membership_fail_closed():
    async with AsyncSessionLocal() as db:
        s=await setup(db,admin=True); cid=s.cohorts[0].id
        unknown=await s.note(event='new_staff_event')
        await s.note(audience='resident', membership=s.memberships[1].id)
        await db.commit()
        assert [n.id for n in (await page(db,s.viewer,cid)).items] == [s.personal.id]
        assert unknown.id in [n.id for n in (await page(db,s.viewer,cid,'staff')).items]


@pytest.mark.asyncio
@pytest.mark.parametrize('audience',['resident','staff'])
async def test_new_mixed_events_have_explicit_audience(audience):
    async with AsyncSessionLocal() as db:
        s=await setup(db,admin=True); c=s.cohorts[0]
        key=uuid.uuid4().hex
        await enqueue_notification(db,accelerator_id=c.accelerator_id,cohort_id=c.id,
            recipient_user_id=s.viewer.id,recipient_email=s.viewer.email,event_type='project_audit_completed',
            audience=audience,subject='Готов аудит',body='Тест',idempotency_key=key)
        await db.commit()
        row=(await db.execute(select(N).where(N.idempotency_key==key))).scalar_one()
        assert row.event_metadata['audience']==audience
        assert row.id in [n.id for n in (await page(db,s.viewer,c.id,audience)).items]
        opposite='resident' if audience=='staff' else 'staff'
        assert row.id not in [n.id for n in (await page(db,s.viewer,c.id,opposite)).items]


@pytest.mark.asyncio
@pytest.mark.parametrize('role',['organizer','tracker'])
async def test_nonadmin_staff_access_requires_current_assignment_in_that_scope(role):
    async with AsyncSessionLocal() as db:
        s=await setup(db); c=s.cohorts[0]
        assignment=(AcceleratorStaff(accelerator_id=c.accelerator_id,user_id=s.viewer.id,role='organizer',created_by_user_id=s.viewer.id)
                    if role=='organizer' else AcceleratorTrackerAssignment(membership_id=s.memberships[1].id,
                        tracker_user_id=s.viewer.id,assigned_by_user_id=s.viewer.id))
        db.add(assignment); await db.commit()
        assert [n.id for n in (await page(db,s.viewer,c.id,'staff')).items]==[s.staff.id]
        with pytest.raises(HTTPException) as error: await page(db,s.viewer,s.cohorts[2].id,'staff')
        assert error.value.status_code==403
        await db.delete(assignment); await db.commit()
        with pytest.raises(HTTPException) as error: await page(db,s.viewer,c.id,'staff')
        assert error.value.status_code==403


@pytest.mark.asyncio
async def test_http_validation_and_endpoints_keep_scope_on_the_server():
    from fastapi import FastAPI
    from httpx import AsyncClient, ASGITransport
    from auth import get_async_current_user
    from db_async import get_async_db
    from routers.accelerator_notifications import router
    async with AsyncSessionLocal() as db:
        s=await setup(db)
        app=FastAPI(); app.include_router(router)
        app.dependency_overrides[get_async_current_user]=lambda: s.viewer
        async def database(): yield db
        app.dependency_overrides[get_async_db]=database
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
            base='/api/accelerators/notifications'
            assert (await client.get(base)).json()['items']==[]
            assert (await client.get(base,params={'cohort_id':s.cohorts[0].id,'context':'other'})).status_code==422
            params={'cohort_id':s.cohorts[0].id,'context':'resident'}
            assert [row['id'] for row in (await client.get(base,params=params)).json()['items']]==[s.personal.id]
            assert (await client.get(base,params={**params,'context':'staff'})).status_code==403
            assert (await client.patch(f'{base}/{s.staff.id}/read',params=params,json={})).status_code==404
            assert (await client.post(base+'/read-all',params=params,json={})).json()['updated']==1
            assert (await client.get(base+'/unread-count',params=params)).json()['count']==0
            assert (await client.get(base+'/unread-count',params={**params,'cohort_id':s.cohorts[1].id})).json()['count']==1


@pytest.mark.asyncio
@pytest.mark.parametrize('kind',['cohort_expert','demo_expert'])
async def test_expert_service_inbox_is_scoped_to_its_assignment(kind):
    from models import AcceleratorDemoDay, AcceleratorDemoDayExpert
    async with AsyncSessionLocal() as db:
        s=await setup(db); c=s.cohorts[0]
        if kind=='cohort_expert':
            c.expert_user_id=s.viewer.id
        else:
            demo=AcceleratorDemoDay(cohort_id=c.id,title='Демо',created_by_user_id=s.viewer.id)
            db.add(demo); await db.flush()
            db.add(AcceleratorDemoDayExpert(demo_day_id=demo.id,user_id=s.viewer.id,invited_by_user_id=s.other.id))
        await db.commit()
        assert [n.id for n in (await page(db,s.viewer,c.id,'staff')).items]==[s.staff.id]
        with pytest.raises(HTTPException) as error:
            await page(db,s.viewer,s.cohorts[1].id,'staff')
        assert error.value.status_code==403
