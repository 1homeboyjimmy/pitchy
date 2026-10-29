"""Consent-bound team transitions. The caller owns the transaction and commit."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import delete, select

from models import (AcceleratorMembership, AcceleratorTeam, AcceleratorTeamMember,
                    AcceleratorTeamInvitation, AcceleratorTeamApplication,
                    AcceleratorTeamTrackerAssignment, AcceleratorTrackerAssignment, User)
from accelerator_service import add_audit


async def transfer_state(db, membership_id):
    from accelerator_team_service import active_team_member, active_member_count
    member = await active_team_member(db, membership_id)
    if not member:
        return None
    team = await db.get(AcceleratorTeam, member.team_id)
    owner = team.owner_membership_id == membership_id
    allowed = not owner or await active_member_count(db, team.id) == 1
    return {"team_id": team.id, "team_name": team.name, "member_id": member.id,
            "action": "archive" if owner else "leave", "allowed": allowed,
            "reason": None if allowed else "Сначала передайте капитанство другому участнику команды."}


async def capture_transfer_consent(db, membership_id, target_team_id, consent=False, expected_team_id=None):
    state = await transfer_state(db, membership_id)
    if not state:
        return None
    if state['team_id'] == target_team_id:
        raise HTTPException(409, "Вы уже состоите в этой команде")
    if not state['allowed']:
        raise HTTPException(409, state['reason'])
    if not consent or expected_team_id != state['team_id']:
        raise HTTPException(409, "Для перехода подтвердите выход из текущей команды.")
    return {"team_id": state['team_id'], "team_name": state['team_name'],
            "member_id": state['member_id'], "action": state['action'],
            "consented_at": datetime.utcnow().isoformat()}


async def lock_join_context(db, membership_id, target_team_id):
    """Take team locks in ID order before locking requests and participation."""
    from accelerator_team_service import active_team_member
    active = await active_team_member(db, membership_id)
    ids = sorted({target_team_id} | ({active.team_id} if active else set()))
    teams = (await db.execute(select(AcceleratorTeam).where(AcceleratorTeam.id.in_(ids))
                             .order_by(AcceleratorTeam.id).with_for_update()
                             .execution_options(populate_existing=True))).scalars().all()
    target = next((team for team in teams if team.id == target_team_id), None)
    if not target:
        raise HTTPException(404, "Команда не найдена")
    candidate = (await db.execute(select(AcceleratorMembership).where(
        AcceleratorMembership.id == membership_id).with_for_update()
        .execution_options(populate_existing=True))).scalar_one_or_none()
    if not candidate:
        raise HTTPException(404, "Участие не найдено")
    current = await active_team_member(db, membership_id)
    if current and current.team_id not in ids:
        raise HTTPException(409, "Текущая команда изменилась. Обновите страницу и подтвердите переход заново.")
    return candidate, target


async def ensure_join_capacity(db, team, membership_id):
    from accelerator_team_service import active_member_count
    reservations = (await db.execute(select(AcceleratorTeamInvitation.id).where(
        AcceleratorTeamInvitation.team_id == team.id,
        AcceleratorTeamInvitation.status == 'pending',
        AcceleratorTeamInvitation.expires_at > datetime.utcnow(),
        AcceleratorTeamInvitation.invitee_membership_id != membership_id))).scalars().all()
    if await active_member_count(db, team.id) + len(reservations) >= team.max_members:
        raise HTTPException(409, "В команде нет свободных мест: часть мест может быть зарезервирована приглашениями.")


async def complete_team_join(db, *, candidate, target, cohort, actor_user_id,
                             transfer_context=None, application_id=None, invitation_id=None,
                             title=None):
    from accelerator_team_service import (active_team_member, archive_team_rows,
        ensure_team_mutable, _cancel_other_pending_invitations, queue_team_notification)
    ensure_team_mutable(target, cohort)
    if candidate.cohort_id != target.cohort_id or candidate.role != 'resident' or candidate.status != 'enrolled':
        raise HTTPException(409, "Участие кандидата не активно в этом потоке")
    await ensure_join_capacity(db, target, candidate.id)
    active = await active_team_member(db, candidate.id)
    state = await transfer_state(db, candidate.id)
    if active:
        if active.team_id == target.id:
            raise HTTPException(409, "Участник уже состоит в этой команде")
        if not transfer_context or any(state[k] != transfer_context.get(k) for k in ('team_id', 'member_id', 'action')):
            raise HTTPException(409, "Текущая команда изменилась или переход не подтверждён. Отправьте заявку заново.")
        if not state['allowed']:
            raise HTTPException(409, "Состав команды изменился. Сначала передайте капитанство другому участнику.")
    async with db.begin_nested():
        notifications = []
        now = datetime.utcnow()
        if active:
            old = await db.get(AcceleratorTeam, active.team_id)
            if old.cohort_id != cohort.id:
                raise HTTPException(409, "Текущая команда относится к другому потоку. Обратитесь к организатору.")
            ensure_team_mutable(old, cohort)
            if state['action'] == 'archive':
                notifications.extend(await archive_team_rows(db, team=old, cohort=cohort,
                    actor_user_id=actor_user_id, reason="Переход единственного участника в другую команду",
                    audit_action="team.archived_on_transfer"))
            else:
                active.status = 'left'
                active.left_at = now
                owner = await db.get(AcceleratorMembership, old.owner_membership_id)
                person = await db.get(User, owner.user_id)
                notifications.append(await queue_team_notification(db, cohort=cohort, recipient=person,
                    membership_id=owner.id, event_type='team_member_removed', subject='Участник перешёл в другую команду',
                    body='Участник покинул вашу команду после подтверждения перехода.',
                    idempotency_key=f'team-member-transferred:{active.id}',
                    metadata={'team_id': old.id, 'team_member_id': active.id}))
            add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
                actor_user_id=actor_user_id, action='team.member_transferred', target_type='membership', target_id=candidate.id,
                details={'from_team_id':old.id,'to_team_id':target.id,'consent':transfer_context})
            # Release the partial unique index on active membership before INSERT.
            await db.flush()
        db.add(AcceleratorTeamMember(team_id=target.id, membership_id=candidate.id, role='member',
            title=title, status='active', share_contact=False, joined_at=now))
        candidate.project_id = target.project_id
        tracker = (await db.execute(select(AcceleratorTeamTrackerAssignment.id).where(
            AcceleratorTeamTrackerAssignment.team_id == target.id))).scalar_one_or_none()
        if tracker is not None:
            await db.execute(delete(AcceleratorTrackerAssignment).where(AcceleratorTrackerAssignment.membership_id == candidate.id))
        applications = (await db.execute(select(AcceleratorTeamApplication).where(
            AcceleratorTeamApplication.membership_id == candidate.id,
            AcceleratorTeamApplication.status == 'pending',
            AcceleratorTeamApplication.id != application_id if application_id else True).with_for_update())).scalars().all()
        for row in applications:
            row.status = 'cancelled'
            row.responded_at = now
            row.responded_by_user_id = actor_user_id
        notifications.extend(await _cancel_other_pending_invitations(db, accepted_invitation_id=invitation_id,
            candidate=candidate, cohort=cohort, actor_user_id=actor_user_id, accepted_application_id=application_id))
        await db.flush()
        return notifications
