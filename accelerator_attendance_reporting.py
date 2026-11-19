"""Shared attendance totals for residents, staff reports and cohort analytics."""
from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select

from models import (
    AcceleratorAttendanceRecord, AcceleratorCohort, AcceleratorEvent,
    AcceleratorMembership, AcceleratorTeam, AcceleratorTeamMember,
)


async def validate_attendance_policy(db, cohort_id, policy):
    if policy is None or not policy.event_ids:
        return
    ids = set((await db.execute(select(AcceleratorEvent.id).where(
        AcceleratorEvent.cohort_id == cohort_id,
        AcceleratorEvent.id.in_(policy.event_ids),
    ))).scalars())
    if ids != set(policy.event_ids):
        raise HTTPException(422, "Все мероприятия расчёта должны принадлежать этому потоку")
    if policy.excluded_events_by_team:
        team_ids = set((await db.execute(select(AcceleratorTeam.id).where(
            AcceleratorTeam.cohort_id == cohort_id,
            AcceleratorTeam.id.in_(policy.excluded_events_by_team),
        ))).scalars())
        if team_ids != set(policy.excluded_events_by_team):
            raise HTTPException(422, "Все команды с исключениями должны принадлежать этому потоку")


async def _attendance_teams(db, cohorts):
    team_cohorts = [cohort.id for cohort in cohorts.values() if cohort.attendance_scope == "team"]
    links = (await db.execute(select(AcceleratorTeamMember.team_id, AcceleratorMembership.id).join(
        AcceleratorMembership, AcceleratorMembership.id == AcceleratorTeamMember.membership_id,
    ).join(AcceleratorTeam, AcceleratorTeam.id == AcceleratorTeamMember.team_id).where(
        AcceleratorTeam.cohort_id.in_(team_cohorts),
        AcceleratorMembership.cohort_id == AcceleratorTeam.cohort_id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status.in_(("enrolled", "completed")),
        AcceleratorTeam.status == "active", AcceleratorTeamMember.status == "active",
    ))).all() if team_cohorts else []
    return dict((member_id, team_id) for team_id, member_id in links)


async def effective_attendance_records(db, memberships, event_ids, *, cohorts=None, team_by_member=None):
    if not memberships or not event_ids:
        return {}
    if cohorts is None:
        cohorts = {cohort.id: cohort for cohort in (await db.execute(select(AcceleratorCohort).where(
            AcceleratorCohort.id.in_({member.cohort_id for member in memberships}),
        ))).scalars()}
    if team_by_member is None:
        team_by_member = await _attendance_teams(db, cohorts)
    member_ids = {member.id for member in memberships} | set(team_by_member)
    records = (await db.execute(select(AcceleratorAttendanceRecord).where(
        AcceleratorAttendanceRecord.membership_id.in_(member_ids),
        AcceleratorAttendanceRecord.event_id.in_(event_ids),
    ).order_by(AcceleratorAttendanceRecord.updated_at, AcceleratorAttendanceRecord.id))).scalars().all()
    grouped = defaultdict(dict)
    for record in records:
        member_id = record.membership_id
        key = ("team", team_by_member[member_id]) if member_id in team_by_member else ("member", member_id)
        previous = grouped[key].get(record.event_id)
        if previous is None or record.status == "present" or previous.status != "present":
            grouped[key][record.event_id] = record
    result = {}
    for member in memberships:
        key = ("team", team_by_member[member.id]) if member.id in team_by_member else ("member", member.id)
        result[member.id] = grouped[key]
    return result


async def attendance_summaries(db, memberships, *, now=None):
    if not memberships:
        return {}
    now = now or datetime.utcnow()
    cohorts = {cohort.id: cohort for cohort in (await db.execute(select(AcceleratorCohort).where(
        AcceleratorCohort.id.in_({member.cohort_id for member in memberships}),
    ))).scalars()}
    events = (await db.execute(select(AcceleratorEvent).where(
        AcceleratorEvent.cohort_id.in_(cohorts),
        AcceleratorEvent.status.in_(("published", "completed")),
        AcceleratorEvent.ends_at <= now,
    ))).scalars().all()
    event_ids = defaultdict(set)
    for event in events:
        policy = cohorts[event.cohort_id].attendance_policy
        if not policy or event.id in policy["event_ids"]:
            event_ids[event.cohort_id].add(event.id)
    selected_events = set().union(*event_ids.values()) if event_ids else set()
    team_by_member = await _attendance_teams(db, cohorts)
    records = await effective_attendance_records(db, memberships, selected_events, cohorts=cohorts, team_by_member=team_by_member)
    summaries = {}
    for member in memberships:
        cohort = cohorts[member.cohort_id]
        policy = cohort.attendance_policy
        exclusions = policy.get("excluded_events_by_team", {}) if policy else {}
        team_id = team_by_member.get(member.id)
        excluded = set(exclusions.get(str(team_id), exclusions.get(team_id, []))) if team_id else set()
        selected = event_ids[cohort.id] - excluded
        member_records = records.get(member.id, {})
        attended = sum(record.status == "present" for event_id, record in member_records.items() if event_id in selected)
        marked_count = sum(event_id in selected for event_id in member_records)
        total = policy["planned_events"] - len(excluded) if policy else len(selected)
        summaries[member.id] = {
            "present": attended, "marked": marked_count, "total": total,
            "unmarked": total - marked_count,
            "percent": round(attended * 100 / total) if total else None,
            "past_events": len(selected), "basis": "planned" if policy else "past",
        }
    return summaries
