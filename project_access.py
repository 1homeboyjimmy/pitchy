"""Project contents are shared only with active, enrolled team members."""
from fastapi import HTTPException
from sqlalchemy import or_, select
from models import AcceleratorCohort, AcceleratorMembership, AcceleratorTeam, AcceleratorTeamMember, Project


def shared_project_ids(user_id):
    return (
        select(AcceleratorTeam.project_id)
        .join(AcceleratorTeamMember, AcceleratorTeamMember.team_id == AcceleratorTeam.id)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorTeamMember.membership_id)
        .join(AcceleratorCohort, AcceleratorCohort.id == AcceleratorTeam.cohort_id)
        .where(
            AcceleratorTeam.status == "active",
            AcceleratorTeamMember.status == "active",
            AcceleratorMembership.user_id == user_id,
            AcceleratorMembership.role == "resident",
            AcceleratorMembership.status == "enrolled",
            AcceleratorMembership.cohort_id == AcceleratorTeam.cohort_id,
            AcceleratorMembership.project_id == AcceleratorTeam.project_id,
            AcceleratorCohort.status.not_in(["completed", "archived"]),
        )
    )


def project_access_condition(user_id):
    return or_(Project.user_id == user_id, Project.id.in_(shared_project_ids(user_id)))


async def get_accessible_project(db, project_id, user, *, owner_only=False, staff_read=False):
    condition = Project.user_id == user.id if owner_only else project_access_condition(user.id)
    project = (await db.execute(select(Project).where(Project.id == project_id, condition))).scalar_one_or_none()
    if not project and staff_read:
        from accelerator_service import require_tracker_membership_access
        memberships = (await db.execute(select(AcceleratorMembership).where(AcceleratorMembership.project_id == project_id))).scalars().all()
        for membership in memberships:
            try:
                await require_tracker_membership_access(db, user, membership)
            except HTTPException:
                continue
            project = await db.get(Project, project_id)
            break
    if not project:
        raise HTTPException(status_code=404, detail="Папка проекта не найдена")
    return project
