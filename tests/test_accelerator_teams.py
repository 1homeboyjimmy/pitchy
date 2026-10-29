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
    AcceleratorStaff,
    AcceleratorTeam,
    AcceleratorTeamApplication,
    AcceleratorTeamInvitation,
    AcceleratorTeamMember,
    AcceleratorTeamTrackerAssignment,
    AcceleratorTrackerAssignment,
    Project,
    User,
)
from projects_router import delete_project
from accelerator_project_selection import project_options, select_project
from accelerator_team_service import active_team_member
from routers.accelerator_teams import (
    assign_team_tracker,
    answer_team_invitation,
    create_membership_team,
    create_team_application,
    get_team_pool,
    get_membership_team,
    invite_team_member,
    list_cohort_teams,
    patch_team,
    put_team_project,
    patch_team_member,
    patch_team_member_contact,
    delete_team_member,
    tracker_work_queue,
    transfer_team_captain,
    respond_team_application,
)
from routers.accelerators import (
    accept_application,
    assign_organizer,
    create_accelerator,
    create_cohort,
    enroll_application,
    submit_application,
    assign_tracker,
    update_cohort_status,
    update_membership_status,
    update_program_config,
    upsert_resident_match_profile,
    create_homework_assignment,
    publish_homework_assignment,
    submit_homework,
    review_homework_submission,
    homework_review_queue,
)
from schemas.accelerator_teams import (
    AcceleratorTeamContactUpdate,
    AcceleratorTeamCreate,
    AcceleratorTeamProjectAttach,
    AcceleratorTeamApplicationCreate,
    AcceleratorTeamApplicationUpdate,
    AcceleratorTeamCaptainTransfer,
    AcceleratorTeamInvitationCreate,
    AcceleratorTeamInvitationUpdate,
    AcceleratorTeamMemberUpdate,
    AcceleratorTeamTrackerAssign,
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
    TrackerAssign,
    HomeworkAssignmentCreate,
    HomeworkSubmissionUpsert,
    HomeworkReview,
)


@pytest.mark.asyncio
async def test_team_join_application_conflicts_and_acceptance_preserve_project_and_privacy():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        people = [User(email=f'application-{key}-{suffix}@example.test', name=key)
                  for key in ('owner', 'other-owner', 'applicant')]
        db.add_all(people)
        await db.commit()
        owner, other, applicant = [await _enroll_resident(
            db, cohort_id=cohort['id'], manager=organizer, resident=person,
            with_project=index == 0,
        ) for index, person in enumerate(people)]
        first = await create_membership_team(owner.membership_id, AcceleratorTeamCreate(name='First'), owner.user, db)
        second = await create_membership_team(other.membership_id, AcceleratorTeamCreate(name='Second'), other.user, db)
        application = await create_team_application(first['id'], AcceleratorTeamApplicationCreate(desired_role='Sales'), applicant.user, db)
        for team_id in (first['id'], second['id']):
            with pytest.raises(HTTPException) as error:
                await create_team_application(team_id, AcceleratorTeamApplicationCreate(), applicant.user, db)
            assert error.value.status_code == 409
        await respond_team_application(application['id'], AcceleratorTeamApplicationUpdate(status='accepted'), owner.user, db)
        membership = await db.get(AcceleratorMembership, applicant.membership_id)
        assert membership.project_id == owner.project_id
        view = await get_membership_team(owner.membership_id, owner.user, db)
        member = next(row for row in view['team']['members'] if row['membership_id'] == applicant.membership_id)
        assert member['share_contact'] is False
        assert member['person'].get('email') is None
        await patch_team_member_contact(member['id'], AcceleratorTeamContactUpdate(share_contact=True), applicant.user, db)
        view = await get_membership_team(owner.membership_id, owner.user, db)
        assert next(row for row in view['team']['members'] if row['membership_id'] == applicant.membership_id)['person']['email'] == applicant.user.email
        # Projects accepted from a normal application do not necessarily have a tree.
        await transfer_team_captain(first['id'], AcceleratorTeamCaptainTransfer(membership_id=applicant.membership_id), owner.user, db)
        project = await db.get(Project, owner.project_id)
        assert project.user_id == applicant.user.id


