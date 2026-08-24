from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
import uuid

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select

from db_async import AsyncSessionLocal
from models import (
    AcceleratorAuditLog,
    AcceleratorMatchProfile,
    AcceleratorMembership,
    AcceleratorNotificationOutbox,
    AcceleratorTeam,
    AcceleratorTeamInvitation,
    AcceleratorTeamMember,
    AcceleratorTrackerAssignment,
    Project,
    User,
)
from projects_router import delete_project
from routers.accelerator_teams import (
    answer_team_invitation,
    create_membership_team,
    get_membership_team,
    invite_team_member,
    list_cohort_teams,
    patch_team_member,
    patch_team_member_contact,
)
from routers.accelerators import (
    accept_application,
    assign_organizer,
    create_accelerator,
    create_cohort,
    enroll_application,
    submit_application,
    update_cohort_status,
    update_membership_status,
    update_program_config,
    upsert_resident_match_profile,
)
from schemas.accelerator_teams import (
    AcceleratorTeamContactUpdate,
    AcceleratorTeamCreate,
    AcceleratorTeamInvitationCreate,
    AcceleratorTeamInvitationUpdate,
    AcceleratorTeamMemberUpdate,
    AcceleratorTeamUpdate,
)
from schemas.accelerators import (
    AcceleratorCreate,
    ApplicationCreate,
    ApplicationReview,
    CohortCreate,
    MatchProfileData,
    MembershipStatusUpdate,
    OrganizerAssign,
    ProgramConfigUpdate,
    StatusUpdate,
)


@dataclass
class ResidentContext:
    user: User
    membership_id: int
    project_id: int | None
    profile_id: int | None = None


async def _enroll_resident(
    db,
    *,
    cohort_id: int,
    manager: User,
    resident: User,
    with_project: bool,
) -> ResidentContext:
    application = await submit_application(
        cohort_id,
        ApplicationCreate(
            form_payload={"project_name": f"Project {resident.name}"}
            if with_project
            else {"motivation": f"Participant application {resident.name}"},
            application_type="project" if with_project else "participant",
            accept_privacy=True,
            accept_program_rules=True,
        ),
        resident,
        db,
    )
    accepted = await accept_application(
        application["id"],
        ApplicationReview(),
        BackgroundTasks(),
        manager,
        db,
    )
    await enroll_application(application["id"], manager, db)
    return ResidentContext(
        user=resident,
        membership_id=accepted["membership_id"],
        project_id=accepted["project_id"],
    )


async def _add_resident_match_profile(
    db,
    resident: ResidentContext,
) -> int:
    result = await upsert_resident_match_profile(
        resident.membership_id,
        MatchProfileData(
            bio=f"Profile {resident.user.name}",
            expertise=["product"],
            needs=["sales"],
            industries=["SaaS"],
            goals=["growth"],
            preferred_formats=["online"],
            max_matches=10,
        ),
        resident.user,
        db,
    )
    resident.profile_id = result["id"]
    return result["id"]


async def _create_cohort_context(db, suffix: str):
    admin = User(
        email=f"team-admin-{suffix}@example.test",
        name="Team admin",
        is_admin=True,
    )
    organizer = User(
        email=f"team-organizer-{suffix}@example.test",
        name="Team organizer",
    )
    db.add_all([admin, organizer])
    await db.commit()
    accelerator = await create_accelerator(
        AcceleratorCreate(name=f"Team accelerator {suffix}"), admin, db
    )
    await assign_organizer(
        accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
    )
    cohort = await create_cohort(
        accelerator["id"],
        CohortCreate(name=f"Team cohort {suffix}"),
        organizer,
        db,
    )
    await update_program_config(
        cohort["id"],
        ProgramConfigUpdate(version=1, modules={"matchmaking": True}),
        organizer,
        db,
    )
    await update_cohort_status(
        cohort["id"], StatusUpdate(status="accepting"), organizer, db
    )
    return admin, organizer, accelerator, cohort


def _status(error: pytest.ExceptionInfo[HTTPException]) -> int:
    return error.value.status_code


