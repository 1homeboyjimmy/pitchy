"""Resident team API kept separate from the accelerator foundation router."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_notification_service import process_notification_event
from accelerator_team_service import (
    cancel_team_invitation,
    cohort_teams_payload,
    create_team,
    create_team_invitation,
    invitation_dict,
    membership_invitation_payload,
    membership_team_payload,
    remove_team_member,
    respond_team_invitation,
    team_dict,
    team_view_access,
    update_team,
    update_team_member,
    update_team_member_contact,
    active_member_count,
    active_team_member,
    ensure_team_mutable,
    get_cohort,
    is_manager,
    owner_membership,
    queue_team_notification,
    require_owner,
    require_teams_module,
)
from auth import get_async_current_user
from db_async import get_async_db
from accelerator_service import add_audit
from models import (
    AcceleratorApplication,
    AcceleratorMembership,
    AcceleratorTeam,
    AcceleratorTeamApplication,
    AcceleratorTeamMember,
    User,
)
from schemas.accelerator_teams import (
    AcceleratorMembershipTeamResponse,
    AcceleratorTeamContactUpdate,
    AcceleratorTeamCreate,
    AcceleratorTeamInvitationCreate,
    AcceleratorTeamInvitationListResponse,
    AcceleratorTeamInvitationResponse,
    AcceleratorTeamInvitationUpdate,
    AcceleratorTeamApplicationCreate,
    AcceleratorTeamApplicationUpdate,
    AcceleratorTeamCaptainTransfer,
    AcceleratorTeamListResponse,
    AcceleratorTeamMemberUpdate,
    AcceleratorTeamResponse,
    AcceleratorTeamUpdate,
)


router = APIRouter(prefix="/api/accelerators", tags=["accelerator-teams"])


async def _commit_or_conflict(db: AsyncSession, operation):
    try:
        result = await operation
        await db.commit()
        return result
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Состав команды уже изменился. Обновите страницу и повторите действие.",
        ) from exc


def _schedule_notifications(
    background_tasks: BackgroundTasks, notification_ids: list[int]
) -> None:
    for notification_id in dict.fromkeys(notification_ids):
        background_tasks.add_task(process_notification_event, notification_id)


@router.post(
    "/memberships/{membership_id}/team",
    response_model=AcceleratorTeamResponse,
    response_model_exclude_none=True,
)
async def create_membership_team(
    membership_id: int,
    payload: AcceleratorTeamCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    team = await _commit_or_conflict(
        db,
        create_team(
            db, membership_id=membership_id, payload=payload, user=user
        ),
    )
    return await team_dict(db, team, viewer=user, access_role="resident")


@router.get(
    "/memberships/{membership_id}/team",
    response_model=AcceleratorMembershipTeamResponse,
    response_model_exclude_none=True,
)
async def get_membership_team(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await membership_team_payload(db, membership_id=membership_id, user=user)


@router.get(
    "/cohorts/{cohort_id}/teams",
    response_model=AcceleratorTeamListResponse,
    response_model_exclude_none=True,
)
async def list_cohort_teams(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await cohort_teams_payload(db, cohort_id=cohort_id, user=user)


@router.patch(
    "/teams/{team_id}",
    response_model=AcceleratorTeamResponse,
    response_model_exclude_none=True,
)
async def patch_team(
    team_id: int,
    payload: AcceleratorTeamUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    team, notification_ids = await _commit_or_conflict(
        db, update_team(db, team_id=team_id, payload=payload, user=user)
    )
    _schedule_notifications(background_tasks, notification_ids)
    access_role = await team_view_access(db, team=team, user=user)
    return await team_dict(db, team, viewer=user, access_role=access_role)


@router.post(
    "/teams/{team_id}/invitations",
    response_model=AcceleratorTeamInvitationResponse,
    response_model_exclude_none=True,
)
async def invite_team_member(
    team_id: int,
    payload: AcceleratorTeamInvitationCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    invitation, notification_ids = await _commit_or_conflict(
        db,
        create_team_invitation(db, team_id=team_id, payload=payload, user=user),
    )
    _schedule_notifications(background_tasks, notification_ids)
    return await invitation_dict(db, invitation, viewer=user, access_role="resident")


@router.get(
    "/memberships/{membership_id}/team-invitations",
    response_model=AcceleratorTeamInvitationListResponse,
    response_model_exclude_none=True,
)
async def list_membership_team_invitations(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await membership_invitation_payload(
        db, membership_id=membership_id, user=user
    )


@router.patch(
    "/team-invitations/{invitation_id}",
    response_model=AcceleratorTeamInvitationResponse,
    response_model_exclude_none=True,
)
async def answer_team_invitation(
    invitation_id: int,
    payload: AcceleratorTeamInvitationUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    invitation, notification_ids = await _commit_or_conflict(
        db,
        respond_team_invitation(
            db, invitation_id=invitation_id, status=payload.status, user=user
        ),
    )
    _schedule_notifications(background_tasks, notification_ids)
    return await invitation_dict(db, invitation, viewer=user, access_role="resident")


@router.delete(
    "/team-invitations/{invitation_id}",
    response_model=AcceleratorTeamInvitationResponse,
    response_model_exclude_none=True,
)
async def delete_team_invitation(
    invitation_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    invitation, notification_ids = await _commit_or_conflict(
        db, cancel_team_invitation(db, invitation_id=invitation_id, user=user)
    )
    _schedule_notifications(background_tasks, notification_ids)
    return await invitation_dict(db, invitation, viewer=user, access_role="resident")


@router.patch(
    "/team-members/{member_id}",
    response_model=AcceleratorTeamResponse,
    response_model_exclude_none=True,
)
async def patch_team_member(
    member_id: int,
    payload: AcceleratorTeamMemberUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    team = await _commit_or_conflict(
        db, update_team_member(db, member_id=member_id, payload=payload, user=user)
    )
    return await team_dict(db, team, viewer=user, access_role="resident")


@router.patch(
    "/team-members/{member_id}/contact",
    response_model=AcceleratorTeamResponse,
    response_model_exclude_none=True,
)
async def patch_team_member_contact(
    member_id: int,
    payload: AcceleratorTeamContactUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    team = await _commit_or_conflict(
        db,
        update_team_member_contact(
            db, member_id=member_id, payload=payload, user=user
        ),
    )
    return await team_dict(db, team, viewer=user, access_role="resident")


@router.delete(
    "/team-members/{member_id}",
    response_model=AcceleratorTeamResponse,
    response_model_exclude_none=True,
)
async def delete_team_member(
    member_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    team, notification_ids = await _commit_or_conflict(
        db, remove_team_member(db, member_id=member_id, user=user)
    )
    _schedule_notifications(background_tasks, notification_ids)
    return await team_dict(db, team, viewer=user, access_role="resident")


def _application_contact(application: AcceleratorApplication | None, person: User) -> dict:
    payload = application.form_payload if application else {}
    competencies = payload.get("competencies") or []
    if isinstance(competencies, str):
        competencies = [item.strip() for item in competencies.split(",") if item.strip()]
    return {
        "name": person.name,
        "email": person.email,
        "telegram": payload.get("telegram"),
        "competencies": competencies,
    }


@router.get("/memberships/{membership_id}/team-pool")
async def get_team_pool(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.user_id != user.id or membership.status != "enrolled":
        raise HTTPException(status_code=404, detail="Активное участие не найдено")
    cohort = await get_cohort(db, membership.cohort_id)
    await require_teams_module(db, cohort)
    own_team_member = await active_team_member(db, membership.id)
    active_memberships = select(AcceleratorTeamMember.membership_id).where(
        AcceleratorTeamMember.status == "active"
    )
    teams = list((await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.cohort_id == cohort.id,
        AcceleratorTeam.status == "active",
    ).order_by(AcceleratorTeam.created_at))).scalars().all())
    team_rows = []
    for team in teams:
        owner = await owner_membership(db, team)
        owner_user = await db.get(User, owner.user_id)
        owner_application = await db.get(AcceleratorApplication, owner.application_id)
        team_rows.append({
            "id": team.id,
            "name": team.name,
            "max_members": team.max_members,
            "member_count": await active_member_count(db, team.id),
            "recruiting_open": bool(team.recruiting_open),
            "captain": _application_contact(owner_application, owner_user),
        })
    candidates = []
    if own_team_member and own_team_member.membership_id == membership.id:
        candidate_rows = (await db.execute(
            select(AcceleratorMembership, User, AcceleratorApplication)
            .join(User, User.id == AcceleratorMembership.user_id)
            .join(AcceleratorApplication, AcceleratorApplication.id == AcceleratorMembership.application_id)
            .where(
                AcceleratorMembership.cohort_id == cohort.id,
                AcceleratorMembership.role == "resident",
                AcceleratorMembership.status == "enrolled",
                AcceleratorMembership.id.not_in(active_memberships),
            )
            .order_by(User.name)
        )).all()
        candidates = [{"membership_id": row.id, **_application_contact(application, person)} for row, person, application in candidate_rows]
    applications = list((await db.execute(select(AcceleratorTeamApplication).where(
        (AcceleratorTeamApplication.membership_id == membership.id)
        | (AcceleratorTeamApplication.team_id.in_([team.id for team in teams if team.owner_membership_id == membership.id]))
    ).order_by(AcceleratorTeamApplication.created_at.desc()))).scalars().all())
    application_rows = []
    for row in applications:
        applicant = await db.get(AcceleratorMembership, row.membership_id)
        person = await db.get(User, applicant.user_id) if applicant else None
        application = await db.get(AcceleratorApplication, applicant.application_id) if applicant else None
        team = await db.get(AcceleratorTeam, row.team_id)
        application_rows.append({
            "id": row.id,
            "team_id": row.team_id,
            "team_name": team.name if team else "Команда",
            "membership_id": row.membership_id,
            "applicant": _application_contact(application, person) if person else None,
            "message": row.message,
            "desired_role": row.desired_role,
            "status": row.status,
            "created_at": row.created_at,
            "can_respond": bool(team and team.owner_membership_id == membership.id and row.status == "pending"),
            "can_cancel": bool(row.membership_id == membership.id and row.status == "pending"),
        })
    return {"teams": team_rows, "candidates": candidates, "applications": application_rows}


@router.post("/teams/{team_id}/applications")
async def create_team_application(
    team_id: int,
    payload: AcceleratorTeamApplicationCreate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == team_id
    ).with_for_update())).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    ensure_team_mutable(team, cohort)
    if not team.recruiting_open:
        raise HTTPException(status_code=409, detail="Команда закрыла набор")
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.cohort_id == cohort.id,
        AcceleratorMembership.user_id == user.id,
        AcceleratorMembership.role == "resident",
        AcceleratorMembership.status == "enrolled",
    ).with_for_update())).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=403, detail="Заявку может подать резидент потока")
    if await active_team_member(db, membership.id, lock=True):
        raise HTTPException(status_code=409, detail="Вы уже состоите в команде")
    if await active_member_count(db, team.id) >= team.max_members:
        raise HTTPException(status_code=409, detail="В команде нет свободных мест")
    row = AcceleratorTeamApplication(
        team_id=team.id,
        membership_id=membership.id,
        message=(payload.message or "").strip() or None,
        desired_role=(payload.desired_role or "").strip() or None,
    )
    db.add(row)
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=user.id,
              action="team.application_created", target_type="team_application", details={"team_id": team.id})
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "status": row.status}


@router.patch("/team-applications/{application_id}")
async def respond_team_application(
    application_id: int,
    payload: AcceleratorTeamApplicationUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    row = (await db.execute(select(AcceleratorTeamApplication).where(
        AcceleratorTeamApplication.id == application_id
    ).with_for_update())).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == row.team_id
    ).with_for_update())).scalar_one()
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    ensure_team_mutable(team, cohort)
    applicant = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == row.membership_id
    ).with_for_update())).scalar_one()
    owner = await owner_membership(db, team, lock=True)
    is_applicant = applicant.user_id == user.id
    is_captain = owner.user_id == user.id
    if payload.status == "cancelled" and not is_applicant:
        raise HTTPException(status_code=403, detail="Отозвать заявку может только её автор")
    if payload.status in {"accepted", "declined"} and not is_captain:
        raise HTTPException(status_code=403, detail="Решение принимает капитан команды")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="Решение по заявке уже принято")
    if payload.status == "accepted":
        if await active_team_member(db, applicant.id, lock=True):
            raise HTTPException(status_code=409, detail="Участник уже вступил в другую команду")
        if await active_member_count(db, team.id) >= team.max_members:
            raise HTTPException(status_code=409, detail="В команде нет свободных мест")
        db.add(AcceleratorTeamMember(
            team_id=team.id, membership_id=applicant.id, role="member",
            title=row.desired_role, share_contact=True,
        ))
        other_rows = list((await db.execute(select(AcceleratorTeamApplication).where(
            AcceleratorTeamApplication.membership_id == applicant.id,
            AcceleratorTeamApplication.status == "pending",
            AcceleratorTeamApplication.id != row.id,
        ).with_for_update())).scalars().all())
        for other in other_rows:
            other.status = "cancelled"
            other.responded_at = datetime.utcnow()
    row.status = payload.status
    row.responded_by_user_id = user.id
    row.responded_at = datetime.utcnow()
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=user.id,
              action=f"team.application_{payload.status}", target_type="team_application", target_id=row.id,
              details={"team_id": team.id, "membership_id": applicant.id})
    await db.commit()
    return {"id": row.id, "status": row.status}


@router.patch("/teams/{team_id}/captain")
async def transfer_team_captain(
    team_id: int,
    payload: AcceleratorTeamCaptainTransfer,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == team_id
    ).with_for_update())).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    old_owner = await require_owner(db, team=team, user=user, cohort=cohort)
    target = (await db.execute(select(AcceleratorTeamMember).where(
        AcceleratorTeamMember.team_id == team.id,
        AcceleratorTeamMember.membership_id == payload.membership_id,
        AcceleratorTeamMember.status == "active",
    ).with_for_update())).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=422, detail="Новый капитан должен состоять в команде")
    old_member = (await db.execute(select(AcceleratorTeamMember).where(
        AcceleratorTeamMember.team_id == team.id,
        AcceleratorTeamMember.membership_id == old_owner.id,
        AcceleratorTeamMember.status == "active",
    ).with_for_update())).scalar_one()
    old_member.role = "cofounder"
    target.role = "owner"
    team.owner_membership_id = target.membership_id
    add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=user.id,
              action="team.captain_transferred", target_type="team", target_id=team.id,
              details={"from_membership_id": old_owner.id, "to_membership_id": target.membership_id})
    await db.commit()
    return await team_dict(db, team, viewer=user, access_role="resident")