@pytest.mark.asyncio
@pytest.mark.parametrize('with_team_project', [False, True])
async def test_team_join_application_preserves_personal_project_and_rejects_inactive_applicant(with_team_project):
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        people = [User(email=f'eligibility-{key}-{suffix}@example.test', name=key)
                  for key in ('owner', 'project-owner', 'applicant')]
        db.add_all(people)
        await db.commit()
        owner, project_owner, applicant = [await _enroll_resident(
            db, cohort_id=cohort['id'], manager=organizer, resident=person,
            with_project=index == 1 or (index == 0 and with_team_project),
        ) for index, person in enumerate(people)]
        team = await create_membership_team(owner.membership_id, AcceleratorTeamCreate(name='Recruiting'), owner.user, db)
        personal = await db.get(Project, project_owner.project_id)
        personal.passport = {'core': {'problem': 'Keep this personal project'}}
        await db.commit()
        own_application = await create_team_application(team['id'], AcceleratorTeamApplicationCreate(), project_owner.user, db)
        await respond_team_application(own_application['id'], AcceleratorTeamApplicationUpdate(status='accepted'), owner.user, db)
        assert (await db.get(AcceleratorMembership, project_owner.membership_id)).project_id == owner.project_id
        options = await project_options(db, project_owner.membership_id, project_owner.user)
        assert options['selection_locked'] and options['team']['id'] == team['id']
        with pytest.raises(HTTPException) as cannot_replace_team_project:
            await select_project(db, project_owner.membership_id, project_owner.user, personal.id)
        assert cannot_replace_team_project.value.status_code == 409
        if owner.project_id:
            assert (await select_project(db, project_owner.membership_id, project_owner.user, owner.project_id))['project_id'] == owner.project_id
        await db.refresh(personal)
        assert personal.user_id == project_owner.user.id
        assert personal.passport == {'core': {'problem': 'Keep this personal project'}}
        application = await create_team_application(team['id'], AcceleratorTeamApplicationCreate(), applicant.user, db)
        await update_membership_status(applicant.membership_id, MembershipStatusUpdate(status='suspended', reason='Test suspension'), organizer, db)
        with pytest.raises(HTTPException) as error:
            await respond_team_application(application['id'], AcceleratorTeamApplicationUpdate(status='accepted'), owner.user, db)
        assert error.value.status_code == 409


@dataclass
class ResidentContext:
    user: User
    membership_id: int
    project_id: int | None
    profile_id: int | None = None


@pytest.mark.asyncio
@pytest.mark.parametrize('with_team_project', [False, True])
async def test_direct_residents_can_be_found_and_join_by_invitation_without_losing_projects(with_team_project):
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        people = [User(username=f'{key}_{suffix}', name=key, is_active=True)
                  for key in ('captain', 'personal', 'placeholder', 'no_project', 'blocked')]
        db.add_all(people)
        await db.flush()
        residents = []
        for person in people:
            membership = AcceleratorMembership(cohort_id=cohort['id'], user_id=person.id,
                                              application_id=None, role='resident', status='enrolled',
                                              accepted_by_user_id=organizer.id)
            db.add(membership)
            residents.append(membership)
        captain, personal, placeholder, no_project, blocked = residents
        personal_project = Project(user_id=people[1].id, name='Private idea',
                                   passport={'core': {'solution': 'Personal research'}})
        placeholder_project = Project(user_id=people[2].id, name='Будущий проект',
                                      passport={'_meta': {}, '_import': {'batch_key': 'test'}})
        db.add_all([personal_project, placeholder_project])
        await db.flush()
        personal.project_id = personal_project.id
        placeholder.project_id = placeholder_project.id
        people[4].is_active = False
        if with_team_project:
            team_project = Project(user_id=people[0].id, name='Team idea', passport={})
            db.add(team_project)
            await db.flush()
            captain.project_id = team_project.id
        await db.commit()
        team = await create_membership_team(captain.id, AcceleratorTeamCreate(name='Forming team'), people[0], db)
        pool = await get_team_pool(captain.id, people[0], db)
        assert {r['membership_id'] for r in pool['candidates']} == {personal.id, placeholder.id, no_project.id}
        assert next(r for r in pool['candidates'] if r['membership_id'] == personal.id)['telegram'] == '@' + people[1].username
        invitation = await invite_team_member(team['id'], AcceleratorTeamInvitationCreate(membership_id=personal.id),
                                             BackgroundTasks(), people[0], db)
        await answer_team_invitation(invitation['id'], AcceleratorTeamInvitationUpdate(status='accepted'),
                                     BackgroundTasks(), people[1], db)
        await db.refresh(personal)
        assert personal.project_id == (team['project']['id'] if with_team_project else None)
        await db.refresh(personal_project)
        assert personal_project.user_id == people[1].id
        assert personal_project.passport == {'core': {'solution': 'Personal research'}}
        options = await project_options(db, personal.id, people[1])
        assert options['selection_locked'] is True
        assert options['team']['project_id'] == personal.project_id
        with pytest.raises(HTTPException) as cannot_select_personal:
            await select_project(db, personal.id, people[1], personal_project.id)
        assert cannot_select_personal.value.status_code == 409
        pool = await get_team_pool(captain.id, people[0], db)
        assert personal.id not in {r['membership_id'] for r in pool['candidates']}
        with pytest.raises(HTTPException) as already_joined:
            await create_team_application(team['id'], AcceleratorTeamApplicationCreate(), people[1], db)
        assert already_joined.value.status_code == 409

        renamed = await patch_team(team['id'], AcceleratorTeamUpdate(name='Renamed forming team'),
                                   BackgroundTasks(), people[0], db)
        assert renamed['name'] == 'Renamed forming team'
        with pytest.raises(HTTPException) as not_captain:
            await patch_team(team['id'], AcceleratorTeamUpdate(name='Not allowed'),
                             BackgroundTasks(), people[1], db)
        assert not_captain.value.status_code == 403
        own_view = await get_membership_team(personal.id, people[1], db)
        own_member = next(r for r in own_view['team']['members'] if r['membership_id'] == personal.id)
        await delete_team_member(own_member['id'], BackgroundTasks(), people[1], db)
        assert (await project_options(db, personal.id, people[1]))['selection_locked'] is False
        assert (await select_project(db, personal.id, people[1], personal_project.id))['project_id'] == personal_project.id


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
    await enroll_application(application["id"], resident, db)
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
        admin,
        db,
    )
    await update_cohort_status(
        cohort["id"], StatusUpdate(status="accepting"), organizer, db
    )
    return admin, organizer, accelerator, cohort


