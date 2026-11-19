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
from models import AcceleratorAttendanceRecord, AcceleratorEvent, AcceleratorMembership, AcceleratorTeamMember, User
from sqlalchemy import select
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


@pytest.mark.asyncio
@pytest.mark.parametrize("future", [False, True])
async def test_team_exclusion_changes_both_counts_and_denominator_across_reports(future):
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, excluded_event, peer, peer_member = await group(db)
        now = datetime.utcnow()
        excluded_event.starts_at = now + timedelta(days=1) if future else now - timedelta(days=1)
        excluded_event.ends_at = excluded_event.starts_at + timedelta(hours=1)
        excluded_event.status = "completed" if not future else "published"
        included = AcceleratorEvent(cohort_id=cohort.id, title="Included webinar", event_format="online",
            status="completed", starts_at=now-timedelta(hours=3), ends_at=now-timedelta(hours=2),
            checkin_code=uuid.uuid4().hex, created_by_user_id=actor.id, updated_by_user_id=actor.id)
        normal_user = User(name="Normal participant", email=f"{uuid.uuid4().hex}@example.test", is_active=True)
        db.add_all([included, normal_user]); await db.flush()
        normal = AcceleratorMembership(cohort_id=cohort.id, user_id=normal_user.id, role="resident", status="enrolled", accepted_by_user_id=actor.id)
        db.add(normal); await db.flush()
        team_id = (await db.execute(select(AcceleratorTeamMember.team_id).where(AcceleratorTeamMember.membership_id==member.id))).scalar_one()
        # An exclusion wins even if an earlier QR scan recorded presence.
        db.add_all([
            AcceleratorAttendanceRecord(event_id=excluded_event.id, membership_id=peer_member.id, status="present"),
            AcceleratorAttendanceRecord(event_id=included.id, membership_id=member.id, status="present"),
            AcceleratorAttendanceRecord(event_id=excluded_event.id, membership_id=normal.id, status="present"),
            AcceleratorAttendanceRecord(event_id=included.id, membership_id=normal.id, status="present"),
        ])
        await db.commit()
        await routes.update_cohort(cohort.id, CohortUpdate(attendance_policy=AttendancePolicy(
            planned_events=10, event_ids=[excluded_event.id,included.id], excluded_events_by_team={team_id:[excluded_event.id]},
        )), actor, db)
        expected = {"present":1,"marked":1,"total":9,"unmarked":8,"percent":11,"past_events":1,"basis":"planned"}
        summaries = await attendance_summaries(db,[member,peer_member,normal])
        assert summaries[member.id] == summaries[peer_member.id] == expected
        normal_present = 1 if future else 2
        assert summaries[normal.id]["total"]==10 and summaries[normal.id]["present"]==normal_present
        for person, participation in ((user,member),(peer,peer_member)):
            today = await routes.membership_today(participation.id,person,db)
            assert today["attendance"]["total"]==9 and today["attendance"]["percent"]==11
        report = await routes.cohort_resident_report(cohort.id,"json",actor,db)
        assert all(row["attendance"]["percent"]==11 for row in report["rows"] if row["membership_id"] in (member.id,peer_member.id))
        exported = await routes.cohort_resident_report(cohort.id,"csv",actor,db)
        rows = list(csv.DictReader(io.StringIO(exported.body.decode("utf-8-sig")),delimiter=";"))
        assert {row["Посещаемость, %"] for row in rows if row["Email"] in (user.email,peer.email)}=={"11"}
        facts = await load_tracking_facts(db,[member,peer_member],now=now)
        assert all(row["attendance_total"]==9 and row["present_count"]==1 for row in facts.values())
        snapshot = await build_snapshot_payload(db,membership=member,cohort=cohort,decision=SimpleNamespace(outcome="completed",reason="Test"))
        assert snapshot["attendance"]=={"published_events":9,"present":1}


@pytest.mark.asyncio
async def test_attendance_policy_rejects_excluded_team_from_another_cohort():
    async with AsyncSessionLocal() as db:
        actor, cohort, _, _, event, *_ = await group(db)
        _, _, _, foreign_member, *_ = await group(db)
        foreign_team = (await db.execute(select(AcceleratorTeamMember.team_id).where(AcceleratorTeamMember.membership_id==foreign_member.id))).scalar_one()
        with pytest.raises(HTTPException) as error:
            await routes.update_cohort(cohort.id,CohortUpdate(attendance_policy=AttendancePolicy(
                planned_events=10,event_ids=[event.id],excluded_events_by_team={foreign_team:[event.id]},
            )),actor,db)
        assert error.value.status_code==422 and cohort.attendance_policy is None


@pytest.mark.parametrize("team_id,excluded,planned", [(0,[1],10),(1,[1,1],10),(1,[2],10),(1,[],10),(1,[1],1)])
def test_invalid_team_attendance_exclusion(team_id,excluded,planned):
    with pytest.raises(ValidationError):
        AttendancePolicy(planned_events=planned,event_ids=[1],excluded_events_by_team={team_id:excluded})


