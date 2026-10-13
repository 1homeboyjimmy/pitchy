"""Residents can choose among their personal projects without altering history."""
from fastapi import HTTPException
from sqlalchemy import select
from pydantic import BaseModel
from accelerator_service import add_audit
from accelerator_team_service import active_team_member
from models import AcceleratorCohort, AcceleratorMembership, Project


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
    membership, _ = await selection_context(db, membership_id, user)
    if await active_team_member(db, membership.id):
        return {"project_id": membership.project_id, "projects": []}
    projects = (await db.execute(select(Project).where(Project.user_id == user.id, Project.status == "active").order_by(Project.id))).scalars().all()
    return {"project_id": membership.project_id, "projects": [{"id": project.id, "name": project.name} for project in projects]}


async def select_project(db, membership_id, user, project_id):
    membership, cohort = await selection_context(db, membership_id, user)
    if await active_team_member(db, membership.id, lock=True):
        raise HTTPException(409, "Общий проект меняется через управление командой")
    project = (await db.execute(select(Project).where(Project.id == project_id, Project.user_id == user.id, Project.status == "active"))).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Проект не найден")
    previous = membership.project_id
    if previous != project.id:
        membership.project_id = project.id
        add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=user.id,
                  action="resident.project_selected", target_type="membership", target_id=membership.id,
                  details={"from_project_id": previous, "to_project_id": project.id})
    return {"membership_id": membership.id, "project_id": membership.project_id}