def _status(error: pytest.ExceptionInfo[HTTPException]) -> int:
    return error.value.status_code


@pytest.mark.asyncio
async def test_resident_without_project_creates_team_and_attaches_project_later():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        admin, organizer, _, cohort = await _create_cohort_context(db, suffix)
        owner_user = User(email=f"forming-owner-{suffix}@example.test", name="Forming owner")
        member_user = User(email=f"forming-member-{suffix}@example.test", name="Forming member")
        db.add_all([owner_user, member_user])
        await db.commit()
        owner = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=owner_user, with_project=False,
        )
        member = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=member_user, with_project=False,
        )
        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Idea team", max_members=4),
            owner_user,
            db,
        )
        assert team["project"] is None
        assert team["project_state"] == "project_pending"
        assert team["can_attach_project"] is True

        invitation = await invite_team_member(
            team["id"],
            AcceleratorTeamInvitationCreate(membership_id=member.membership_id),
            BackgroundTasks(), owner_user, db,
        )
        await answer_team_invitation(
            invitation["id"],
            AcceleratorTeamInvitationUpdate(status="accepted"),
            BackgroundTasks(), member_user, db,
        )

        project = Project(user_id=owner_user.id, name="Project after lessons", passport={})
        db.add(project)
        await db.commit()
        attached = await put_team_project(
            team["id"],
            AcceleratorTeamProjectAttach(project_id=project.id),
            owner_user,
            db,
        )
        assert attached["project"] == {"id": project.id, "name": project.name}
        assert attached["project_state"] == "active"
        assert attached["can_attach_project"] is False
        membership = await db.get(AcceleratorMembership, owner.membership_id)
        assert membership.project_id == project.id
        member_membership = await db.get(AcceleratorMembership, member.membership_id)
        assert member_membership.project_id == project.id


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
                membership_id=candidate.membership_id,
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

        await assign_team_tracker(
            team["id"],
            AcceleratorTeamTrackerAssign(tracker_user_id=tracker.id),
            organizer,
            db,
        )
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
        admin, organizer, _, cohort = await _create_cohort_context(db, suffix)
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
        # A personal project does not prevent an invitation or reserve a second
        # active team. Declining it keeps this capacity scenario independent.
        own_project_invitation = await invite_team_member(
            team["id"], AcceleratorTeamInvitationCreate(counterpart_profile_id=project_candidate.profile_id),
            BackgroundTasks(), users[0], db,
        )
        await answer_team_invitation(
            own_project_invitation["id"], AcceleratorTeamInvitationUpdate(status="declined"),
            BackgroundTasks(), users[3], db,
        )
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
            admin,
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


@pytest.mark.asyncio
async def test_archived_team_does_not_block_new_team_for_same_owner_and_project():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        owner_user = User(
            email=f"archive-restart-{suffix}@example.test", name="Archive restart"
        )
        db.add(owner_user)
        await db.commit()
        owner = await _enroll_resident(
            db,
            cohort_id=cohort["id"],
            manager=organizer,
            resident=owner_user,
            with_project=True,
        )
        first = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="First team", max_members=3),
            owner_user,
            db,
        )

        with pytest.raises(HTTPException) as error:
            await patch_team(
                first["id"], AcceleratorTeamUpdate(status="archived"),
                BackgroundTasks(), owner_user, db,
            )
        assert error.value.status_code == 403

        await patch_team(
            first["id"],
            AcceleratorTeamUpdate(status="archived", reason="Start over"),
            BackgroundTasks(),
            organizer,
            db,
        )

        payload = await get_membership_team(owner.membership_id, owner_user, db)
        assert payload["team"] is None
        assert payload["can_create"] is True

        second = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Second team", max_members=5),
            owner_user,
            db,
        )
        assert second["id"] != first["id"]
        assert second["status"] == "active"
        assert second["project"]["id"] == first["project"]["id"]