@pytest.mark.asyncio
async def test_linked_project_team_uses_shared_attendance_and_preserves_project_access():
    from accelerator_attendance_service import checkin_session
    from accelerator_team_service import cohort_teams_payload, membership_team_payload
    from models import AcceleratorProgramConfig, AcceleratorProjectMember, AcceleratorTeam, AcceleratorTeamTrackerAssignment, Project
    from project_access import get_accessible_project
    from project_passport_access import passport_context
    from schemas.accelerators import AttendanceMark

    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        config = await db.scalar(select(AcceleratorProgramConfig).where(AcceleratorProgramConfig.cohort_id == cohort.id))
        config.modules = {**config.modules, "matchmaking": True}
        root = await db.scalar(select(AcceleratorTeam).where(AcceleratorTeam.owner_membership_id == member.id))
        project = Project(user_id=peer.id, name="Second project")
        tracker = User(name="Linked team tracker", email=f"{uuid.uuid4().hex}@example.test")
        db.add_all([project, tracker])
        await db.flush()
        linked = AcceleratorTeam(cohort_id=cohort.id, owner_membership_id=peer_member.id,
            name="Second team", project_id=project.id, attendance_team_id=root.id,
            recruiting_open=False, created_by_user_id=actor.id)
        db.add(linked)
        await db.flush()
        db.add_all([
            AcceleratorProjectMember(team_id=linked.id, project_id=project.id, membership_id=peer_member.id),
            AcceleratorTeamTrackerAssignment(team_id=linked.id, tracker_user_id=tracker.id),
        ])
        event.starts_at = datetime.utcnow() - timedelta(hours=2)
        event.ends_at = datetime.utcnow() - timedelta(hours=1)
        event.status = "completed"
        await db.commit()
        await routes.update_cohort(cohort.id, CohortUpdate(attendance_policy=AttendancePolicy(planned_events=10, event_ids=[event.id])), actor, db)
        await routes.mark_event_attendance(event.id, AttendanceMark(membership_id=member.id, status="present"), actor, db)

        teams = {team["id"]: team for team in (await cohort_teams_payload(db, cohort_id=cohort.id, user=actor))["teams"]}
        assert teams[root.id]["attendance_percent"] == teams[linked.id]["attendance_percent"] == 10
        assert [row["membership_id"] for row in teams[linked.id]["members"]] == [peer_member.id]
        report = await routes.cohort_resident_report(cohort.id, "json", tracker, db)
        assert len(report["rows"]) == 1 and report["rows"][0]["membership_id"] == peer_member.id
        assert {team["id"] for team in report["rows"][0]["teams"]} == {root.id, linked.id}
        view = await membership_team_payload(db, membership_id=peer_member.id, user=peer)
        assert view["team"]["id"] == root.id and [team["id"] for team in view["additional_teams"]] == [linked.id]
        assert (await get_accessible_project(db, project.id, peer)).id == project.id
        with pytest.raises(HTTPException) as outsider:
            await get_accessible_project(db, project.id, user)
        assert outsider.value.status_code == 404
        passport, can_edit, _ = await passport_context(db, project, peer)
        assert can_edit and passport["team"] == [f"{peer.name} — Руководитель команды"]

        # The captain now belongs directly to the linked team and leaves the main roster.
        previous = await db.scalar(select(AcceleratorTeamMember).where(
            AcceleratorTeamMember.team_id == root.id,
            AcceleratorTeamMember.membership_id == peer_member.id,
        ))
        previous.status = "left"
        await db.flush()
        db.add(AcceleratorTeamMember(team_id=linked.id, membership_id=peer_member.id, role="owner"))
        peer_member.project_id = project.id
        duplicate_mark = await db.scalar(select(AcceleratorAttendanceRecord).where(
            AcceleratorAttendanceRecord.event_id == event.id,
            AcceleratorAttendanceRecord.membership_id == peer_member.id,
        ))
        await db.delete(duplicate_mark)
        await db.commit()

        view = await membership_team_payload(db, membership_id=peer_member.id, user=peer)
        assert view["team"]["id"] == linked.id and view["additional_teams"] == []
        assert not view["transfer"]["allowed"]
        teams = {team["id"]: team for team in (await cohort_teams_payload(db, cohort_id=cohort.id, user=actor))["teams"]}
        assert teams[root.id]["attendance_percent"] == teams[linked.id]["attendance_percent"] == 10
        report = await routes.cohort_resident_report(cohort.id, "json", tracker, db)
        assert [team["id"] for team in report["rows"][0]["teams"]] == [linked.id]
        assert report["rows"][0]["attendance"]["percent"] == 10

        await routes.mark_event_attendance(event.id, AttendanceMark(membership_id=peer_member.id, status="not_marked"), actor, db)
        assert (await attendance_summaries(db, [member, peer_member]))[member.id]["present"] == 0
        event.ends_at = datetime.utcnow() + timedelta(minutes=10)
        await db.commit()
        await routes.check_in_to_event(checkin_session(event)["token"], peer, db)
        marked = (await db.scalars(select(AcceleratorAttendanceRecord).where(
            AcceleratorAttendanceRecord.event_id == event.id,
            AcceleratorAttendanceRecord.status == "present",
        ))).all()
        assert {record.membership_id for record in marked} == {member.id, peer_member.id}
