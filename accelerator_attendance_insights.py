"""Organizer attendance insights, using the reporting policy and effective marks."""
from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import load_only
from accelerator_attendance_reporting import attendance_summaries
from accelerator_team_roster import active_team_roster, attendance_team_roster
from models import (AcceleratorMembership, AcceleratorTeam, AcceleratorEvent,
                    AcceleratorParticipantProfile, Project)


def profile_label(value):
    value = str(value or "").strip()
    return "" if value.lower() in {"null", "none", "не указано", "-"} else value


def education_level(profile):
    levels = {"БАК": "Бакалавриат", "МАГ": "Магистратура",
              "СПЕЦ": "Специалитет", "АСП": "Аспирантура"}
    direction = profile_label(profile.get("education_direction")).upper()
    if direction in levels:
        return levels[direction]
    for label in levels.values():
        if direction == label.upper():
            return label
    # A speciality is not an education level; derive the level from the course.
    course = profile_label(profile.get("education_course")).upper().split("-", 1)[0]
    return levels.get(course, "Не указано")


def attendance_band(present, total):
    if not total:
        return "no_data"
    if not present:
        return "zero"
    if present * 2 < total:
        return "below50"
    return "normal"


def grouped_attendance(members, summaries, labels):
    groups = defaultdict(lambda: {"participants": 0, "present": 0, "total": 0})
    for member in members:
        group = groups[labels.get(member.id) or "Не указано"]
        summary = summaries[member.id]
        group["participants"] += 1
        group["present"] += summary["present"]
        group["total"] += summary["total"] if summary["past_events"] else 0
    return sorted([{"label": label, **values,
        "percent": round(values["present"] * 100 / values["total"], 1) if values["total"] else None}
        for label, values in groups.items()], key=lambda row: (row["label"] == "Не указано", row["label"]))


async def attendance_insights(db, cohort, *, now=None):
    now = now or datetime.utcnow()
    members = list((await db.execute(select(AcceleratorMembership).options(load_only(
        AcceleratorMembership.id, AcceleratorMembership.cohort_id)).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status.in_(("enrolled", "completed")),
    ))).scalars())
    attendance_context = {}
    summaries = await attendance_summaries(db, members, now=now, context=attendance_context)
    teams = list((await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.cohort_id == cohort.id, AcceleratorTeam.status == "active",
    ))).scalars())
    roster = attendance_team_roster() if cohort.attendance_scope == "team" else active_team_roster()
    links = (await db.execute(select(roster.c.team_id, roster.c.membership_id).where(
        roster.c.team_id.in_([team.id for team in teams]),
        roster.c.membership_id.in_([member.id for member in members]),
    ))).all() if teams and members else []
    ids_by_team = defaultdict(set)
    for team_id, member_id in links:
        ids_by_team[team_id].add(member_id)
    projects = dict((await db.execute(select(Project.id, Project.passport["accelerator_track"].as_string()).where(
        Project.id.in_([team.project_id for team in teams if team.project_id]),
    ))).all()) if teams else {}
    team_rows = []
    tracks = {}
    physical_teams = [team for team in teams if team.attendance_team_id is None]
    for team in physical_teams:
        ids = ids_by_team[team.id]
        values = [summaries[mid] for mid in ids]
        present = sum(value["present"] for value in values)
        total = sum(value["total"] for value in values if value["past_events"])
        track = projects.get(team.project_id) or "Не указано"
        for mid in ids:
            tracks[mid] = track
        team_rows.append({"id":team.id, "name":team.name, "members":len(ids), "track":track,
            "present":present, "total":total,
            "percent":round(present * 100 / total, 1) if total else None,
            "band":attendance_band(present,total)})
    ranked = sorted([row for row in team_rows if row["total"]],
                    key=lambda row:(-row["present"]/row["total"],row["name"],row["id"]))
    distribution = {key:sum(row["band"]==key for row in team_rows) for key in ("zero","below50","normal","no_data")}
    participant_counts = {key:0 for key in distribution}
    for member in members:
        value=summaries[member.id]
        participant_counts[attendance_band(value["present"],value["total"] if value["past_events"] else 0)]+=1
    profile_rows = (await db.execute(select(
        AcceleratorParticipantProfile.membership_id,
        AcceleratorParticipantProfile.profile["education_course"].as_string(),
        AcceleratorParticipantProfile.profile["education_direction"].as_string(),
    ).where(AcceleratorParticipantProfile.membership_id.in_([m.id for m in members])))).all() if members else []
    profiles = {mid: {"education_course": course, "education_direction": direction}
                for mid, course, direction in profile_rows}
    course_labels, direction_labels = {}, {}
    for member in members:
        profile=profiles.get(member.id,{})
        course=profile_label(profile.get("education_course"))
        if "-" in course and course.rsplit("-",1)[-1].isdigit():
            level,number=course.rsplit("-",1)
            course_labels[member.id]=f"{level} · {number} курс"
        else:
            course_labels[member.id]=course or "Не указано"
        direction_labels[member.id]=education_level(profile)
    policy=cohort.attendance_policy or {}
    events=sorted(attendance_context.get("events", []), key=lambda event:(event.starts_at,event.id))
    if policy:
        events=[event for event in events if event.id in policy["event_ids"]]
    records=attendance_context.get("records", {})
    exclusions=policy.get("excluded_events_by_team",{})
    member_teams={mid:team.id for team in physical_teams for mid in ids_by_team[team.id]}
    trend=[]
    for event in events:
        eligible,present=0,0
        if cohort.attendance_scope=="team":
            for team in physical_teams:
                ids=ids_by_team[team.id]
                if not ids or event.id in exclusions.get(str(team.id),[]):continue
                eligible+=1
                present+=int(any(records.get(mid,{}).get(event.id) and records[mid][event.id].status=="present" for mid in ids))
        else:
            for member in members:
                if event.id in exclusions.get(str(member_teams.get(member.id)),[]):continue
                eligible+=1
                mark=records.get(member.id,{}).get(event.id)
                present+=int(bool(mark and mark.status=="present"))
        trend.append({"id":event.id,"title":event.title,"starts_at":event.starts_at,
                      "present":present,"total":eligible,"percent":round(present*100/eligible,1) if eligible else None})
    measured=[row for row in team_rows if row["total"]]
    if cohort.attendance_scope=="team":
        percent=round(sum(row["present"]/row["total"] for row in measured)*100/len(measured),1) if measured else None
    else:
        total=sum(row["total"] for row in summaries.values() if row["past_events"])
        percent=round(sum(row["present"] for row in summaries.values())*100/total,1) if total else None
    visits = Counter(summary["present"] for summary in summaries.values())
    visit_distribution = [{"visits": count, "participants": visits[count]}
                          for count in range(max(len(events), max(visits, default=0)) + 1)]
    return {"scope":cohort.attendance_scope,"basis":"planned" if policy else "past", "past_events":len(events),
        "percent":percent,"teams":len(physical_teams),"distribution":distribution,
        "participants":participant_counts,"visit_distribution":visit_distribution,
        "top_teams":[row for row in ranked if row["present"]>0][:5],
        "by_course":grouped_attendance(members,summaries,course_labels),
        "by_direction":[row for row in grouped_attendance(members,summaries,direction_labels)
                        if row["label"] in {"Аспирантура", "Бакалавриат", "Магистратура"}],
        "by_track":grouped_attendance(members,summaries,tracks),"events":trend}