@pytest.mark.asyncio
async def test_team_invitation_contact_privacy_tracker_scope_and_withdrawal_cleanup():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        owner_user = User(email=f"owner-{suffix}@example.test", name="Owner")
        candidate_user = User(email=f"candidate-{suffix}@example.test", name="Candidate")
        tracker = User(email=f"tracker-{suffix}@example.test", name="Tracker")
        expert = User(email=f"expert-{suffix}@example.test", name="Expert")
        db.add_all([owner_user, candidate_user, tracker, expert])
        await db.commit()

        owner = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=owner_user, with_project=True,
        )
        candidate = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=candidate_user, with_project=False,
        )
        await _add_resident_match_profile(db, candidate)

        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Core team", max_members=3),
            owner_user,
            db,
        )
        invitation = await invite_team_member(
            team["id"],
            AcceleratorTeamInvitationCreate(
                counterpart_profile_id=candidate.profile_id,
                message="Join us",
            ),
            BackgroundTasks(),
            owner_user,
            db,
        )
        assert invitation["status"] == "pending"
        assert invitation["invitee"].get("email") is None

        candidate_view = await get_membership_team(
            candidate.membership_id, candidate_user, db
        )
        assert candidate_view["team"] is None
        assert candidate_view["invitations"][0]["can_respond"] is True
        assert candidate_view["invitations"][0]["invitee"]["email"] == candidate_user.email

        accepted = await answer_team_invitation(
            invitation["id"],
            AcceleratorTeamInvitationUpdate(status="accepted"),
            BackgroundTasks(),
            candidate_user,
            db,
        )
        assert accepted["status"] == "accepted"

        owner_view = await get_membership_team(owner.membership_id, owner_user, db)
        candidate_member = next(
            row for row in owner_view["team"]["members"]
            if row["membership_id"] == candidate.membership_id
        )
        assert candidate_member["person"].get("email") is None

        await patch_team_member_contact(
            candidate_member["id"],
            AcceleratorTeamContactUpdate(share_contact=True),
            candidate_user,
            db,
        )
        owner_view = await get_membership_team(owner.membership_id, owner_user, db)
        shared_candidate = next(
            row for row in owner_view["team"]["members"]
            if row["membership_id"] == candidate.membership_id
        )
        assert shared_candidate["person"]["email"] == candidate_user.email

        db.add(AcceleratorTrackerAssignment(
            tracker_user_id=tracker.id,
            membership_id=candidate.membership_id,
            assigned_by_user_id=organizer.id,
        ))
        await db.commit()
        tracker_view = await get_membership_team(candidate.membership_id, tracker, db)
        assert tracker_view["invitations"] == []
        assert all(
            member["person"].get("email") is None
            for member in tracker_view["team"]["members"]
        )
        with pytest.raises(HTTPException) as denied:
            await get_membership_team(candidate.membership_id, expert, db)
        assert _status(denied) == 403

        owner_member = next(
            row for row in owner_view["team"]["members"]
            if row["membership_id"] == owner.membership_id
        )
        with pytest.raises(HTTPException) as immutable_owner:
            await patch_team_member(
                owner_member["id"],
                AcceleratorTeamMemberUpdate(role="cofounder"),
                owner_user,
                db,
            )
        assert _status(immutable_owner) == 409
        with pytest.raises(HTTPException) as project_guard:
            await delete_project(owner.project_id, owner_user, db)
        assert _status(project_guard) == 409
        await update_membership_status(
            candidate.membership_id,
            MembershipStatusUpdate(status="withdrawn", reason="Leaves cohort"),
            organizer,
            db,
        )
        member_row = (await db.execute(select(AcceleratorTeamMember).where(
            AcceleratorTeamMember.id == candidate_member["id"]
        ))).scalar_one()
        assert member_row.status == "left"
        assert (await db.execute(select(func.count(AcceleratorNotificationOutbox.id)).where(
            AcceleratorNotificationOutbox.idempotency_key
            == f"team-member-withdrawn:{candidate_member['id']}"
        ))).scalar_one() == 1


