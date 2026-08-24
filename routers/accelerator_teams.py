"""Resident team API kept separate from the accelerator foundation router."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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
)
from auth import get_async_current_user
from db_async import get_async_db
from models import User
from schemas.accelerator_teams import (
    AcceleratorMembershipTeamResponse,
    AcceleratorTeamContactUpdate,
    AcceleratorTeamCreate,
    AcceleratorTeamInvitationCreate,
    AcceleratorTeamInvitationListResponse,
    AcceleratorTeamInvitationResponse,
    AcceleratorTeamInvitationUpdate,
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
