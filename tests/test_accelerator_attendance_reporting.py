"""The workbook denominator and effective team marks agree across entry points."""
import csv
from datetime import datetime, timedelta
import io
from types import SimpleNamespace
import uuid

from fastapi import HTTPException
import pytest
from pydantic import ValidationError

from accelerator_alumni_service import build_snapshot_payload
from accelerator_attendance_reporting import attendance_summaries
from accelerator_operations_service import cohort_analytics
from accelerator_tracking_facts import load_tracking_facts
from db_async import AsyncSessionLocal
from models import AcceleratorAttendanceRecord, AcceleratorEvent
from routers import accelerators as routes
from schemas.accelerators import AttendancePolicy, CohortUpdate
from tests.test_accelerator_team_attendance import group


@pytest.mark.asyncio
async def test_planned_team_attendance_matches_today_reports_tracking_csv_and_snapshot():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        now = datetime.utcnow()
        event.starts_at = now - timedelta(hours=3)
        event.ends_at = now - timedelta(hours=2)
        event.status = "completed"
        events = [event]
        for index, status in enumerate(("published", "completed", "completed", "completed", "cancelled", "published", "draft", "completed")):
            future = index == 5
            start = now + timedelta(days=1) if future else now - timedelta(days=1)
            row = AcceleratorEvent(cohort_id=cohort.id, title=f"Reporting event {index}",
                event_format="offline" if index == 1 else "online", status=status,
                starts_at=start, ends_at=start+timedelta(hours=1), checkin_code=uuid.uuid4().hex,
                created_by_user_id=actor.id, updated_by_user_id=actor.id)
            db.add(row)
            events.append(row)
        await db.flush()
        db.add(AcceleratorAttendanceRecord(event_id=event.id, membership_id=peer_member.id, status="present"))
        for index, row in enumerate(events[1:],1):
            if index == 4:
                continue  # The past blank cell remains unmarked.
            db.add(AcceleratorAttendanceRecord(event_id=row.id, membership_id=member.id,
                status="absent" if index == 3 else "present"))
        await db.commit()
        await routes.update_cohort(cohort.id, CohortUpdate(attendance_policy=AttendancePolicy(
            planned_events=10, event_ids=[row.id for row in events[:-1]],
        )), actor, db)
        expected = {"present":3,"marked":4,"total":10,"unmarked":6,"percent":30,"past_events":5,"basis":"planned"}
        summaries = await attendance_summaries(db,[member,peer_member])
        assert summaries == {member.id:expected,peer_member.id:expected}
        for person, participation in ((user,member),(peer,peer_member)):
            today = await routes.membership_today(participation.id,person,db)
            assert today["attendance"] == {"present":3,"total":10,"unmarked":6,"percent":30,"basis":"planned"}
            visible = await routes.list_resident_events(participation.id,person,db)
            assert next(row for row in visible if row["id"]==event.id)["attendance"]["status"]=="present"
            risk = await routes.membership_tracking_risk(db,participation)
            assert risk["attendance_percent"]==30
        roster = await routes.list_event_attendance(event.id,actor,db)
        assert len(roster)==2 and all(row["status"]=="present" for row in roster)
        organizer_events = await routes.list_events(cohort.id,actor,db)
        assert next(row for row in organizer_events if row["id"]==event.id)["attendance_count"]==2
        report = await routes.cohort_resident_report(cohort.id,"json",actor,db)
        assert all(row["attendance"]=={"present":3,"marked":4,"total":10,"percent":30} for row in report["rows"])
        exported = await routes.cohort_resident_report(cohort.id,"csv",actor,db)
        rows = list(csv.reader(io.StringIO(exported.body.decode("utf-8-sig")),delimiter=";"))
        assert rows[0][-1]=="Посещаемость, %" and all(row[-1]=="30" for row in rows[1:])
        facts = await load_tracking_facts(db,[member,peer_member],now=datetime.utcnow())
        assert all(row["attendance_total"]==10 and row["present_count"]==3 for row in facts.values())
        analytics = await cohort_analytics(db,cohort=cohort,user=actor)
        assert analytics["attendance"]["attendance_percent"]==30
        snapshot = await build_snapshot_payload(db,membership=member,cohort=cohort,
            decision=SimpleNamespace(outcome="completed",reason="Test completion"))
        assert snapshot["attendance"]=={"published_events":10,"present":3}
        await routes.update_cohort(cohort.id,CohortUpdate(attendance_policy=None),actor,db)
        summaries = await attendance_summaries(db,[member,peer_member])
        assert all(row["basis"]=="past" and row["total"]==6 and row["present"]==4 for row in summaries.values())


@pytest.mark.asyncio
async def test_attendance_policy_rejects_events_from_another_cohort():
    async with AsyncSessionLocal() as db:
        actor, cohort, *_ = await group(db)
        _, _, _, _, foreign, *_ = await group(db)
        with pytest.raises(HTTPException) as error:
            await routes.update_cohort(cohort.id,CohortUpdate(attendance_policy=AttendancePolicy(
                planned_events=10,event_ids=[foreign.id],
            )),actor,db)
        assert error.value.status_code==422 and cohort.attendance_policy is None


@pytest.mark.parametrize("count,ids",[(0,[]),(1,[1,2]),(10,[1,1]),(10,[-1])])
def test_invalid_planned_attendance_policy(count,ids):
    with pytest.raises(ValidationError):
        AttendancePolicy(planned_events=count,event_ids=ids)
