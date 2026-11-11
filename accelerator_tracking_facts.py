"""Read tracking facts in batches without computing reports, quotas or stage progress."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_service import membership_trackers_batch
from accelerator_homework_service import participant_results
from models import (
    AcceleratorAttendanceRecord, AcceleratorEvent, AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission, AcceleratorHomeworkTarget, AcceleratorMembership, AcceleratorHomeworkException,
    AcceleratorProgramConfig, AcceleratorProgramStageProgress, AcceleratorProgressCheckin,
    AcceleratorTrackingTask,
)


async def load_tracking_facts(
    db: AsyncSession, memberships: list[AcceleratorMembership], *, now: datetime,
) -> dict[int, dict]:
    if not memberships:
        return {}
    ids = [row.id for row in memberships]
    cohort_ids = {row.cohort_id for row in memberships}
    configs = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id.in_(cohort_ids),
    ))).scalars().all()
    modules = {row.cohort_id: row.modules or {} for row in configs}
    checkin_rank = select(
        AcceleratorProgressCheckin.id,
        func.row_number().over(
            partition_by=AcceleratorProgressCheckin.membership_id,
            order_by=(AcceleratorProgressCheckin.period_start.desc(), AcceleratorProgressCheckin.id.desc()),
        ).label("position"),
    ).where(AcceleratorProgressCheckin.membership_id.in_(ids)).subquery()
    latest = (await db.execute(select(AcceleratorProgressCheckin).join(
        checkin_rank, checkin_rank.c.id == AcceleratorProgressCheckin.id,
    ).where(checkin_rank.c.position == 1))).scalars().all()
    latest_by_member = {row.membership_id: row for row in latest}
    homework_cohorts = [key for key, value in modules.items() if value.get("homework")]
    assignments = (await db.execute(select(AcceleratorHomeworkAssignment).where(
        AcceleratorHomeworkAssignment.cohort_id.in_(homework_cohorts),
        AcceleratorHomeworkAssignment.status == "published",
        AcceleratorHomeworkAssignment.due_at < now,
    ))).scalars().all() if homework_cohorts else []
    assignment_ids = [row.id for row in assignments]
    targets = set((await db.execute(select(
        AcceleratorHomeworkTarget.assignment_id, AcceleratorHomeworkTarget.membership_id,
    ).where(AcceleratorHomeworkTarget.assignment_id.in_(assignment_ids),
            AcceleratorHomeworkTarget.membership_id.in_(ids)))).all()) if assignment_ids else set()
    results = await participant_results(db, ids, assignment_ids) if assignment_ids else {}
    exceptions = (await db.execute(select(AcceleratorHomeworkException).where(
        AcceleratorHomeworkException.assignment_id.in_(assignment_ids),
        AcceleratorHomeworkException.membership_id.in_(ids),
    ))).scalars().all() if assignment_ids else []
    deadlines = {(row.assignment_id, row.membership_id): row.due_at for row in exceptions}
    overdue_tasks = dict((await db.execute(select(
        AcceleratorTrackingTask.membership_id, func.count(),
    ).where(AcceleratorTrackingTask.membership_id.in_(ids),
            AcceleratorTrackingTask.status == "open", AcceleratorTrackingTask.due_at < now)
        .group_by(AcceleratorTrackingTask.membership_id))).all())
    attendance_cohorts = [key for key, value in modules.items() if value.get("attendance")]
    events = (await db.execute(select(AcceleratorEvent.id, AcceleratorEvent.cohort_id).where(
        AcceleratorEvent.cohort_id.in_(attendance_cohorts), AcceleratorEvent.status == "published",
        AcceleratorEvent.ends_at < now,
    ))).all() if attendance_cohorts else []
    event_counts: dict[int, int] = {}
    for _, cohort_id in events:
        event_counts[cohort_id] = event_counts.get(cohort_id, 0) + 1
    present = dict((await db.execute(select(
        AcceleratorAttendanceRecord.membership_id, func.count(),
    ).where(AcceleratorAttendanceRecord.membership_id.in_(ids),
            AcceleratorAttendanceRecord.event_id.in_([row.id for row in events]),
            AcceleratorAttendanceRecord.status == "present")
        .group_by(AcceleratorAttendanceRecord.membership_id))).all()) if events else {}
    activity = {row.id: [row.updated_at, row.enrolled_at, row.accepted_at] for row in memberships}
    for model, field in (
        (AcceleratorProgressCheckin, AcceleratorProgressCheckin.created_at),
        (AcceleratorHomeworkSubmission, AcceleratorHomeworkSubmission.submitted_at),
        (AcceleratorAttendanceRecord, AcceleratorAttendanceRecord.updated_at),
        (AcceleratorProgramStageProgress, AcceleratorProgramStageProgress.completed_at),
    ):
        rows = (await db.execute(select(model.membership_id, func.max(field)).where(
            model.membership_id.in_(ids),
        ).group_by(model.membership_id))).all()
        for membership_id, at in rows:
            activity[membership_id].append(at)
    trackers = await membership_trackers_batch(db, ids)
    assignments_by_cohort: dict[int, list] = {}
    for assignment in assignments:
        assignments_by_cohort.setdefault(assignment.cohort_id, []).append(assignment)
    facts = {}
    for member in memberships:
        applicable = [row for row in assignments_by_cohort.get(member.cohort_id, [])
                      if row.audience != "selected" or (row.id, member.id) in targets]
        dates = [value for value in activity[member.id] if value is not None]
        last_activity_at = max(dates) if dates else None
        total = event_counts.get(member.cohort_id, 0)
        facts[member.id] = {
            "latest_checkin": latest_by_member.get(member.id),
            "overdue_homework": sum(
                bool((deadlines.get((row.id, member.id)) or row.due_at) < now
                     and (not results.get((row.id, member.id)) or results[(row.id, member.id)].status not in ("submitted", "accepted")))
                for row in applicable
            ),
            "overdue_tasks": int(overdue_tasks.get(member.id, 0)),
            "attendance_total": total,
            "present_count": int(present.get(member.id, 0)),
            "last_activity_at": last_activity_at,
            "has_tracker": bool(trackers.get(member.id)),
        }
    return facts