@pytest.mark.asyncio
async def test_team_tracker_replaces_legacy_personal_assignments_and_grants_scope():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        admin, organizer, accelerator, cohort = await _create_cohort_context(db, suffix)
        owner_user = User(email=f"tracker-owner-{suffix}@example.test", name="Tracker owner")
        member_user = User(email=f"tracker-member-{suffix}@example.test", name="Tracker member")
        old_tracker_a = User(email=f"old-tracker-a-{suffix}@example.test", name="Old tracker A")
        old_tracker_b = User(email=f"old-tracker-b-{suffix}@example.test", name="Old tracker B")
        team_tracker = User(email=f"team-tracker-{suffix}@example.test", name="Team tracker")
        db.add_all([owner_user, member_user, old_tracker_a, old_tracker_b, team_tracker])
        await db.commit()

        owner = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=owner_user, with_project=True,
        )
        member = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=member_user, with_project=False,
        )
        await _add_resident_match_profile(db, member)
        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Tracked team", max_members=3),
            owner_user,
            db,
        )
        invitation = await invite_team_member(
            team["id"],
            AcceleratorTeamInvitationCreate(counterpart_profile_id=member.profile_id),
            BackgroundTasks(), owner_user, db,
        )
        await answer_team_invitation(
            invitation["id"],
            AcceleratorTeamInvitationUpdate(status="accepted"),
            BackgroundTasks(), member_user, db,
        )

        db.add_all([
            AcceleratorStaff(
                accelerator_id=accelerator["id"], user_id=old_tracker_a.id,
                role="tracker", created_by_user_id=organizer.id,
            ),
            AcceleratorStaff(
                accelerator_id=accelerator["id"], user_id=old_tracker_b.id,
                role="tracker", created_by_user_id=organizer.id,
            ),
            AcceleratorTrackerAssignment(
                tracker_user_id=old_tracker_a.id,
                membership_id=owner.membership_id,
                assigned_by_user_id=organizer.id,
            ),
            AcceleratorTrackerAssignment(
                tracker_user_id=old_tracker_b.id,
                membership_id=member.membership_id,
                assigned_by_user_id=organizer.id,
            ),
        ])
        await db.commit()

        queue = await tracker_work_queue(cohort["id"], organizer, db)
        conflict = next(row for row in queue["teams"] if row["team_id"] == team["id"])
        assert conflict["issue"] == "conflict"
        assert {row["id"] for row in conflict["personal_trackers"]} == {
            old_tracker_a.id, old_tracker_b.id,
        }

        assigned = await assign_team_tracker(
            team["id"],
            AcceleratorTeamTrackerAssign(tracker_user_id=team_tracker.id),
            organizer,
            db,
        )
        assert assigned["tracker"]["id"] == team_tracker.id
        assert (await db.execute(select(func.count(AcceleratorTrackerAssignment.id)).where(
            AcceleratorTrackerAssignment.membership_id.in_(
                [owner.membership_id, member.membership_id]
            )
        ))).scalar_one() == 0
        team_assignment = (await db.execute(select(AcceleratorTeamTrackerAssignment).where(
            AcceleratorTeamTrackerAssignment.team_id == team["id"]
        ))).scalar_one()
        assert team_assignment.tracker_user_id == team_tracker.id

        tracker_view = await get_membership_team(member.membership_id, team_tracker, db)
        assert tracker_view["team"]["tracker"]["id"] == team_tracker.id
        queue = await tracker_work_queue(cohort["id"], organizer, db)
        assert all(row["team_id"] != team["id"] for row in queue["teams"])

        with pytest.raises(HTTPException) as team_member_personal_tracker:
            await assign_tracker(
                cohort["id"],
                TrackerAssign(
                    user_id=old_tracker_a.id,
                    membership_ids=[member.membership_id],
                ),
                organizer,
                db,
            )
        assert _status(team_member_personal_tracker) == 422

        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(
                version=2, modules={"matchmaking": True, "homework": True}
            ),
            admin,
            db,
        )
        team_homework = await create_homework_assignment(
            cohort["id"],
            HomeworkAssignmentCreate(
                title="Team answer",
                description="Submit one shared answer",
                submission_mode="team",
            ),
            organizer,
            db,
        )
        await publish_homework_assignment(
            team_homework["id"], BackgroundTasks(), organizer, db
        )
        submission = await submit_homework(
            team_homework["id"],
            HomeworkSubmissionUpsert(answer_text="Shared team result"),
            BackgroundTasks(),
            member_user,
            db,
        )
        assert submission["team_id"] == team["id"]
        tracker_queue = await homework_review_queue(
            cohort["id"], None, None, None, team["id"], team_tracker.id,
            "review_pending", team_tracker, db,
        )
        assert [row["id"] for row in tracker_queue["items"]] == [submission["id"]]
        await review_homework_submission(
            submission["id"], HomeworkReview(status="accepted"),
            BackgroundTasks(), team_tracker, db,
        )
        with pytest.raises(HTTPException) as former_tracker_cannot_review_team:
            await review_homework_submission(
                submission["id"],
                HomeworkReview(status="needs_revision", comment="No access"),
                BackgroundTasks(), old_tracker_a, db,
            )
        assert _status(former_tracker_cannot_review_team) == 403


