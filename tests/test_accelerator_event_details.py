"""Announce schedules before logistics are known, then fill them without rescheduling."""
from datetime import datetime,timedelta
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from db_async import AsyncSessionLocal
from models import AcceleratorEventChange,AcceleratorAttendanceRecord
from routers import accelerators as routes
from schemas.accelerators import EventCreate,EventDetailsUpdate
from tests.test_qr_attendance_audit import context

@pytest.mark.parametrize('event_format',['online','offline','hybrid'])
def test_announced_events_can_have_pending_logistics(event_format):
 now=datetime.utcnow()
 event=EventCreate(title='Расписание',event_format=event_format,starts_at=now,ends_at=now+timedelta(hours=1))
 assert event.meeting_url is None and event.location is None
 with pytest.raises(ValidationError):EventDetailsUpdate(meeting_url='javascript:alert(1)')
 with pytest.raises(ValidationError):EventDetailsUpdate(starts_at=now)

@pytest.mark.asyncio
async def test_published_event_details_preserve_schedule_and_permissions():
 async with AsyncSessionLocal() as db:
  actor,cohort,user,member,event=await context(db)
  snapshot=(event.starts_at,event.ends_at,event.status,event.stage_id,event.checkin_code,event.checkin_opens_minutes,event.checkin_closes_minutes)
  payload=EventDetailsUpdate(meeting_url=' https://example.com/session ',host_name='Спикер',online_platform='МТС Линк')
  with pytest.raises(HTTPException) as error:await routes.update_event_details(event.id,payload,user,db)
  assert error.value.status_code==403
  result=await routes.update_event_details(event.id,payload,actor,db)
  assert result['meeting_url']=='https://example.com/session' and result['host_name']=='Спикер'
  assert snapshot==(event.starts_at,event.ends_at,event.status,event.stage_id,event.checkin_code,event.checkin_opens_minutes,event.checkin_closes_minutes)
  changes=(await db.execute(select(AcceleratorEventChange).where(AcceleratorEventChange.event_id==event.id))).scalars().all()
  assert len(changes)==1 and changes[0].action=='details_updated'
  assert changes[0].after['meeting_url']=='https://example.com/session'
  assert changes[0].actor_user_id==actor.id
  event.status='completed';await db.commit()
  await routes.update_event_details(event.id,EventDetailsUpdate(location='Аудитория 1'),actor,db)
  assert event.meeting_url=='https://example.com/session' and event.location=='Аудитория 1'
  cohort.status='archived';await db.commit()
  with pytest.raises(HTTPException) as error:await routes.update_event_details(event.id,EventDetailsUpdate(location='Недоступно'),actor,db)
  assert error.value.status_code==409 and event.location=='Аудитория 1'
