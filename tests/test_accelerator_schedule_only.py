"""A timetable-only cohort retains attendance and content without learning metrics."""
import csv
from datetime import datetime, timedelta
import io

import pytest

from accelerator_operations_service import cohort_analytics
from db_async import AsyncSessionLocal
from models import AcceleratorAttendanceRecord, AcceleratorProgramMaterial, AcceleratorProgramStage
from routers import accelerators as routes
from schemas.accelerators import AttendancePolicy, CohortUpdate, ProgramConfigUpdate
from tests.test_accelerator_team_attendance import group


@pytest.mark.asyncio
async def test_schedule_mode_keeps_attendance_and_future_content_without_completion_metrics():
    async with AsyncSessionLocal() as db:
        actor, cohort, user, member, event, peer, peer_member = await group(db)
        event.starts_at = datetime.utcnow()-timedelta(hours=3)
        event.ends_at = datetime.utcnow()-timedelta(hours=2)
        event.status = "completed"
        stage = AcceleratorProgramStage(cohort_id=cohort.id, title="Scheduled webinar",
            position=0, status="published", unlock_at=datetime.utcnow()+timedelta(days=3),
            completion_policy={"mode": "manual"}, created_by_user_id=actor.id, updated_by_user_id=actor.id)
        db.add(stage)
        await db.flush()
        material = AcceleratorProgramMaterial(stage_id=stage.id, title="Join webinar",
            url="https://example.test/webinar", kind="link", position=0, required=True)
        db.add_all([material, AcceleratorAttendanceRecord(event_id=event.id,
            membership_id=member.id, status="present")])
        await db.commit()
        await routes.update_cohort(cohort.id, CohortUpdate(attendance_policy=AttendancePolicy(
            planned_events=10, event_ids=[event.id])), actor, db)
        config = await routes.get_program_config(cohort.id, actor, db)
        assert config["modules"]["program_progress"] is True
        assert not (await routes.list_resident_program_stages(member.id, user, db))[0]["materials"]
        await routes.update_program_config(cohort.id, ProgramConfigUpdate(version=config["version"],
            modules={"program_progress": False, "homework": False}), actor, db)

        for person, membership in ((user, member), (peer, peer_member)):
            today = await routes.membership_today(membership.id, person, db)
            assert today["attendance"]["percent"] == 10
            assert today["required_actions"] == []
            assert today["progress"]["current_stage"] is None
            content = await routes.list_resident_program_stages(membership.id, person, db)
            assert content[0]["materials"][0]["url"] == material.url

        report = await routes.cohort_resident_report(cohort.id, "json", actor, db)
        assert report["modules"]["program_progress"] is False
        assert all(row["program"]["enabled"] is False and row["attendance"]["percent"] == 10 for row in report["rows"])
        response = await routes.cohort_resident_report(cohort.id, "csv", actor, db)
        exported = list(csv.DictReader(io.StringIO(response.body.decode("utf-8-sig")), delimiter=";"))
        assert len(exported) == 2
        assert not any("Программа" in key or "Домашние" in key or key == "На проверке" for key in exported[0])
        assert all(row["Посещаемость, %"] == "10" and row["Посещено"] == "1" for row in exported)
        analytics = await cohort_analytics(db, cohort=cohort, user=actor)
        assert analytics["program"]["enabled"] is False and analytics["homework"]["enabled"] is False
        assert analytics["attendance"]["attendance_percent"] == 10
        card = await routes.membership_organizer_card(member.id, actor, db)
        assert card["modules"]["program_progress"] is False
        assert card["attendance"]["percent"] == 10

        await routes.update_program_config(cohort.id, ProgramConfigUpdate(version=config["version"]+1,
            modules={"program_progress": True}), actor, db)
        assert not (await routes.list_resident_program_stages(member.id, user, db))[0]["materials"]
        response = await routes.cohort_resident_report(cohort.id, "csv", actor, db)
        assert "Программа, %" in response.body.decode("utf-8-sig")