@pytest.mark.asyncio
async def test_captain_must_transfer_and_owner_cannot_leave_team():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, cohort = await _create_cohort_context(db, suffix)
        owner_user = User(email=f"captain-owner-{suffix}@example.test", name="Captain owner")
        member_user = User(email=f"captain-member-{suffix}@example.test", name="Captain member")
        applicant_user = User(email=f"captain-applicant-{suffix}@example.test", name="Team applicant")
        db.add_all([owner_user, member_user, applicant_user])
        await db.commit()
        owner = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=owner_user, with_project=True,
        )
        member = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=member_user, with_project=False,
        )
        applicant = await _enroll_resident(
            db, cohort_id=cohort["id"], manager=organizer,
            resident=applicant_user, with_project=False,
        )
        await _add_resident_match_profile(db, member)
        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Captain transfer team", max_members=4),
            owner_user,
            db,
        )
        invitation = await invite_team_member(
            team["id"],
            AcceleratorTeamInvitationCreate(counterpart_profile_id=member.profile_id),
            BackgroundTasks(), owner_user, db,
        )
        await answer_team_invitation(
            invitation["id"],
            AcceleratorTeamInvitationUpdate(status="accepted"),
            BackgroundTasks(), member_user, db,
        )
        owner_view = await get_membership_team(owner.membership_id, owner_user, db)
        owner_member = next(
            row for row in owner_view["team"]["members"]
            if row["membership_id"] == owner.membership_id
        )
        with pytest.raises(HTTPException) as captain_leave:
            await delete_team_member(
                owner_member["id"], BackgroundTasks(), owner_user, db
            )
        assert _status(captain_leave) == 409

        await transfer_team_captain(
            team["id"],
            AcceleratorTeamCaptainTransfer(membership_id=member.membership_id),
            owner_user,
            db,
        )
        await delete_team_member(
            owner_member["id"], BackgroundTasks(), owner_user, db
        )
        member_view = await get_membership_team(member.membership_id, member_user, db)
        assert member_view["team"]["owner_membership_id"] == member.membership_id
        assert sum(
            row["status"] == "active" for row in member_view["team"]["members"]
        ) == 1

        application = await create_team_application(
            team["id"],
            AcceleratorTeamApplicationCreate(message="Let me join"),
            applicant_user,
            db,
        )
        sole_captain = next(
            row for row in member_view["team"]["members"]
            if row["membership_id"] == member.membership_id
        )
        with pytest.raises(HTTPException) as owner_cannot_leave:
            await delete_team_member(
                sole_captain["id"], BackgroundTasks(), member_user, db
            )
        assert _status(owner_cannot_leave) == 409
        stored_application = await db.get(AcceleratorTeamApplication, application["id"])
        assert stored_application.status == "pending"