@pytest.mark.asyncio
async def test_team_candidate_boundaries_capacity_decline_and_expiration():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        users = [
            User(email=f"owner2-{suffix}@example.test", name="Owner two"),
            User(email=f"candidate-a-{suffix}@example.test", name="Candidate A"),
            User(email=f"candidate-b-{suffix}@example.test", name="Candidate B"),
            User(email=f"project-candidate-{suffix}@example.test", name="Project candidate"),
        ]
        db.add_all(users)
        await db.commit()
        owner = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=users[0], with_project=True,
        )
        candidate_a = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=users[1], with_project=False,
        )
        candidate_b = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=users[2], with_project=False,
        )
        project_candidate = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=users[3], with_project=True,
        )
        for resident in (candidate_a, candidate_b, project_candidate):
            await _add_resident_match_profile(db, resident)

        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Capacity team", max_members=2),
            users[0],
            db,
        )
        with pytest.raises(HTTPException) as has_project:
            await invite_team_member(
                team["id"],
                AcceleratorTeamInvitationCreate(
                    counterpart_profile_id=project_candidate.profile_id
                ),
                BackgroundTasks(), users[0], db,
            )
        assert _status(has_project) == 409
        first = await invite_team_member(
            team["id"],
            AcceleratorTeamInvitationCreate(counterpart_profile_id=candidate_a.profile_id),
            BackgroundTasks(), users[0], db,
        )
        with pytest.raises(HTTPException) as full:
            await invite_team_member(
                team["id"],
                AcceleratorTeamInvitationCreate(counterpart_profile_id=candidate_b.profile_id),
                BackgroundTasks(), users[0], db,
            )
        assert _status(full) == 409
        declined = await answer_team_invitation(
            first["id"],
            AcceleratorTeamInvitationUpdate(status="declined"),
            BackgroundTasks(), users[1], db,
        )
        assert declined["status"] == "declined"
        second = await invite_team_member(
            team["id"],
            AcceleratorTeamInvitationCreate(counterpart_profile_id=candidate_b.profile_id),
            BackgroundTasks(), users[0], db,
        )
        row = await db.get(AcceleratorTeamInvitation, second["id"])
        row.expires_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()
        with pytest.raises(HTTPException) as expired:
            await answer_team_invitation(
                second["id"],
                AcceleratorTeamInvitationUpdate(status="accepted"),
                BackgroundTasks(), users[2], db,
            )
        assert _status(expired) == 409
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=2, modules={"matchmaking": False}),
            organizer,
            db,
        )
        with pytest.raises(HTTPException) as module_off:
            await get_membership_team(owner.membership_id, users[0], db)
        assert _status(module_off) == 409


@pytest.mark.asyncio
async def test_owner_withdrawal_archives_team_and_cancels_pending_invitations():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        owner_user = User(email=f"owner3-{suffix}@example.test", name="Owner three")
        candidate_user = User(email=f"candidate3-{suffix}@example.test", name="Candidate three")
        db.add_all([owner_user, candidate_user])
        await db.commit()
        owner = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=owner_user, with_project=True,
        )
        candidate = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=candidate_user, with_project=False,
        )
        await _add_resident_match_profile(db, candidate)
        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Archived team", max_members=3),
            owner_user,
            db,
        )
        invitation = await invite_team_member(
            team["id"],
            AcceleratorTeamInvitationCreate(counterpart_profile_id=candidate.profile_id),
            BackgroundTasks(), owner_user, db,
        )

        await update_membership_status(
            owner.membership_id,
            MembershipStatusUpdate(status="withdrawn", reason="Owner leaves"),
            organizer,
            db,
        )
        team_row = await db.get(AcceleratorTeam, team["id"])
        invitation_row = await db.get(AcceleratorTeamInvitation, invitation["id"])
        owner_member = (await db.execute(select(AcceleratorTeamMember).where(
            AcceleratorTeamMember.team_id == team["id"],
            AcceleratorTeamMember.membership_id == owner.membership_id,
        ))).scalar_one()
        assert team_row.status == "archived"
        assert invitation_row.status == "cancelled"
        assert owner_member.status == "left"

        manager_view = await list_cohort_teams(cohort["id"], organizer, db)
        archived = next(row for row in manager_view["teams"] if row["id"] == team["id"])
        assert archived["status"] == "archived"
        assert archived["can_manage"] is False
