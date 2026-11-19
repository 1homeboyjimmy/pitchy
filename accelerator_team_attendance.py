"""Persist shared attendance for the current enrolled members of a team."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select

from accelerator_program_progress_service import ProgramProgressService
from accelerator_team_roster import attendance_team_roster
from models import (
    AcceleratorAttendanceRecord, AcceleratorAuditLog, AcceleratorMembership,
)


async def team_attendance_members(db, cohort, membership):
    roster = attendance_team_roster()
    team_id = (await db.execute(
        select(roster.c.team_id)
        .where(
            roster.c.cohort_id == cohort.id,
            roster.c.membership_id == membership.id,
        )
    )).scalar_one_or_none()
    if team_id is None:
        return [membership]
    return list((await db.execute(
        select(AcceleratorMembership)
        .join(roster, roster.c.membership_id == AcceleratorMembership.id)
        .where(
            roster.c.team_id == team_id,
            roster.c.cohort_id == cohort.id,
            AcceleratorMembership.cohort_id == cohort.id,
            AcceleratorMembership.status == "enrolled",
            AcceleratorMembership.role == "resident",
        ).order_by(AcceleratorMembership.id)
    )).scalars())


async def record_team_attendance(db, *, cohort, event, members, actor, status, method, comment=None):
    # The caller holds an exclusive event lock before locking its own membership.
    # This serializes team scans without conflicting with team transfer lock order.
    records = {record.membership_id: record for record in (await db.execute(
        select(AcceleratorAttendanceRecord).where(
            AcceleratorAttendanceRecord.event_id == event.id,
            AcceleratorAttendanceRecord.membership_id.in_([member.id for member in members]),
        )
    )).scalars()}
    if method == "qr" and any(
        record.checkin_method == "manual" and record.status != "present"
        for record in records.values()
    ):
        raise HTTPException(409, "Посещаемость команды уже отмечена преподавателем. Для изменения обратитесь к преподавателю.")
    now = datetime.utcnow()
    for member in members:
        record = records.get(member.id)
        if method == "qr" and record and record.status == "present":
            continue
        if status == "not_marked":
            if record is not None:
                await db.delete(record)
                records.pop(member.id)
        else:
            if record is None:
                record = AcceleratorAttendanceRecord(event_id=event.id, membership_id=member.id)
                db.add(record)
                records[member.id] = record
            record.status = status
            record.checkin_method = method
            record.checked_in_at = now if status == "present" else None
            record.marked_by_user_id = actor.id if method == "manual" else None
            record.comment = (comment or "").strip() or None
        action = "attendance.marked"
        if status == "not_marked":
            action = "attendance.cleared"
        elif method == "qr":
            action = "attendance.checked_in"
        db.add(AcceleratorAuditLog(
            accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            actor_user_id=actor.id, action=action,
            target_type="event", target_id=event.id,
            details={"membership_id": member.id, "status": status, "method": method, "scope": "team"},
        ))
        if event.stage_id:
            await db.flush()
            state = await ProgramProgressService(db).complete_or_reconcile_stage(member.id, event.stage_id)
            if state["became_completed"]:
                db.add(AcceleratorAuditLog(
                    accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
                    actor_user_id=actor.id, action="program_stage.completed",
                    target_type="program_stage", target_id=event.stage_id,
                    details={"membership_id": member.id, "source": "auto"},
                ))
    return records