async def _transfer_fixture(db, *, member=False):
    suffix = uuid.uuid4().hex[:10]
    _, organizer, _, cohort = await _create_cohort_context(db, suffix)
    people = [User(email=f'transfer-{i}-{suffix}@example.test', name=f'Transfer {i}') for i in range(4)]
    db.add_all(people)
    await db.commit()
    residents = [await _enroll_resident(db, cohort_id=cohort['id'], manager=organizer,
        resident=u, with_project=i < 3) for i,u in enumerate(people)]
    old = await create_membership_team(residents[0].membership_id, AcceleratorTeamCreate(name='Source', max_members=5), people[0], db)
    target = await create_membership_team(residents[1].membership_id, AcceleratorTeamCreate(name='Destination', max_members=5), people[1], db)
    if member:
        app = await create_team_application(old['id'], AcceleratorTeamApplicationCreate(), people[2], db)
        await respond_team_application(app['id'], AcceleratorTeamApplicationUpdate(status='accepted'), people[0], db)
    return residents, old, target


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ['application', 'invitation'])
@pytest.mark.parametrize('member', [False, True])
async def test_team_transfer_is_deferred_consented_and_preserves_personal_projects(method, member):
    from project_access import get_accessible_project
    async with AsyncSessionLocal() as db:
        residents, old, target = await _transfer_fixture(db, member=member)
        candidate = residents[2] if member else residents[0]
        user = candidate.user
        source_project = (await db.get(AcceleratorMembership, candidate.membership_id)).project_id
        personal = await db.get(Project, candidate.project_id)
        personal.passport = {'core': {'problem': 'Preserve my research'}}
        await db.commit()
        incoming = await create_team_application(old['id'], AcceleratorTeamApplicationCreate(), residents[3].user, db)
        invitation = await invite_team_member(old['id'], AcceleratorTeamInvitationCreate(membership_id=residents[3].membership_id),
                                              BackgroundTasks(), residents[0].user, db)
        before = await get_membership_team(candidate.membership_id, user, db)
        assert before['transfer']['allowed']
        assert before['transfer']['action'] == ('leave' if member else 'archive')
        if method == 'application':
            with pytest.raises(HTTPException) as consent_missing:
                await create_team_application(target['id'], AcceleratorTeamApplicationCreate(), user, db)
            assert consent_missing.value.status_code == 409
            pending = await create_team_application(target['id'], AcceleratorTeamApplicationCreate(
                leave_current_team=True, expected_current_team_id=old['id']), user, db)
            stored = await db.get(AcceleratorTeamApplication, pending['id'])
            assert stored.transfer_context['team_id'] == old['id']
        else:
            pending = await invite_team_member(target['id'], AcceleratorTeamInvitationCreate(membership_id=candidate.membership_id),
                                              BackgroundTasks(), residents[1].user, db)
            with pytest.raises(HTTPException) as consent_missing:
                await answer_team_invitation(pending['id'], AcceleratorTeamInvitationUpdate(status='accepted'), BackgroundTasks(), user, db)
            assert consent_missing.value.status_code == 409
        assert (await db.get(AcceleratorTeam, old['id'])).status == 'active'
        assert (await active_team_member(db, candidate.membership_id)).team_id == old['id']
        assert (await db.get(AcceleratorMembership, candidate.membership_id)).project_id == source_project
        if method == 'application':
            await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status='accepted'), residents[1].user, db)
        else:
            await answer_team_invitation(pending['id'], AcceleratorTeamInvitationUpdate(status='accepted',
                leave_current_team=True, expected_current_team_id=old['id']), BackgroundTasks(), user, db)
        assert (await active_team_member(db, candidate.membership_id)).team_id == target['id']
        assert (await db.get(AcceleratorMembership, candidate.membership_id)).project_id == target['project']['id']
        assert (await db.get(AcceleratorTeam, old['id'])).status == ('active' if member else 'archived')
        assert (await db.get(AcceleratorTeamApplication, incoming['id'])).status == ('pending' if member else 'cancelled')
        assert (await db.get(AcceleratorTeamInvitation, invitation['id'])).status == ('pending' if member else 'cancelled')
        await db.refresh(personal)
        assert personal.user_id == user.id and personal.passport == {'core': {'problem': 'Preserve my research'}}
        assert await get_accessible_project(db, target['project']['id'], user)
        assert await get_accessible_project(db, personal.id, user)
        assert (await db.execute(select(func.count(AcceleratorTeamMember.id)).where(
            AcceleratorTeamMember.membership_id == candidate.membership_id, AcceleratorTeamMember.status == 'active'))).scalar_one() == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['declined', 'cancelled'])
async def test_declined_or_cancelled_transfer_keeps_source_active(status):
    async with AsyncSessionLocal() as db:
        residents, old, target = await _transfer_fixture(db)
        candidate = residents[0]
        pending = await create_team_application(target['id'], AcceleratorTeamApplicationCreate(
            leave_current_team=True, expected_current_team_id=old['id']), candidate.user, db)
        actor = candidate.user if status == 'cancelled' else residents[1].user
        await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status=status), actor, db)
        assert (await db.get(AcceleratorTeam, old['id'])).status == 'active'
        assert (await active_team_member(db, candidate.membership_id)).team_id == old['id']
        assert (await db.get(AcceleratorMembership, candidate.membership_id)).project_id == candidate.project_id


