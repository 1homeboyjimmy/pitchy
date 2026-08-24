"""Resident-owned accelerator teams with strict cohort and contact boundaries."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_notification_service import enqueue_notification
from accelerator_service import (
    add_audit,
    is_accelerator_organizer,
)
from models import (
    AcceleratorCohort,
    AcceleratorMatchProfile,
    AcceleratorMembership,
    AcceleratorProgramConfig,
    AcceleratorTeam,
    AcceleratorTeamInvitation,
    AcceleratorTeamMember,
    AcceleratorTrackerAssignment,
    Project,
    User,
)
from schemas.accelerator_teams import (
    AcceleratorTeamContactUpdate,
    AcceleratorTeamCreate,
    AcceleratorTeamInvitationCreate,
    AcceleratorTeamMemberUpdate,
    AcceleratorTeamUpdate,
)


INVITATION_TTL_DAYS = 14
FROZEN_COHORT_STATUSES = {"completed", "archived"}


async def get_cohort(db: AsyncSession, cohort_id: int) -> AcceleratorCohort:
    cohort = await db.get(AcceleratorCohort, cohort_id)
    if not cohort:
        raise HTTPException(status_code=404, detail="Поток не найден")
    return cohort


async def require_teams_module(
    db: AsyncSession, cohort: AcceleratorCohort
) -> AcceleratorProgramConfig:
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == cohort.id
    ))).scalar_one_or_none()
    if not config or not (config.modules or {}).get("matchmaking"):
        raise HTTPException(
            status_code=409,
            detail="Модуль матчмейкинга не включён для этого потока",
        )
    return config


async def is_manager(db: AsyncSession, user: User, cohort: AcceleratorCohort) -> bool:
    return user.is_admin or await is_accelerator_organizer(
        db, user.id, cohort.accelerator_id
    )


async def membership_read_access(
    db: AsyncSession,
    *,
    membership: AcceleratorMembership,
    user: User,
    cohort: AcceleratorCohort,
) -> str:
    if membership.user_id == user.id:
        return "resident"
    if await is_manager(db, user, cohort):
        return "manager"
    assigned = (await db.execute(select(AcceleratorTrackerAssignment.id).where(
        AcceleratorTrackerAssignment.membership_id == membership.id,
        AcceleratorTrackerAssignment.tracker_user_id == user.id,
    ))).scalar_one_or_none()
    if assigned is not None:
        return "tracker"
    raise HTTPException(status_code=403, detail="Нет доступа к команде резидента")


def ensure_team_mutable(team: AcceleratorTeam, cohort: AcceleratorCohort) -> None:
    if team.status != "active":
        raise HTTPException(status_code=409, detail="Команда уже находится в архиве")
    if cohort.status in FROZEN_COHORT_STATUSES:
        raise HTTPException(status_code=409, detail="Состав завершённого потока заморожен")


async def owner_membership(
    db: AsyncSession, team: AcceleratorTeam, *, lock: bool = False
) -> AcceleratorMembership:
    query = select(AcceleratorMembership).where(
        AcceleratorMembership.id == team.owner_membership_id
    )
    if lock:
        query = query.with_for_update()
    membership = (await db.execute(query)).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=409, detail="Владелец команды недоступен")
    return membership


async def require_owner(
    db: AsyncSession,
    *,
    team: AcceleratorTeam,
    user: User,
    cohort: AcceleratorCohort,
) -> AcceleratorMembership:
    membership = await owner_membership(db, team, lock=True)
    if membership.user_id != user.id:
        raise HTTPException(status_code=403, detail="Управлять командой может только владелец")
    if membership.status != "enrolled":
        raise HTTPException(status_code=409, detail="Участие владельца команды не активно")
    ensure_team_mutable(team, cohort)
    return membership


async def expire_pending_invitations(
    db: AsyncSession,
    *,
    cohort: AcceleratorCohort,
    actor_user_id: int | None,
    team_id: int | None = None,
    invitee_membership_id: int | None = None,
) -> list[AcceleratorTeamInvitation]:
    now = datetime.utcnow()
    query = select(AcceleratorTeamInvitation).where(
        AcceleratorTeamInvitation.status == "pending",
        AcceleratorTeamInvitation.expires_at <= now,
    )
    if team_id is not None:
        query = query.where(AcceleratorTeamInvitation.team_id == team_id)
    if invitee_membership_id is not None:
        query = query.where(
            AcceleratorTeamInvitation.invitee_membership_id == invitee_membership_id
        )
    rows = list((await db.execute(query.with_for_update())).scalars().all())
    for row in rows:
        row.status = "expired"
        row.responded_at = now
        add_audit(
            db,
            accelerator_id=cohort.accelerator_id,
            cohort_id=cohort.id,
            actor_user_id=actor_user_id,
            action="team.invitation_expired",
            target_type="team_invitation",
            target_id=row.id,
            details={"team_id": row.team_id},
        )
    if rows:
        await db.flush()
    return rows


async def active_member_count(db: AsyncSession, team_id: int) -> int:
    return int((await db.execute(select(func.count(AcceleratorTeamMember.id)).where(
        AcceleratorTeamMember.team_id == team_id,
        AcceleratorTeamMember.status == "active",
    ))).scalar_one() or 0)


async def pending_invitation_count(db: AsyncSession, team_id: int) -> int:
    return int((await db.execute(select(func.count(AcceleratorTeamInvitation.id)).where(
        AcceleratorTeamInvitation.team_id == team_id,
        AcceleratorTeamInvitation.status == "pending",
        AcceleratorTeamInvitation.expires_at > datetime.utcnow(),
    ))).scalar_one() or 0)


async def active_team_member(
    db: AsyncSession, membership_id: int, *, lock: bool = False
) -> AcceleratorTeamMember | None:
    query = select(AcceleratorTeamMember).where(
        AcceleratorTeamMember.membership_id == membership_id,
        AcceleratorTeamMember.status == "active",
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


async def queue_team_notification(
    db: AsyncSession,
    *,
    cohort: AcceleratorCohort,
    recipient: User,
    membership_id: int | None,
    event_type: str,
    subject: str,
    body: str,
    idempotency_key: str,
    metadata: dict,
) -> int:
    event = await enqueue_notification(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        recipient_user_id=recipient.id,
        recipient_email=recipient.email,
        event_type=event_type,
        subject=subject,
        body=body,
        action_url="/accelerator",
        membership_id=membership_id,
        event_metadata=metadata,
        idempotency_key=idempotency_key,
    )
    return event.id


async def find_team_for_membership(
    db: AsyncSession, membership_id: int
) -> AcceleratorTeam | None:
    active = (await db.execute(
        select(AcceleratorTeam)
        .join(AcceleratorTeamMember, AcceleratorTeamMember.team_id == AcceleratorTeam.id)
        .where(
            AcceleratorTeamMember.membership_id == membership_id,
            AcceleratorTeamMember.status == "active",
        )
        .order_by(AcceleratorTeam.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if active:
        return active
    owned = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.owner_membership_id == membership_id
    ).order_by(AcceleratorTeam.created_at.desc()).limit(1))).scalar_one_or_none()
    if owned:
        return owned
    return (await db.execute(
        select(AcceleratorTeam)
        .join(AcceleratorTeamMember, AcceleratorTeamMember.team_id == AcceleratorTeam.id)
        .where(AcceleratorTeamMember.membership_id == membership_id)
        .order_by(AcceleratorTeamMember.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()


async def invitation_dict(
    db: AsyncSession,
    invitation: AcceleratorTeamInvitation,
    *,
    viewer: User,
    access_role: str,
) -> dict:
    team = await db.get(AcceleratorTeam, invitation.team_id)
    project = await db.get(Project, team.project_id) if team and team.project_id else None
    invitee_membership = await db.get(
        AcceleratorMembership, invitation.invitee_membership_id
    )
    invitee = await db.get(User, invitee_membership.user_id) if invitee_membership else None
    inviter = await db.get(User, invitation.invited_by_user_id)
    cohort = await get_cohort(db, team.cohort_id) if team else None
    now = datetime.utcnow()
    effective_status = (
        "expired"
        if invitation.status == "pending" and invitation.expires_at <= now
        else invitation.status
    )
    owner = await owner_membership(db, team) if team else None
    can_respond = bool(
        effective_status == "pending"
        and invitee_membership
        and invitee_membership.user_id == viewer.id
        and invitee_membership.status == "enrolled"
        and team
        and team.status == "active"
        and cohort
        and cohort.status not in FROZEN_COHORT_STATUSES
    )
    can_cancel = bool(
        effective_status == "pending"
        and access_role == "resident"
        and owner
        and owner.user_id == viewer.id
        and owner.status == "enrolled"
        and team
        and team.status == "active"
        and cohort
        and cohort.status not in FROZEN_COHORT_STATUSES
    )
    invitee_data = {
        "membership_id": invitee_membership.id,
        "name": invitee.name,
    } if invitee_membership and invitee else {
        "membership_id": invitation.invitee_membership_id,
        "name": "Участник недоступен",
    }
    if invitee and (access_role == "manager" or invitee.id == viewer.id):
        invitee_data["email"] = invitee.email
    return {
        "id": invitation.id,
        "team_id": invitation.team_id,
        "status": effective_status,
        "message": invitation.message,
        "expires_at": invitation.expires_at,
        "created_at": invitation.created_at,
        "team": {
            "id": team.id,
            "name": team.name,
            "project": ({"id": project.id, "name": project.name} if project else None),
        } if team else {"id": invitation.team_id, "name": "Команда недоступна", "project": None},
        "invitee": invitee_data,
        "invited_by": {
            "id": inviter.id,
            "name": inviter.name,
            **({"email": inviter.email} if inviter and (access_role == "manager" or inviter.id == viewer.id) else {}),
        } if inviter else {"id": invitation.invited_by_user_id, "name": "Пользователь недоступен"},
        "counterpart_profile_id": invitation.source_match_profile_id,
        "can_respond": can_respond,
        "can_cancel": can_cancel,
    }


async def team_dict(
    db: AsyncSession,
    team: AcceleratorTeam,
    *,
    viewer: User,
    access_role: str,
) -> dict:
    cohort = await get_cohort(db, team.cohort_id)
    project = await db.get(Project, team.project_id) if team.project_id else None
    owner = await owner_membership(db, team)
    viewer_member = (await db.execute(
        select(AcceleratorTeamMember)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorTeamMember.membership_id,
        )
        .where(
            AcceleratorTeamMember.team_id == team.id,
            AcceleratorTeamMember.status == "active",
            AcceleratorMembership.user_id == viewer.id,
        )
        .limit(1)
    )).scalar_one_or_none()
    member_rows = (await db.execute(
        select(AcceleratorTeamMember, AcceleratorMembership, User)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorTeamMember.membership_id,
        )
        .join(User, User.id == AcceleratorMembership.user_id)
        .where(AcceleratorTeamMember.team_id == team.id)
        .order_by(AcceleratorTeamMember.joined_at, AcceleratorTeamMember.id)
    )).all()
    members = []
    for row, membership, person in member_rows:
        show_email = (
            access_role == "manager"
            or person.id == viewer.id
            or (
                access_role == "resident"
                and viewer_member is not None
                and row.status == "active"
                and row.share_contact
            )
        )
        members.append({
            "id": row.id,
            "membership_id": membership.id,
            "role": row.role,
            "title": row.title,
            "status": row.status,
            "share_contact": bool(row.share_contact),
            "person": {
                "id": person.id,
                "name": person.name,
                **({"email": person.email} if show_email and access_role != "tracker" else {}),
            },
        })
    viewer_is_owner = owner.user_id == viewer.id
    invitations = []
    if access_role == "manager" or (access_role == "resident" and viewer_is_owner):
        pending = (await db.execute(select(AcceleratorTeamInvitation).where(
            AcceleratorTeamInvitation.team_id == team.id,
            AcceleratorTeamInvitation.status == "pending",
            AcceleratorTeamInvitation.expires_at > datetime.utcnow(),
        ).order_by(AcceleratorTeamInvitation.created_at))).scalars().all()
        invitations = [
            await invitation_dict(db, row, viewer=viewer, access_role=access_role)
            for row in pending
        ]
    can_manage = bool(
        access_role == "resident"
        and owner.user_id == viewer.id
        and owner.status == "enrolled"
        and team.status == "active"
        and cohort.status not in FROZEN_COHORT_STATUSES
    )
    return {
        "id": team.id,
        "name": team.name,
        "status": team.status,
        "max_members": team.max_members,
        "owner_membership_id": team.owner_membership_id,
        "project": ({"id": project.id, "name": project.name} if project else None),
        "can_manage": can_manage,
        "members": members,
        "pending_invitations": invitations,
    }


def clean_name(value: str) -> str:
    value = " ".join(value.split())
    if len(value) < 2:
        raise HTTPException(status_code=422, detail="Название команды слишком короткое")
    return value


async def membership_team_payload(
    db: AsyncSession, *, membership_id: int, user: User
) -> dict:
    membership = await db.get(AcceleratorMembership, membership_id)
    if not membership or membership.role != "resident":
        raise HTTPException(status_code=404, detail="Участие не найдено")
    cohort = await get_cohort(db, membership.cohort_id)
    await require_teams_module(db, cohort)
    access_role = await membership_read_access(
        db, membership=membership, user=user, cohort=cohort
    )
    team = await find_team_for_membership(db, membership.id)
    invitations = []
    if access_role != "tracker":
        rows = (await db.execute(select(AcceleratorTeamInvitation).where(
            AcceleratorTeamInvitation.invitee_membership_id == membership.id,
            AcceleratorTeamInvitation.status == "pending",
            AcceleratorTeamInvitation.expires_at > datetime.utcnow(),
        ).order_by(AcceleratorTeamInvitation.created_at.desc()))).scalars().all()
        invitations = [
            await invitation_dict(db, row, viewer=user, access_role=access_role)
            for row in rows
        ]
    return {
        "team": (
            await team_dict(db, team, viewer=user, access_role=access_role)
            if team else None
        ),
        "invitations": invitations,
    }


async def membership_invitation_payload(
    db: AsyncSession, *, membership_id: int, user: User
) -> dict:
    payload = await membership_team_payload(
        db, membership_id=membership_id, user=user
    )
    return {"invitations": payload["invitations"]}


async def cohort_teams_payload(
    db: AsyncSession, *, cohort_id: int, user: User
) -> dict:
    cohort = await get_cohort(db, cohort_id)
    await require_teams_module(db, cohort)
    if not await is_manager(db, user, cohort):
        raise HTTPException(status_code=403, detail="Список команд доступен менеджеру потока")
    teams = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.cohort_id == cohort.id
    ).order_by(AcceleratorTeam.status, AcceleratorTeam.created_at))).scalars().all()
    return {
        "teams": [
            await team_dict(db, team, viewer=user, access_role="manager")
            for team in teams
        ]
    }


async def team_view_access(
    db: AsyncSession, *, team: AcceleratorTeam, user: User
) -> str:
    cohort = await get_cohort(db, team.cohort_id)
    owner = await owner_membership(db, team)
    if owner.user_id == user.id:
        return "resident"
    own_member = (await db.execute(
        select(AcceleratorTeamMember.id)
        .join(
            AcceleratorMembership,
            AcceleratorMembership.id == AcceleratorTeamMember.membership_id,
        )
        .where(
            AcceleratorTeamMember.team_id == team.id,
            AcceleratorTeamMember.status == "active",
            AcceleratorMembership.user_id == user.id,
        )
        .limit(1)
    )).scalar_one_or_none()
    if own_member is not None:
        return "resident"
    if await is_manager(db, user, cohort):
        return "manager"
    raise HTTPException(status_code=403, detail="Нет доступа к команде")


async def create_team(
    db: AsyncSession,
    *,
    membership_id: int,
    payload: AcceleratorTeamCreate,
    user: User,
) -> AcceleratorTeam:
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == membership_id
    ).with_for_update())).scalar_one_or_none()
    if (
        not membership
        or membership.user_id != user.id
        or membership.role != "resident"
        or membership.status != "enrolled"
    ):
        raise HTTPException(status_code=404, detail="Активное участие не найдено")
    cohort = await get_cohort(db, membership.cohort_id)
    await require_teams_module(db, cohort)
    if cohort.status in FROZEN_COHORT_STATUSES:
        raise HTTPException(status_code=409, detail="Состав завершённого потока заморожен")
    if not membership.project_id:
        raise HTTPException(
            status_code=409,
            detail="Создать команду может только резидент с проектом",
        )
    project = await db.get(Project, membership.project_id)
    if not project or project.user_id != membership.user_id:
        raise HTTPException(status_code=409, detail="Канонический проект резидента недоступен")
    if await active_team_member(db, membership.id, lock=True):
        raise HTTPException(status_code=409, detail="Резидент уже состоит в активной команде")
    existing = (await db.execute(select(AcceleratorTeam.id).where(or_(
        AcceleratorTeam.owner_membership_id == membership.id,
        (
            (AcceleratorTeam.cohort_id == cohort.id)
            & (AcceleratorTeam.project_id == project.id)
        ),
    )).limit(1))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Команда этого проекта уже существует")
    now = datetime.utcnow()
    team = AcceleratorTeam(
        cohort_id=cohort.id,
        project_id=project.id,
        owner_membership_id=membership.id,
        name=clean_name(payload.name),
        max_members=payload.max_members,
        status="active",
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(team)
    await db.flush()
    member = AcceleratorTeamMember(
        team_id=team.id,
        membership_id=membership.id,
        role="owner",
        status="active",
        joined_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(member)
    await db.flush()
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="team.created",
        target_type="team",
        target_id=team.id,
        details={"project_id": project.id, "max_members": team.max_members},
    )
    return team


async def create_team_invitation(
    db: AsyncSession,
    *,
    team_id: int,
    payload: AcceleratorTeamInvitationCreate,
    user: User,
) -> tuple[AcceleratorTeamInvitation, list[int]]:
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == team_id
    ).with_for_update())).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    owner = await require_owner(db, team=team, user=user, cohort=cohort)
    await expire_pending_invitations(
        db, cohort=cohort, actor_user_id=user.id, team_id=team.id
    )
    profile = (await db.execute(select(AcceleratorMatchProfile).where(
        AcceleratorMatchProfile.id == payload.counterpart_profile_id
    ).with_for_update())).scalar_one_or_none()
    if (
        not profile
        or profile.cohort_id != cohort.id
        or profile.role != "resident"
        or not profile.active
        or not profile.membership_id
    ):
        raise HTTPException(status_code=422, detail="Кандидат недоступен для этой команды")
    candidate = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == profile.membership_id
    ).with_for_update())).scalar_one_or_none()
    if (
        not candidate
        or candidate.cohort_id != cohort.id
        or candidate.role != "resident"
        or candidate.status != "enrolled"
    ):
        raise HTTPException(status_code=422, detail="Кандидат не зачислен в этот поток")
    if candidate.id == owner.id:
        raise HTTPException(status_code=409, detail="Нельзя пригласить самого себя")
    if candidate.project_id is not None:
        raise HTTPException(
            status_code=409,
            detail="В команду можно пригласить только участника без собственного проекта",
        )
    if await active_team_member(db, candidate.id, lock=True):
        raise HTTPException(status_code=409, detail="Кандидат уже состоит в активной команде")
    duplicate = (await db.execute(select(AcceleratorTeamInvitation.id).where(
        AcceleratorTeamInvitation.team_id == team.id,
        AcceleratorTeamInvitation.invitee_membership_id == candidate.id,
        AcceleratorTeamInvitation.status == "pending",
    ).limit(1))).scalar_one_or_none()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Кандидат уже приглашён в эту команду")
    used = await active_member_count(db, team.id) + await pending_invitation_count(
        db, team.id
    )
    if used >= team.max_members:
        raise HTTPException(status_code=409, detail="В команде нет свободных мест")
    now = datetime.utcnow()
    invitation = AcceleratorTeamInvitation(
        team_id=team.id,
        invitee_membership_id=candidate.id,
        source_match_profile_id=profile.id,
        invited_by_user_id=user.id,
        message=(payload.message.strip() or None) if payload.message else None,
        status="pending",
        expires_at=now + timedelta(days=INVITATION_TTL_DAYS),
        created_at=now,
        updated_at=now,
    )
    db.add(invitation)
    await db.flush()
    candidate_user = await db.get(User, candidate.user_id)
    notification_id = await queue_team_notification(
        db,
        cohort=cohort,
        recipient=candidate_user,
        membership_id=candidate.id,
        event_type="team_invitation_created",
        subject=f"Приглашение в команду «{team.name}»",
        body=(
            f"{user.name} приглашает вас присоединиться к команде «{team.name}»."
            + (f"\n\n{invitation.message}" if invitation.message else "")
        ),
        idempotency_key=f"team-invitation-created:{invitation.id}",
        metadata={"team_id": team.id, "invitation_id": invitation.id},
    )
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="team.invitation_created",
        target_type="team_invitation",
        target_id=invitation.id,
        details={
            "team_id": team.id,
            "invitee_membership_id": candidate.id,
            "source_match_profile_id": profile.id,
        },
    )
    return invitation, [notification_id]


async def _cancel_other_pending_invitations(
    db: AsyncSession,
    *,
    accepted: AcceleratorTeamInvitation,
    candidate: AcceleratorMembership,
    cohort: AcceleratorCohort,
    actor_user_id: int,
) -> list[int]:
    now = datetime.utcnow()
    rows = list((await db.execute(select(AcceleratorTeamInvitation).where(
        AcceleratorTeamInvitation.invitee_membership_id == candidate.id,
        AcceleratorTeamInvitation.status == "pending",
        AcceleratorTeamInvitation.id != accepted.id,
    ).with_for_update())).scalars().all())
    notification_ids: list[int] = []
    candidate_user = await db.get(User, candidate.user_id)
    for row in rows:
        row.status = "cancelled"
        row.responded_at = now
        other_team = await db.get(AcceleratorTeam, row.team_id)
        if not other_team:
            continue
        other_owner = await owner_membership(db, other_team)
        other_owner_user = await db.get(User, other_owner.user_id)
        notification_ids.append(await queue_team_notification(
            db,
            cohort=cohort,
            recipient=other_owner_user,
            membership_id=other_owner.id,
            event_type="team_invitation_responded",
            subject="Приглашение в команду закрыто",
            body=(
                f"{candidate_user.name} присоединился к другой команде; "
                f"приглашение в «{other_team.name}» отменено."
            ),
            idempotency_key=f"team-invitation-auto-cancelled:{row.id}",
            metadata={"team_id": other_team.id, "invitation_id": row.id},
        ))
        add_audit(
            db,
            accelerator_id=cohort.accelerator_id,
            cohort_id=cohort.id,
            actor_user_id=actor_user_id,
            action="team.invitation_auto_cancelled",
            target_type="team_invitation",
            target_id=row.id,
            details={"accepted_invitation_id": accepted.id},
        )
    return notification_ids


async def respond_team_invitation(
    db: AsyncSession,
    *,
    invitation_id: int,
    status: str,
    user: User,
) -> tuple[AcceleratorTeamInvitation, list[int]]:
    invitation = (await db.execute(select(AcceleratorTeamInvitation).where(
        AcceleratorTeamInvitation.id == invitation_id
    ).with_for_update())).scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == invitation.team_id
    ).with_for_update())).scalar_one_or_none()
    candidate = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == invitation.invitee_membership_id
    ).with_for_update())).scalar_one_or_none()
    if not team or not candidate or candidate.user_id != user.id:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    ensure_team_mutable(team, cohort)
    if candidate.status != "enrolled" or candidate.role != "resident":
        raise HTTPException(status_code=409, detail="Участие кандидата не активно")
    if invitation.status != "pending":
        raise HTTPException(status_code=409, detail="Приглашение уже обработано")
    if invitation.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=409, detail="Срок приглашения истёк")
    if status not in ("accepted", "declined"):
        raise HTTPException(status_code=422, detail="Недопустимый ответ на приглашение")
    now = datetime.utcnow()
    notification_ids: list[int] = []
    if status == "accepted":
        if candidate.project_id is not None:
            raise HTTPException(
                status_code=409,
                detail="Участник уже связан с собственным проектом",
            )
        profile = await db.get(AcceleratorMatchProfile, invitation.source_match_profile_id)
        if (
            not profile
            or not profile.active
            or profile.role != "resident"
            or profile.cohort_id != cohort.id
            or profile.membership_id != candidate.id
        ):
            raise HTTPException(status_code=409, detail="Профиль кандидата больше не активен")
        if await active_team_member(db, candidate.id, lock=True):
            raise HTTPException(status_code=409, detail="Участник уже состоит в другой команде")
        await expire_pending_invitations(
            db,
            cohort=cohort,
            actor_user_id=user.id,
            team_id=team.id,
        )
        active_count = await active_member_count(db, team.id)
        pending_count = await pending_invitation_count(db, team.id)
        if active_count >= team.max_members or active_count + pending_count > team.max_members:
            raise HTTPException(status_code=409, detail="В команде больше нет свободного места")
        db.add(AcceleratorTeamMember(
            team_id=team.id,
            membership_id=candidate.id,
            role="member",
            status="active",
            joined_at=now,
            created_at=now,
            updated_at=now,
        ))
        invitation.status = "accepted"
        invitation.responded_at = now
        notification_ids.extend(await _cancel_other_pending_invitations(
            db,
            accepted=invitation,
            candidate=candidate,
            cohort=cohort,
            actor_user_id=user.id,
        ))
    else:
        invitation.status = "declined"
        invitation.responded_at = now
    await db.flush()
    owner = await owner_membership(db, team)
    owner_user = await db.get(User, owner.user_id)
    notification_ids.append(await queue_team_notification(
        db,
        cohort=cohort,
        recipient=owner_user,
        membership_id=owner.id,
        event_type="team_invitation_responded",
        subject="Ответ на приглашение в команду",
        body=(
            f"{user.name} {'принял' if status == 'accepted' else 'отклонил'} "
            f"приглашение в команду «{team.name}»."
        ),
        idempotency_key=f"team-invitation-responded:{invitation.id}:{status}",
        metadata={
            "team_id": team.id,
            "invitation_id": invitation.id,
            "status": status,
        },
    ))
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="team.invitation_responded",
        target_type="team_invitation",
        target_id=invitation.id,
        details={"team_id": team.id, "status": status},
    )
    return invitation, notification_ids


async def cancel_team_invitation(
    db: AsyncSession,
    *,
    invitation_id: int,
    user: User,
) -> tuple[AcceleratorTeamInvitation, list[int]]:
    invitation = (await db.execute(select(AcceleratorTeamInvitation).where(
        AcceleratorTeamInvitation.id == invitation_id
    ).with_for_update())).scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == invitation.team_id
    ).with_for_update())).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    await require_owner(db, team=team, user=user, cohort=cohort)
    if invitation.status != "pending" or invitation.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=409, detail="Приглашение уже недоступно")
    invitation.status = "cancelled"
    invitation.responded_at = datetime.utcnow()
    candidate = await db.get(AcceleratorMembership, invitation.invitee_membership_id)
    candidate_user = await db.get(User, candidate.user_id) if candidate else None
    notification_ids = []
    if candidate and candidate_user:
        notification_ids.append(await queue_team_notification(
            db,
            cohort=cohort,
            recipient=candidate_user,
            membership_id=candidate.id,
            event_type="team_invitation_removed",
            subject="Приглашение в команду отозвано",
            body=f"Приглашение в команду «{team.name}» было отозвано.",
            idempotency_key=f"team-invitation-removed:{invitation.id}",
            metadata={"team_id": team.id, "invitation_id": invitation.id},
        ))
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="team.invitation_cancelled",
        target_type="team_invitation",
        target_id=invitation.id,
        details={"team_id": team.id},
    )
    return invitation, notification_ids


async def archive_team_rows(
    db: AsyncSession,
    *,
    team: AcceleratorTeam,
    cohort: AcceleratorCohort,
    actor_user_id: int | None,
    reason: str | None,
    audit_action: str,
) -> list[int]:
    now = datetime.utcnow()
    members = list((await db.execute(select(AcceleratorTeamMember).where(
        AcceleratorTeamMember.team_id == team.id,
        AcceleratorTeamMember.status == "active",
    ).with_for_update())).scalars().all())
    for member in members:
        member.status = "left"
        member.left_at = now
    invitations = list((await db.execute(select(AcceleratorTeamInvitation).where(
        AcceleratorTeamInvitation.team_id == team.id,
        AcceleratorTeamInvitation.status == "pending",
    ).with_for_update())).scalars().all())
    notification_ids: list[int] = []
    for member in members:
        membership = await db.get(AcceleratorMembership, member.membership_id)
        person = await db.get(User, membership.user_id) if membership else None
        if not membership or not person or person.id == actor_user_id:
            continue
        notification_ids.append(await queue_team_notification(
            db,
            cohort=cohort,
            recipient=person,
            membership_id=membership.id,
            event_type="team_archived",
            subject=f"Команда «{team.name}» архивирована",
            body="Состав команды переведён в режим истории и больше не изменяется.",
            idempotency_key=f"team-archived:{team.id}:{member.id}",
            metadata={"team_id": team.id, "team_member_id": member.id},
        ))
    for invitation in invitations:
        invitation.status = "cancelled"
        invitation.responded_at = now
        candidate = await db.get(
            AcceleratorMembership, invitation.invitee_membership_id
        )
        candidate_user = await db.get(User, candidate.user_id) if candidate else None
        if candidate and candidate_user:
            notification_ids.append(await queue_team_notification(
                db,
                cohort=cohort,
                recipient=candidate_user,
                membership_id=candidate.id,
                event_type="team_invitation_removed",
                subject="Приглашение в команду закрыто",
                body=f"Команда «{team.name}» архивирована; приглашение отменено.",
                idempotency_key=f"team-invitation-removed:{invitation.id}",
                metadata={"team_id": team.id, "invitation_id": invitation.id},
            ))
    team.status = "archived"
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=actor_user_id,
        action=audit_action,
        target_type="team",
        target_id=team.id,
        details={
            "reason": reason,
            "left_member_ids": [row.id for row in members],
            "cancelled_invitation_ids": [row.id for row in invitations],
        },
    )
    return notification_ids


async def update_team(
    db: AsyncSession,
    *,
    team_id: int,
    payload: AcceleratorTeamUpdate,
    user: User,
) -> tuple[AcceleratorTeam, list[int]]:
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == team_id
    ).with_for_update())).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    ensure_team_mutable(team, cohort)
    manager = await is_manager(db, user, cohort)
    owner = await owner_membership(db, team, lock=True)
    owner_actor = owner.user_id == user.id
    if not manager and not owner_actor:
        raise HTTPException(status_code=403, detail="Нет прав на изменение команды")
    if owner_actor and owner.status != "enrolled":
        raise HTTPException(status_code=409, detail="Участие владельца команды не активно")
    fields = payload.model_fields_set
    if manager and not owner_actor and ({"name", "max_members"} & fields):
        raise HTTPException(
            status_code=403,
            detail="Менеджер может только принудительно архивировать команду",
        )
    notification_ids: list[int] = []
    if "name" in fields and payload.name is not None:
        team.name = clean_name(payload.name)
    if "max_members" in fields and payload.max_members is not None:
        await expire_pending_invitations(
            db, cohort=cohort, actor_user_id=user.id, team_id=team.id
        )
        used = await active_member_count(db, team.id) + await pending_invitation_count(
            db, team.id
        )
        if payload.max_members < used:
            raise HTTPException(
                status_code=409,
                detail=f"Сейчас занято или зарезервировано мест: {used}",
            )
        team.max_members = payload.max_members
    if payload.status == "archived":
        notification_ids.extend(await archive_team_rows(
            db,
            team=team,
            cohort=cohort,
            actor_user_id=user.id,
            reason=(payload.reason.strip() or None) if payload.reason else None,
            audit_action="team.force_archived" if manager and not owner_actor else "team.archived",
        ))
    else:
        add_audit(
            db,
            accelerator_id=cohort.accelerator_id,
            cohort_id=cohort.id,
            actor_user_id=user.id,
            action="team.updated",
            target_type="team",
            target_id=team.id,
            details={
                "name": team.name,
                "max_members": team.max_members,
            },
        )
    await db.flush()
    return team, notification_ids


async def update_team_member(
    db: AsyncSession,
    *,
    member_id: int,
    payload: AcceleratorTeamMemberUpdate,
    user: User,
) -> AcceleratorTeam:
    member = (await db.execute(select(AcceleratorTeamMember).where(
        AcceleratorTeamMember.id == member_id
    ).with_for_update())).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Участник команды не найден")
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == member.team_id
    ).with_for_update())).scalar_one_or_none()
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    await require_owner(db, team=team, user=user, cohort=cohort)
    if member.status != "active":
        raise HTTPException(status_code=409, detail="Участник уже покинул команду")
    if member.membership_id == team.owner_membership_id or member.role == "owner":
        raise HTTPException(status_code=409, detail="Роль владельца команды неизменяема")
    fields = payload.model_fields_set
    if "role" in fields and payload.role is not None:
        member.role = payload.role
    if "title" in fields:
        member.title = (payload.title.strip() or None) if payload.title else None
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="team.member_updated",
        target_type="team_member",
        target_id=member.id,
        details={"team_id": team.id, "role": member.role, "title": member.title},
    )
    await db.flush()
    return team


async def update_team_member_contact(
    db: AsyncSession,
    *,
    member_id: int,
    payload: AcceleratorTeamContactUpdate,
    user: User,
) -> AcceleratorTeam:
    member = (await db.execute(select(AcceleratorTeamMember).where(
        AcceleratorTeamMember.id == member_id
    ).with_for_update())).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Участник команды не найден")
    membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == member.membership_id
    ).with_for_update())).scalar_one_or_none()
    if not membership or membership.user_id != user.id:
        raise HTTPException(status_code=404, detail="Участник команды не найден")
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == member.team_id
    ).with_for_update())).scalar_one_or_none()
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    ensure_team_mutable(team, cohort)
    if membership.status != "enrolled" or member.status != "active":
        raise HTTPException(status_code=409, detail="Участие в команде не активно")
    member.share_contact = payload.share_contact
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action="team.member_contact_updated",
        target_type="team_member",
        target_id=member.id,
        details={"team_id": team.id, "share_contact": member.share_contact},
    )
    await db.flush()
    return team


async def remove_team_member(
    db: AsyncSession,
    *,
    member_id: int,
    user: User,
) -> tuple[AcceleratorTeam, list[int]]:
    member = (await db.execute(select(AcceleratorTeamMember).where(
        AcceleratorTeamMember.id == member_id
    ).with_for_update())).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Участник команды не найден")
    team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.id == member.team_id
    ).with_for_update())).scalar_one_or_none()
    cohort = await get_cohort(db, team.cohort_id)
    await require_teams_module(db, cohort)
    ensure_team_mutable(team, cohort)
    target_membership = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == member.membership_id
    ).with_for_update())).scalar_one_or_none()
    owner = await owner_membership(db, team, lock=True)
    owner_actor = owner.user_id == user.id
    self_actor = target_membership and target_membership.user_id == user.id
    if not owner_actor and not self_actor:
        raise HTTPException(status_code=403, detail="Нет прав на изменение состава команды")
    actor_membership = owner if owner_actor else target_membership
    if actor_membership.status != "enrolled":
        raise HTTPException(status_code=409, detail="Участие в потоке не активно")
    if member.status != "active":
        raise HTTPException(status_code=409, detail="Участник уже покинул команду")
    if member.membership_id == team.owner_membership_id or member.role == "owner":
        raise HTTPException(
            status_code=409,
            detail="Владелец не может покинуть команду; архивируйте её",
        )
    member.status = "left"
    member.left_at = datetime.utcnow()
    notification_ids: list[int] = []
    action = "team.member_removed" if owner_actor else "team.member_left"
    if owner_actor and target_membership:
        target_user = await db.get(User, target_membership.user_id)
        notification_ids.append(await queue_team_notification(
            db,
            cohort=cohort,
            recipient=target_user,
            membership_id=target_membership.id,
            event_type="team_member_removed",
            subject=f"Изменение состава команды «{team.name}»",
            body=f"Вы больше не состоите в команде «{team.name}».",
            idempotency_key=f"team-member-removed:{member.id}",
            metadata={"team_id": team.id, "team_member_id": member.id},
        ))
    elif self_actor:
        owner_user = await db.get(User, owner.user_id)
        if owner_user and owner_user.id != user.id:
            notification_ids.append(await queue_team_notification(
                db,
                cohort=cohort,
                recipient=owner_user,
                membership_id=owner.id,
                event_type="team_member_left",
                subject=f"Участник покинул команду «{team.name}»",
                body=f"{user.name} покинул команду «{team.name}».",
                idempotency_key=f"team-member-left:{member.id}",
                metadata={"team_id": team.id, "team_member_id": member.id},
            ))
    add_audit(
        db,
        accelerator_id=cohort.accelerator_id,
        cohort_id=cohort.id,
        actor_user_id=user.id,
        action=action,
        target_type="team_member",
        target_id=member.id,
        details={"team_id": team.id, "membership_id": member.membership_id},
    )
    await db.flush()
    return team, notification_ids


async def handle_membership_lifecycle_transition(
    db: AsyncSession,
    *,
    membership: AcceleratorMembership,
    to_status: str,
    actor_user_id: int | None,
    reason: str | None = None,
) -> list[int]:
    """Apply withdrawal cleanup in the caller's membership transaction.

    Completion intentionally does nothing: the team remains a read-only
    snapshot. Suspension also preserves composition but blocks user mutations.
    """
    if to_status != "withdrawn":
        return []
    cohort = await get_cohort(db, membership.cohort_id)
    notification_ids: list[int] = []
    owned_team = (await db.execute(select(AcceleratorTeam).where(
        AcceleratorTeam.owner_membership_id == membership.id,
        AcceleratorTeam.status == "active",
    ).with_for_update())).scalar_one_or_none()
    if owned_team:
        notification_ids.extend(await archive_team_rows(
            db,
            team=owned_team,
            cohort=cohort,
            actor_user_id=actor_user_id,
            reason=reason,
            audit_action="team.archived_by_owner_withdrawal",
        ))
    else:
        withdrawn_user = await db.get(User, membership.user_id)
        rows = list((await db.execute(select(AcceleratorTeamMember).where(
            AcceleratorTeamMember.membership_id == membership.id,
            AcceleratorTeamMember.status == "active",
        ).with_for_update())).scalars().all())
        now = datetime.utcnow()
        for row in rows:
            row.status = "left"
            row.left_at = now
            team = await db.get(AcceleratorTeam, row.team_id)
            if team:
                owner = await owner_membership(db, team)
                owner_user = await db.get(User, owner.user_id)
                if owner_user and withdrawn_user and owner_user.id != withdrawn_user.id:
                    notification_ids.append(await queue_team_notification(
                        db,
                        cohort=cohort,
                        recipient=owner_user,
                        membership_id=owner.id,
                        event_type="team_member_left",
                        subject=f"Участник покинул команду «{team.name}»",
                        body=(
                            f"{withdrawn_user.name} выбыл из потока и больше не состоит "
                            f"в команде «{team.name}»."
                        ),
                        idempotency_key=f"team-member-withdrawn:{row.id}",
                        metadata={"team_id": team.id, "team_member_id": row.id},
                    ))
                add_audit(
                    db,
                    accelerator_id=cohort.accelerator_id,
                    cohort_id=cohort.id,
                    actor_user_id=actor_user_id,
                    action="team.member_left_by_withdrawal",
                    target_type="team_member",
                    target_id=row.id,
                    details={"team_id": team.id, "reason": reason},
                )

    now = datetime.utcnow()
    invitations = list((await db.execute(select(AcceleratorTeamInvitation).where(
        AcceleratorTeamInvitation.invitee_membership_id == membership.id,
        AcceleratorTeamInvitation.status == "pending",
    ).with_for_update())).scalars().all())
    withdrawn_user = await db.get(User, membership.user_id)
    for invitation in invitations:
        invitation.status = "cancelled"
        invitation.responded_at = now
        team = await db.get(AcceleratorTeam, invitation.team_id)
        if not team:
            continue
        owner = await owner_membership(db, team)
        owner_user = await db.get(User, owner.user_id)
        notification_ids.append(await queue_team_notification(
            db,
            cohort=cohort,
            recipient=owner_user,
            membership_id=owner.id,
            event_type="team_invitation_responded",
            subject="Приглашение в команду закрыто",
            body=(
                f"{withdrawn_user.name} больше не участвует в потоке; "
                f"приглашение в «{team.name}» отменено."
            ),
            idempotency_key=f"team-invitation-withdrawn:{invitation.id}",
            metadata={"team_id": team.id, "invitation_id": invitation.id},
        ))
        add_audit(
            db,
            accelerator_id=cohort.accelerator_id,
            cohort_id=cohort.id,
            actor_user_id=actor_user_id,
            action="team.invitation_cancelled_by_withdrawal",
            target_type="team_invitation",
            target_id=invitation.id,
            details={"team_id": team.id, "reason": reason},
        )
    if owned_team or invitations:
        await db.flush()
    return notification_ids
