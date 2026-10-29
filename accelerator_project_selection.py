"""The active team's project is primary; personal projects retain their history."""
from fastapi import HTTPException
from sqlalchemy import or_, select
from pydantic import BaseModel
from accelerator_service import add_audit
from models import AcceleratorCohort, AcceleratorMembership, AcceleratorTeam, Project


class ResidentProjectSelection(BaseModel):
    project_id: int


async def selection_context(db, membership_id, user):
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == membership_id, AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident", AcceleratorMembership.status == "enrolled",
    ).with_for_update())).scalar_one_or_none()
    if not membership:
        raise HTTPException(404, "Активное участие не найдено")
    cohort = await db.get(AcceleratorCohort, membership.cohort_id)
    if cohort.status in {"completed", "archived"}:
        raise HTTPException(409, "Поток завершён")
    return membership, cohort


async def project_options(db, membership_id, user):
    membership, cohort = await selection_context(db, membership_id, user)
    team = await membership_team(db, membership.id)
    from project_access import shared_project_ids
    projects = (await db.execute(select(Project).where(or_(Project.user_id == user.id,
        Project.id.in_(shared_project_ids(user.id, cohort.id)),
        Project.id == team.project_id if team else False), Project.status == "active").order_by(Project.id))).scalars().all()
    return {"project_id": membership.project_id,
            "projects": [{"id": project.id, "name": project.name} for project in projects],
            "selection_locked": team is not None,
            "team": {"id": team.id, "name": team.name, "project_id": team.project_id} if team else None}


async def membership_team(db, membership_id):
    from accelerator_team_service import active_team_member
    member = await active_team_member(db, membership_id)
    return await db.get(AcceleratorTeam, member.team_id) if member else None


async def select_project(db, membership_id, user, project_id):
    membership, cohort = await selection_context(db, membership_id, user)
    team = await membership_team(db, membership.id)
    if team and project_id != team.project_id:
        raise HTTPException(409, "Основным является проект вашей команды. Личные проекты доступны отдельно в Pitchy.")
    from project_access import shared_project_ids
    project = (await db.execute(select(Project).where(Project.id == project_id,
        or_(Project.user_id == user.id, Project.id.in_(shared_project_ids(user.id, cohort.id)),
            Project.id == team.project_id if team else False), Project.status == "active"))).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Проект не найден")
    previous = membership.project_id
    if previous != project.id:
        membership.project_id = project.id
        add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=user.id,
                  action="resident.project_selected", target_type="membership", target_id=membership.id,
                  details={"from_project_id": previous, "to_project_id": project.id})
    return {"membership_id": membership.id, "project_id": membership.project_id}