@pytest.mark.asyncio
async def test_transfer_rechecks_source_composition_and_requires_captain_delegation():
    async with AsyncSessionLocal() as db:
        residents, old, target = await _transfer_fixture(db)
        pending = await create_team_application(target['id'], AcceleratorTeamApplicationCreate(
            leave_current_team=True, expected_current_team_id=old['id']), residents[0].user, db)
        invitation = await invite_team_member(old['id'], AcceleratorTeamInvitationCreate(membership_id=residents[3].membership_id),
                                              BackgroundTasks(), residents[0].user, db)
        await answer_team_invitation(invitation['id'], AcceleratorTeamInvitationUpdate(status='accepted'),
                                     BackgroundTasks(), residents[3].user, db)
        with pytest.raises(HTTPException) as changed:
            await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status='accepted'), residents[1].user, db)
        assert changed.value.status_code == 409
        assert (await db.get(AcceleratorTeam, old['id'])).status == 'active'
        assert (await db.get(AcceleratorTeamApplication, pending['id'])).status == 'pending'
        await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status='cancelled'), residents[0].user, db)
        with pytest.raises(HTTPException) as cannot_abandon_others:
            await create_team_application(target['id'], AcceleratorTeamApplicationCreate(
                leave_current_team=True, expected_current_team_id=old['id']), residents[0].user, db)
        assert cannot_abandon_others.value.status_code == 409
        await transfer_team_captain(old['id'], AcceleratorTeamCaptainTransfer(membership_id=residents[3].membership_id), residents[0].user, db)
        pending = await create_team_application(target['id'], AcceleratorTeamApplicationCreate(
            leave_current_team=True, expected_current_team_id=old['id']), residents[0].user, db)
        await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status='accepted'), residents[1].user, db)
        assert (await db.get(AcceleratorTeam, old['id'])).status == 'active'
        assert (await active_team_member(db, residents[0].membership_id)).team_id == target['id']
        assert (await active_team_member(db, residents[3].membership_id)).team_id == old['id']


@pytest.mark.asyncio
async def test_full_destination_and_mid_transfer_failure_preserve_source(monkeypatch):
    import accelerator_team_service
    async with AsyncSessionLocal() as db:
        residents, old, target = await _transfer_fixture(db)
        candidate = residents[0]
        pending = await create_team_application(target['id'], AcceleratorTeamApplicationCreate(
            leave_current_team=True, expected_current_team_id=old['id']), candidate.user, db)
        team = await db.get(AcceleratorTeam, target['id'])
        team.max_members = 2
        await db.commit()
        await invite_team_member(target['id'], AcceleratorTeamInvitationCreate(membership_id=residents[3].membership_id),
                                 BackgroundTasks(), residents[1].user, db)
        with pytest.raises(HTTPException):
            await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status='accepted'), residents[1].user, db)
        assert (await db.get(AcceleratorTeam, old['id'])).status == 'active'
        team.max_members = 5
        await db.commit()
        async def fail_after_exit(*args, **kwargs):
            raise RuntimeError('Injected failure after leaving source')
        monkeypatch.setattr(accelerator_team_service, '_cancel_other_pending_invitations', fail_after_exit)
        with pytest.raises(RuntimeError, match='Injected failure'):
            await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status='accepted'), residents[1].user, db)
        await db.refresh(candidate.user)
        assert (await db.get(AcceleratorTeam, old['id'])).status == 'active'
        assert (await active_team_member(db, candidate.membership_id)).team_id == old['id']
        assert (await db.get(AcceleratorMembership, candidate.membership_id)).project_id == candidate.project_id
        assert (await db.get(AcceleratorTeamApplication, pending['id'])).status == 'pending'


@pytest.mark.asyncio
async def test_old_transfer_consent_cannot_leave_a_different_new_source_team():
    async with AsyncSessionLocal() as db:
        residents, old, target = await _transfer_fixture(db, member=True)
        candidate = residents[2]
        pending = await create_team_application(target['id'], AcceleratorTeamApplicationCreate(
            leave_current_team=True, expected_current_team_id=old['id']), candidate.user, db)
        active = await active_team_member(db, candidate.membership_id)
        await delete_team_member(active.id, BackgroundTasks(), candidate.user, db)
        replacement = await create_membership_team(candidate.membership_id, AcceleratorTeamCreate(name='Different source'), candidate.user, db)
        with pytest.raises(HTTPException) as stale:
            await respond_team_application(pending['id'], AcceleratorTeamApplicationUpdate(status='accepted'), residents[1].user, db)
        assert stale.value.status_code == 409
        assert (await active_team_member(db, candidate.membership_id)).team_id == replacement['id']
        assert (await db.get(AcceleratorTeam, replacement['id'])).status == 'active'
        assert (await db.get(AcceleratorTeamApplication, pending['id'])).status == 'pending'


