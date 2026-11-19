from datetime import datetime, timedelta
from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from db_async import AsyncSessionLocal
from accelerator_attendance_insights import attendance_insights, attendance_band
from accelerator_tracking_facts import load_tracking_facts
from models import AcceleratorAttendanceRecord, AcceleratorEvent, AcceleratorParticipantProfile, AcceleratorTeam
from routers.accelerators import tracking_risk_from_facts, membership_tracking_risk, cohort_attendance_insights
from tests.test_accelerator_team_attendance import group


@pytest.mark.parametrize("present,total,expected", [(0,0,"no_data"),(0,10,"zero"),(49,100,"below50"),(496,1000,"below50"),(5,10,"normal"),(10,10,"normal")])
def test_exact_attendance_threshold(present,total,expected):
    assert attendance_band(present,total)==expected
    member=SimpleNamespace(enrolled_at=datetime.utcnow()-timedelta(days=40))
    facts={"latest_checkin":None,"overdue_homework":0,"overdue_tasks":3,"attendance_total":total,
           "present_count":present,"last_activity_at":None,"has_tracker":False}
    risk=tracking_risk_from_facts(member,facts,now=datetime.utcnow())
    assert (risk["level"]=="red")== (total>0 and present*2<total)
    assert all(reason["code"]=="low_attendance" for reason in risk["reason_items"])


def test_homework_is_an_actionable_risk_but_missing_checkins_are_not():
    now=datetime.utcnow()
    facts={"latest_checkin":SimpleNamespace(health="red",period_start=now.date()-timedelta(days=100),created_at=now),
           "overdue_homework":0,"overdue_tasks":0,"attendance_total":2,"present_count":1,
           "last_activity_at":now-timedelta(days=40),"has_tracker":False}
    member=SimpleNamespace(enrolled_at=now-timedelta(days=40))
    assert tracking_risk_from_facts(member,facts,now=now)["level"]=="green"
    facts["overdue_homework"]=1
    assert tracking_risk_from_facts(member,facts,now=now)["level"]=="yellow"
    facts["overdue_homework"]=2
    assert tracking_risk_from_facts(member,facts,now=now)["level"]=="red"


@pytest.mark.asyncio
async def test_team_insights_share_denominator_exclusions_groups_and_permissions():
    async with AsyncSessionLocal() as db:
        actor,cohort,user,member,event,peer,peer_member=await group(db)
        now=datetime.utcnow()
        event.starts_at=now-timedelta(hours=3);event.ends_at=now-timedelta(hours=2);event.status="completed"
        second=AcceleratorEvent(cohort_id=cohort.id,title="Second",event_format="online",status="completed",
            starts_at=now-timedelta(hours=2),ends_at=now-timedelta(hours=1),checkin_code=uuid.uuid4().hex,
            created_by_user_id=actor.id,updated_by_user_id=actor.id)
        db.add(second);await db.flush()
        cohort.attendance_policy={"planned_events":2,"event_ids":[event.id,second.id]}
        db.add_all([AcceleratorAttendanceRecord(event_id=event.id,membership_id=member.id,status="present"),
            AcceleratorParticipantProfile(membership_id=member.id,profile={"education_course":"БАК-1","education_direction":"БАК"}),
            AcceleratorParticipantProfile(membership_id=peer_member.id,profile={"education_course":"МАГ-2","education_direction":"МАГ"})])
        await db.commit()
        result=await cohort_attendance_insights(cohort.id,actor,db)
        assert result["teams"]==1 and result["distribution"]["normal"]==1
        assert result["participants"]["normal"]==2
        assert result["top_teams"][0]["percent"]==50
        assert result["percent"]==50
        assert result["events"][0]["present"]==1 and result["events"][0]["total"]==1
        assert {row["label"] for row in result["by_course"]}=={"БАК · 1 курс","МАГ · 2 курс"}
        assert all(row["percent"]==50 for row in result["by_direction"])
        assert (await membership_tracking_risk(db,member))["level"]=="green"
        with pytest.raises(HTTPException) as error:
            await cohort_attendance_insights(cohort.id,user,db)
        assert error.value.status_code==403
        team=await db.scalar(select(AcceleratorTeam).where(AcceleratorTeam.owner_membership_id==member.id))
        cohort.attendance_policy={"planned_events":2,"event_ids":[event.id,second.id],"excluded_events_by_team":{str(team.id):[second.id]}}
        await db.commit()
        adjusted=await attendance_insights(db,cohort,now=now)
        assert adjusted["top_teams"][0]["percent"]==100
        assert adjusted["events"][1]["total"]==0
        assert adjusted["events"][1]["percent"] is None


@pytest.mark.asyncio
async def test_no_events_are_not_zero_attendance_or_a_risk():
    async with AsyncSessionLocal() as db:
        actor,cohort,user,member,event,peer,peer_member=await group(db)
        event.starts_at=datetime.utcnow()+timedelta(days=1);event.ends_at=event.starts_at+timedelta(hours=1)
        cohort.attendance_policy={"planned_events":10,"event_ids":[event.id]}
        await db.commit()
        result=await attendance_insights(db,cohort)
        assert result["participants"]["no_data"]==2 and result["participants"]["zero"]==0
        assert result["top_teams"]==[] and result["percent"] is None
        assert (await membership_tracking_risk(db,member))["level"]=="green"
