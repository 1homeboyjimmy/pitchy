"""Project-scoped work and version-scoped attribution, independent of today's team."""

from datetime import datetime
from types import SimpleNamespace
from fastapi import HTTPException
from sqlalchemy import select
from models import (
    AcceleratorHomeworkAssignment as Assignment,
    AcceleratorHomeworkSubmission as Submission,
    AcceleratorHomeworkAttempt as Attempt,
    AcceleratorHomeworkParticipant as Participant,
    AcceleratorHomeworkException as ExceptionRule,
    AcceleratorHomeworkTarget as Target,
    AcceleratorMembership as Membership,
    AcceleratorTeam as Team,
    AcceleratorTeamMember as TeamMember,
    User,
    Project,
)


async def exception_rule(db, assignment_id, membership_id):
    return (
        await db.execute(
            select(ExceptionRule).where(
                ExceptionRule.assignment_id == assignment_id,
                ExceptionRule.membership_id == membership_id,
            )
        )
    ).scalar_one_or_none()


async def effective_due_at(db, assignment, membership_id):
    rule = await exception_rule(db, assignment.id, membership_id)
    return rule.due_at if rule and rule.due_at else assignment.due_at


async def submission_context(db, assignment, membership, *, lock=False):
    team = (
        await db.execute(
            select(Team)
            .join(TeamMember, TeamMember.team_id == Team.id)
            .where(
                TeamMember.membership_id == membership.id,
                TeamMember.status == "active",
                Team.status == "active",
                Team.cohort_id == assignment.cohort_id,
            )
        )
    ).scalar_one_or_none()
    if lock:
        if team:
            team = (
                await db.execute(
                    select(Team)
                    .where(Team.id == team.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one()
            if team.status != "active":
                raise HTTPException(409, "Команда изменилась. Обновите задание.")
        membership = (
            await db.execute(
                select(Membership)
                .where(Membership.id == membership.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        active_id = (
            await db.execute(
                select(TeamMember.team_id).where(
                    TeamMember.membership_id == membership.id,
                    TeamMember.status == "active",
                )
            )
        ).scalar_one_or_none()
        if active_id != (team.id if team else None):
            raise HTTPException(409, "Команда изменилась. Обновите задание.")
        assignment = (
            await db.execute(
                select(Assignment)
                .where(Assignment.id == assignment.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
    rule = await exception_rule(db, assignment.id, membership.id)
    team = (
        team
        if assignment.submission_mode == "team" and not (rule and rule.allow_individual)
        else None
    )
    project_id = team.project_id if team else membership.project_id
    project = await db.get(Project, project_id) if project_id else None
    ids = [membership.id]
    if team:
        ids = list(
            (
                await db.execute(
                    select(Membership.id)
                    .join(TeamMember, TeamMember.membership_id == Membership.id)
                    .join(User, User.id == Membership.user_id)
                    .where(
                        TeamMember.team_id == team.id,
                        TeamMember.status == "active",
                        Membership.cohort_id == assignment.cohort_id,
                        Membership.role == "resident",
                        Membership.status == "enrolled",
                        User.is_active.is_(True),
                        User.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )
        excluded = set(
            (
                await db.execute(
                    select(ExceptionRule.membership_id).where(
                        ExceptionRule.assignment_id == assignment.id,
                        ExceptionRule.allow_individual.is_(True),
                    )
                )
            ).scalars()
        )
        ids = [mid for mid in ids if mid not in excluded]
    if assignment.audience == "selected":
        targets = set(
            (
                await db.execute(
                    select(Target.membership_id).where(
                        Target.assignment_id == assignment.id
                    )
                )
            ).scalars()
        )
        ids = [mid for mid in ids if mid in targets]
    people = (
        await db.execute(
            select(Membership.id, User.id.label("user_id"), User.name)
            .join(User, User.id == Membership.user_id)
            .where(Membership.id.in_(ids))
            .order_by(Membership.id)
        )
    ).all()
    context = {
        "team_id": team.id if team else None,
        "team_name": team.name if team else None,
        "project_id": project_id,
        "project_name": project.name if project else None,
        "submitted_by_user_id": membership.user_id,
        "members": [
            {"membership_id": mid, "user_id": uid, "name": name}
            for mid, uid, name in people
        ],
    }
    reason = None
    if assignment.status != "published" or membership.status != "enrolled":
        reason = "Задание недоступно для отправки."
    elif membership.id not in ids:
        reason = "Задание вам не назначено."
    elif assignment.require_project and not project_id:
        reason = "Для этого задания выберите проект. Создавать команду не требуется."
    elif len(ids) < assignment.min_participants and not (
        rule and rule.allow_individual
    ):
        reason = f"Для этого задания нужны исполнители: {assignment.min_participants}. Обратитесь к организатору за индивидуальным вариантом."
    return context, reason


async def scoped_submission(db, assignment, membership, context, *, lock=False):
    scope = (
        Submission.team_id == context["team_id"]
        if context["team_id"]
        else (
            (Submission.team_id.is_(None)) & (Submission.membership_id == membership.id)
        )
    )
    query = select(Submission).where(Submission.assignment_id == assignment.id, scope)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await db.execute(query)).scalar_one_or_none()


def attempt_status(attempt, submission):
    if attempt.review_status:
        return attempt.review_status
    if attempt.attempt_number == submission.attempt_count:
        return submission.status
    return "accepted" if attempt.passed else "submitted"


async def participant_results(db, membership_ids, assignment_ids):
    """Accepted historic versions survive transfers and later team revisions."""
    rows = (
        await db.execute(
            select(Participant.membership_id, Attempt, Submission)
            .join(Attempt, Attempt.id == Participant.attempt_id)
            .join(Submission, Submission.id == Attempt.submission_id)
            .where(
                Participant.membership_id.in_(membership_ids),
                Submission.assignment_id.in_(assignment_ids),
            )
            .order_by(Attempt.created_at.desc(), Attempt.id.desc())
        )
    ).all()
    result = {}
    for mid, a, s in rows:
        status = attempt_status(a, s)
        key = (s.assignment_id, mid)
        if key in result and (result[key].status == "accepted" or status != "accepted"):
            continue
        data = {c.name: getattr(s, c.name) for c in Submission.__table__.columns}
        data.update(
            {
                k: getattr(a, k)
                for k in [
                    "answer_text",
                    "attachments",
                    "quiz_answers",
                    "score",
                    "passed",
                    "review_comment",
                    "reviewed_by_user_id",
                    "reviewed_at",
                    "context",
                ]
            }
        )
        data.update(
            status=status,
            attempt_count=a.attempt_number,
            submitted_at=a.created_at,
            attempt_id=a.id,
        )
        result[key] = SimpleNamespace(**data)
    return result


async def attribution_ids(db, submission_id, attempt_number=None):
    query = (
        select(Participant.membership_id)
        .join(Attempt, Attempt.id == Participant.attempt_id)
        .where(Attempt.submission_id == submission_id)
    )
    if attempt_number is not None:
        query = query.where(Attempt.attempt_number == attempt_number)
    return set((await db.execute(query)).scalars())


async def readable_attempts(db, submission, user):
    rows = list(
        (
            await db.execute(
                select(Attempt)
                .where(Attempt.submission_id == submission.id)
                .order_by(Attempt.attempt_number.desc())
            )
        ).scalars()
    )
    current = (
        (
            await db.execute(
                select(TeamMember.id)
                .join(Membership, Membership.id == TeamMember.membership_id)
                .join(Team, Team.id == TeamMember.team_id)
                .where(
                    TeamMember.team_id == submission.team_id,
                    TeamMember.status == "active",
                    Team.status == "active",
                    Membership.user_id == user.id,
                    Membership.role == "resident",
                    Membership.status == "enrolled",
                )
            )
        ).first()
        if submission.team_id
        else None
    )
    if current:
        return rows
    ids = set(
        (
            await db.execute(
                select(Participant.attempt_id)
                .join(Membership, Membership.id == Participant.membership_id)
                .where(
                    Membership.user_id == user.id,
                    Participant.attempt_id.in_([a.id for a in rows]),
                )
            )
        ).scalars()
    )
    return [a for a in rows if a.id in ids]