@pytest.mark.asyncio
async def test_transfer_candidates_include_other_teams_without_publishing_contacts():
    async with AsyncSessionLocal() as db:
        residents, old, target = await _transfer_fixture(db)
        pool = await get_team_pool(residents[1].membership_id,residents[1].user,db)
        candidate = next(r for r in pool['candidates'] if r['membership_id']==residents[0].membership_id)
        assert candidate['current_team']['id']==old['id'] and candidate['current_team']['action']=='archive'
        assert candidate['email'] is None and candidate['telegram'] is None
        invitation=await invite_team_member(old['id'],AcceleratorTeamInvitationCreate(membership_id=residents[3].membership_id),
                                           BackgroundTasks(),residents[0].user,db)
        await answer_team_invitation(invitation['id'],AcceleratorTeamInvitationUpdate(status='accepted'),
                                     BackgroundTasks(),residents[3].user,db)
        pool=await get_team_pool(residents[1].membership_id,residents[1].user,db)
        assert residents[0].membership_id not in {r['membership_id'] for r in pool['candidates']}
        member=next(r for r in pool['candidates'] if r['membership_id']==residents[3].membership_id)
        assert member['current_team']['action']=='leave' and member['email'] is None


@pytest.mark.asyncio
async def test_postgres_simultaneous_transfers_to_two_teams_have_one_winner():
    async with AsyncSessionLocal() as db:
        if db.get_bind().dialect.name != 'postgresql':
            pytest.skip('Requires PostgreSQL row locks')
        residents, old, target = await _transfer_fixture(db)
        other = await create_membership_team(residents[2].membership_id, AcceleratorTeamCreate(name='Other destination'), residents[2].user, db)
        invitations = [await invite_team_member(t['id'], AcceleratorTeamInvitationCreate(membership_id=residents[0].membership_id),
                        BackgroundTasks(), owner.user, db) for t,owner in [(target,residents[1]),(other,residents[2])]]
        user_id = residents[0].user.id
        membership_id = residents[0].membership_id
    async def accept(invitation):
        async with AsyncSessionLocal() as session:
            person = await session.get(User,user_id)
            try:
                await answer_team_invitation(invitation['id'], AcceleratorTeamInvitationUpdate(status='accepted',
                    leave_current_team=True,expected_current_team_id=old['id']), BackgroundTasks(),person,session)
                return 200
            except HTTPException as exc:
                await session.rollback()
                return exc.status_code
    outcomes = await asyncio.wait_for(asyncio.gather(*(accept(i) for i in invitations)),timeout=20)
    assert sorted(outcomes) == [200,409]
    async with AsyncSessionLocal() as db:
        active = await active_team_member(db,membership_id)
        assert active.team_id in {target['id'],other['id']}
        assert (await db.get(AcceleratorTeam,old['id'])).status == 'archived'
        assert (await db.execute(select(func.count(AcceleratorTeamMember.id)).where(
            AcceleratorTeamMember.membership_id==membership_id,AcceleratorTeamMember.status=='active'))).scalar_one()==1


@pytest.mark.asyncio
async def test_postgres_opposite_member_transfers_finish_without_deadlock():
    async with AsyncSessionLocal() as db:
        if db.get_bind().dialect.name != 'postgresql':
            pytest.skip('Requires PostgreSQL row locks')
        residents, old, target = await _transfer_fixture(db,member=True)
        invitation=await invite_team_member(target['id'],AcceleratorTeamInvitationCreate(membership_id=residents[3].membership_id),
                                           BackgroundTasks(),residents[1].user,db)
        await answer_team_invitation(invitation['id'],AcceleratorTeamInvitationUpdate(status='accepted'),
                                     BackgroundTasks(),residents[3].user,db)
        moves=[]
        for candidate,source,destination,owner in [(residents[2],old,target,residents[1]),(residents[3],target,old,residents[0])]:
            invitation=await invite_team_member(destination['id'],AcceleratorTeamInvitationCreate(membership_id=candidate.membership_id),
                                               BackgroundTasks(),owner.user,db)
            moves.append((candidate.user.id,candidate.membership_id,source['id'],destination['id'],invitation['id']))
    async def accept(move):
        uid,mid,source,target_id,iid=move
        async with AsyncSessionLocal() as session:
            person=await session.get(User,uid)
            await answer_team_invitation(iid,AcceleratorTeamInvitationUpdate(status='accepted',leave_current_team=True,
                expected_current_team_id=source),BackgroundTasks(),person,session)
    await asyncio.wait_for(asyncio.gather(*(accept(move) for move in moves)),timeout=20)
    async with AsyncSessionLocal() as db:
        for uid,mid,source,destination,iid in moves:
            assert (await active_team_member(db,mid)).team_id==destination
        assert (await db.get(AcceleratorTeam,old['id'])).status=='active'
        assert (await db.get(AcceleratorTeam,target['id'])).status=='active'
