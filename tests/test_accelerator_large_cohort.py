from datetime import datetime, timedelta
from contextlib import contextmanager
from time import perf_counter
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import event

from db_async import AsyncSessionLocal
from accelerator_service import accelerator_membership_quotas_batch, accelerator_membership_quota_snapshot
from accelerator_program_progress_service import ProgramProgressService
from accelerator_tracking_facts import load_tracking_facts
from accelerator_tracking_signals_service import TrackingSignalsService
from models import (
    User, AcceleratorApplication, AcceleratorMembership, AcceleratorProgramStage,
    AcceleratorProgramMaterial, AcceleratorProgramMaterialProgress, AcceleratorProgramStageProgress,
    AcceleratorProgramAction, AcceleratorHomeworkAssignment, AcceleratorHomeworkSubmission,
    AcceleratorHomeworkAttempt, AcceleratorHomeworkParticipant, AcceleratorHomeworkTarget,
    AcceleratorHomeworkException, AcceleratorResidentQuotaOverride, AcceleratorQuotaUsageEvent,
)
from routers.accelerators import (
    create_accelerator, create_cohort, update_program_config, tracking_dashboard,
    membership_tracking_risk, tracking_risk_from_facts, cohort_overview_summary,
)
from schemas.accelerators import AcceleratorCreate, CohortCreate, ProgramConfigUpdate


@contextmanager
def query_counter(db):
    queries = []
    engine = db.bind.sync_engine
    def record(_conn, _cursor, statement, _parameters, _context, _many):
        queries.append(statement)
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield queries
    finally:
        event.remove(engine, "before_cursor_execute", record)

