"""Project rosters include participants with active grants on linked teams."""
from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased

from models import AcceleratorMembership, AcceleratorProjectMember, AcceleratorTeam, AcceleratorTeamMember


def linked_team_roster():
    attendance_team = aliased(AcceleratorTeam)
    return (
        select(AcceleratorTeam.id.label("team_id"), AcceleratorProjectMember.membership_id, AcceleratorProjectMember.id.label("grant_id"))
        .join(AcceleratorProjectMember, AcceleratorProjectMember.team_id == AcceleratorTeam.id)
        .join(attendance_team, attendance_team.id == AcceleratorTeam.attendance_team_id)
        .join(AcceleratorMembership, AcceleratorMembership.id == AcceleratorProjectMember.membership_id)
        .join(AcceleratorTeamMember, AcceleratorTeamMember.membership_id == AcceleratorMembership.id)
        .where(
            AcceleratorTeam.status == "active", attendance_team.status == "active",
            AcceleratorTeam.cohort_id == attendance_team.cohort_id,
            AcceleratorMembership.cohort_id == AcceleratorTeam.cohort_id,
            AcceleratorMembership.role == "resident",
            AcceleratorMembership.status.in_(("enrolled", "completed")),
            AcceleratorProjectMember.project_id == AcceleratorTeam.project_id,
            AcceleratorProjectMember.status == "active",
            AcceleratorTeamMember.team_id == attendance_team.id,
            AcceleratorTeamMember.status == "active",
        )
    )


def active_team_roster():
    direct = select(AcceleratorTeamMember.team_id, AcceleratorTeamMember.membership_id).where(
        AcceleratorTeamMember.status == "active",
    )
    linked = linked_team_roster().subquery()
    return direct.union(select(linked.c.team_id, linked.c.membership_id)).subquery()


def attendance_team_roster():
    """Map each direct team member to the active team that owns their attendance."""
    anchor = aliased(AcceleratorTeam)
    return (
        select(
            func.coalesce(anchor.id, AcceleratorTeam.id).label("team_id"),
            AcceleratorTeamMember.membership_id,
            AcceleratorTeam.cohort_id,
        )
        .join(AcceleratorTeamMember, AcceleratorTeamMember.team_id == AcceleratorTeam.id)
        .outerjoin(anchor, and_(
            anchor.id == AcceleratorTeam.attendance_team_id,
            anchor.cohort_id == AcceleratorTeam.cohort_id,
            anchor.status == "active",
        ))
        .where(AcceleratorTeam.status == "active", AcceleratorTeamMember.status == "active")
        .subquery()
    )
