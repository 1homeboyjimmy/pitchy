"""Live team roster and editing policy for a project passport."""
from sqlalchemy import select, or_, exists
from fastapi import HTTPException
from accelerator_team_roster import linked_team_roster
from models import (AcceleratorTeam, AcceleratorTeamMember, AcceleratorMembership,
                    AcceleratorProjectMember, User)


async def passport_context(db, project, user):
    # Secondary imported ideas may share the same team as its primary project.
    linked = exists(select(AcceleratorProjectMember.id).where(
        AcceleratorProjectMember.project_id == project.id,
        AcceleratorProjectMember.team_id == AcceleratorTeam.id,
        AcceleratorProjectMember.status == "active",
    ))
    teams = list((await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.status == "active",
        or_(AcceleratorTeam.project_id == project.id, linked),
    ).order_by(AcceleratorTeam.id))).scalars())
    passport = dict(project.passport or {})
    if not teams:
        return passport, project.user_id == user.id, False
    owners = list((await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id.in_([team.owner_membership_id for team in teams]),
    ))).scalars())
    can_edit = len(owners) == len({team.owner_membership_id for team in teams}) and all(
        owner.user_id == user.id and owner.status == "enrolled" and owner.role == "resident"
        for owner in owners
    )
    rows = (await db.execute(select(AcceleratorTeamMember.title, AcceleratorMembership, User)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorTeamMember.membership_id)
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(AcceleratorTeamMember.team_id.in_([team.id for team in teams]),
               AcceleratorTeamMember.status == "active",
               AcceleratorMembership.status == "enrolled", AcceleratorMembership.role == "resident")
        .order_by(AcceleratorTeamMember.id))).all()
    if any(team.attendance_team_id is not None for team in teams):
        from sqlalchemy import null
        linked_roster = linked_team_roster().subquery()
        rows += (await db.execute(select(null(), AcceleratorMembership, User)
            .join_from(AcceleratorMembership, linked_roster, linked_roster.c.membership_id == AcceleratorMembership.id)
            .join(User, User.id == AcceleratorMembership.user_id)
            .where(linked_roster.c.team_id.in_([team.id for team in teams]), AcceleratorMembership.status == "enrolled")
            .order_by(User.name, User.id))).all()
    owner_ids = {team.owner_membership_id for team in teams}
    roster = []
    seen = set()
    for title, membership, person in sorted(rows, key=lambda row: row[1].id not in owner_ids):
        if person.id in seen:
            continue
        seen.add(person.id)
        role = "Руководитель команды" if membership.id in owner_ids else "Участник команды"
        if title:
            role += f" · {title}"
        roster.append(f"{person.name or person.username or 'Участник'} — {role}")
    passport["team"] = roster
    passport["_meta"] = {**(passport.get("_meta") or {}), "team": {"source": "team"}}
    return passport, can_edit, True


async def require_passport_editor(db, project, user):
    passport, can_edit, managed = await passport_context(db, project, user)
    if not can_edit:
        raise HTTPException(status_code=403, detail="Паспорт проекта может заполнять только владелец команды или личного проекта")
    return passport, managed