async def context(db, count=100):
    suffix = uuid.uuid4().hex
    admin = User(email=f"perf-admin-{suffix}@example.test", name="Admin", is_admin=True)
    people = [User(email=f"perf-{suffix}-{i}@example.test", name=f"Resident {i}") for i in range(count)]
    tracker = User(email=f"perf-tracker-{suffix}@example.test", name="Tracker")
    db.add_all([admin, tracker, *people])
    await db.commit()
    accelerator = await create_accelerator(AcceleratorCreate(name=f"Perf {suffix}"), admin, db)
    cohort = await create_cohort(accelerator["id"], CohortCreate(name="Test cohort"), admin, db)
    await update_program_config(cohort["id"], ProgramConfigUpdate(
        version=1, modules={"homework": True, "progress_tracking": True, "attendance": True},
    ), admin, db)
    members = []
    now = datetime.utcnow()
    for person in people:
        application = AcceleratorApplication(cohort_id=cohort["id"], user_id=person.id, status="enrolled")
        db.add(application)
        await db.flush()
        member = AcceleratorMembership(cohort_id=cohort["id"], user_id=person.id,
            application_id=application.id, accepted_by_user_id=admin.id, status="enrolled",
            accepted_at=now, enrolled_at=now, updated_at=now)
        db.add(member)
        members.append(member)
    await db.commit()
    return admin, tracker, people, cohort, members


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [10, 367])
async def test_fourteen_stage_tracking_uses_bounded_queries_and_preserves_results(count):
    async with AsyncSessionLocal() as db:
        admin, _, people, cohort, members = await context(db, count)
        now = datetime.utcnow()
        stages = [AcceleratorProgramStage(
            cohort_id=cohort["id"], title=f"Stage {i}", position=i, status="published",
            completion_policy={"mode": "manual"} if i == 4 else {"mode": "none"} if i == 6 else {},
            unlock_at=now+timedelta(days=5) if i == 5 else None,
            created_by_user_id=admin.id, updated_by_user_id=admin.id,
        ) for i in range(14)]
        db.add_all(stages)
        await db.flush()
        materials = [AcceleratorProgramMaterial(stage_id=stage.id, title=f"Material {i}",
            position=0, kind="text", content="Required lesson", required=True) for i, stage in enumerate(stages)]
        db.add_all(materials)
        assignments = [AcceleratorHomeworkAssignment(cohort_id=cohort["id"], stage_id=stages[i].id,
            title=f"Work {i}", description="Work", status="published", audience="selected" if i == 1 else "cohort",
            due_at=now-timedelta(days=1), created_by_user_id=admin.id, updated_by_user_id=admin.id) for i in range(4)]
        db.add_all(assignments)
        db.add(AcceleratorProgramAction(stage_id=stages[2].id, action_type="chat", title="Required analysis",
            position=0, required=True))
        await db.flush()
        db.add_all([AcceleratorProgramMaterialProgress(material_id=row.id, membership_id=members[0].id) for row in materials])
        db.add_all([
            AcceleratorHomeworkTarget(assignment_id=assignments[1].id, membership_id=members[0].id),
            AcceleratorHomeworkException(assignment_id=assignments[0].id, membership_id=members[1].id,
                due_at=now+timedelta(days=2), reason="Personal deadline", created_by_user_id=admin.id),
            AcceleratorProgramStageProgress(stage_id=stages[0].id, membership_id=members[1].id,
                completion_source="waived", waiver_reason="Approved exception"),
        ])
        submission = AcceleratorHomeworkSubmission(assignment_id=assignments[0].id,
            membership_id=members[0].id, status="accepted", answer_text="Accepted original version")
        db.add(submission)
        await db.flush()
        attempt = AcceleratorHomeworkAttempt(submission_id=submission.id, attempt_number=1,
            answer_text="Accepted original version", review_status="accepted")
        db.add(attempt)
        await db.flush()
        db.add(AcceleratorHomeworkParticipant(attempt_id=attempt.id, membership_id=members[0].id))
        await db.commit()

        now = datetime.utcnow()
        service = ProgramProgressService(db)
        scalar = {row.id: await service.get_membership_progress(row.id) for row in members[:3]}
        with query_counter(db) as progress_queries:
            progress = await service.get_memberships_progress(members)
        assert {row.id: progress[row.id] for row in members[:3]} == scalar
        assert len(progress_queries) <= 13
        assert not db.dirty  # A read must not update last_evaluated_at for thousands of stages.
        facts = await load_tracking_facts(db, members, now=now)
        risks = {row.id: tracking_risk_from_facts(row, facts[row.id], now=now) for row in members}
        for member in members[:3]:
            assert risks[member.id] == await membership_tracking_risk(db, member)
        assert facts[members[1].id]["overdue_homework"] == 2  # Personal deadline and selected audience apply.
        signal_service = TrackingSignalsService(db)
        scalar_signals = {row.id: await signal_service.get_membership_signals(row, risks[row.id]) for row in members[:3]}
        with query_counter(db) as signal_queries:
            signals = await signal_service.get_cohort_signals(members, risks, progresses=progress)
        for member in members[:3]:
            assert [row for row in signals if row["membership_id"] == member.id] == scalar_signals[member.id]
        assert len(signal_queries) <= 6
        with query_counter(db) as tracking_queries:
            started = perf_counter()
            dashboard = await tracking_dashboard(cohort["id"], admin, db)
            elapsed = perf_counter()-started
        assert len(dashboard["rows"]) == count
        assert len(tracking_queries) <= 65
        assert dashboard["rows"][0]["program"]
        assert not db.dirty
        print(f"members={count}, stages=14, progress_sql={len(progress_queries)}, signals_sql={len(signal_queries)}, tracking_sql={len(tracking_queries)}, tracking_s={elapsed:.3f}")
        with pytest.raises(HTTPException) as denied:
            await cohort_overview_summary(cohort["id"], people[0], db)
        assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_batch_quota_snapshots_preserve_individual_precedence_period_and_unlimited():
    async with AsyncSessionLocal() as db:
        admin, _, _, _, members = await context(db, 3)
        now = datetime.utcnow()
        cohort_limits = {"messages": 20, "roadmaps": 4, "custdev": 2, "grants": 1}
        individual_limits = {"messages": 2, "roadmaps": -1, "custdev": 0, "grants": 3}
        overrides = [AcceleratorResidentQuotaOverride(membership_id=members[0].id, source=source,
            limits=limits, starts_at=now-timedelta(days=days), created_by_user_id=admin.id)
            for source, limits, days in [("cohort", cohort_limits, 5), ("individual", individual_limits, 1)]]
        db.add_all(overrides)
        await db.flush()
        db.add_all([AcceleratorQuotaUsageEvent(membership_id=members[0].id, user_id=members[0].user_id,
            quota_override_id=overrides[1].id, resource="messages", quantity=quantity,
            created_at=when, idempotency_key=uuid.uuid4().hex)
            for quantity, when in [(4, now), (100, now-timedelta(days=2))]])
        await db.commit()
        with query_counter(db) as queries:
            batched = await accelerator_membership_quotas_batch(db, [row.id for row in members])
        assert len(queries) == 2
        for member in members:
            expected = {}
            for resource in cohort_limits:
                snapshot = await accelerator_membership_quota_snapshot(db, member.id, resource)
                if snapshot:
                    expected[resource] = {"limit": snapshot["limit"], "used": snapshot["used"],
                        "remaining": snapshot["remaining"], "source": snapshot["override"].source}
            assert batched.get(member.id, {}) == expected
        assert batched[members[0].id]["messages"]["used"] == 4
        assert batched[members[0].id]["messages"]["remaining"] == 0
        assert batched[members[0].id]["roadmaps"]["remaining"] is None
