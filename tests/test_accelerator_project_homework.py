from datetime import datetime, timedelta
import asyncio
import uuid
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select
from db_async import AsyncSessionLocal
from models import (
    User,
    AcceleratorTeamMember,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkAttempt,
    AcceleratorHomeworkSubmission,
    AcceleratorHomeworkParticipant,
    AcceleratorMembership,
)
from tests.test_accelerator_teams import _create_cohort_context, _enroll_resident
from routers.accelerator_teams import (
    create_membership_team,
    create_team_application,
    respond_team_application,
    delete_team_member,
)
from schemas.accelerator_teams import (
    AcceleratorTeamCreate,
    AcceleratorTeamApplicationCreate,
    AcceleratorTeamApplicationUpdate,
)
from routers.accelerators import (
    create_homework_assignment,
    publish_homework_assignment,
    submit_homework,
    review_homework_submission,
    list_resident_homework,
    list_homework_attempts,
    set_homework_exception,
    grant_homework_credit,
    list_homework_assignments,
    homework_credit_options,
    remind_homework_assignment,
    update_program_config,
    create_program_stage,
    publish_program_stage,
    membership_tracking_risk,
)
from schemas.accelerators import (
    HomeworkAssignmentCreate,
    HomeworkSubmissionUpsert,
    HomeworkReview,
    HomeworkExceptionUpsert,
    HomeworkCreditGrant,
    ProgramConfigUpdate,
    ProgramStageCreate,
)
from accelerator_homework_service import participant_results, readable_attempts
from accelerator_program_progress_service import ProgramProgressService


async def setup(db, count=3):
    suffix = uuid.uuid4().hex[:10]
    admin, manager, _, cohort = await _create_cohort_context(db, suffix)
    await update_program_config(
        cohort["id"],
        ProgramConfigUpdate(version=2, modules={"matchmaking": True, "homework": True}),
        admin,
        db,
    )
    people = [
        User(email=f"project-hw-{suffix}-{i}@example.test", name=f"Performer {i}")
        for i in range(count)
    ]
    db.add_all(people)
    await db.commit()
    residents = [
        await _enroll_resident(
            db, cohort_id=cohort["id"], manager=manager, resident=u, with_project=i == 0
        )
        for i, u in enumerate(people)
    ]
    return manager, cohort, residents


async def assignment(db, manager, cohort, **kw):
    values = {
        "title": "Project homework",
        "description": "Research the idea",
        "submission_mode": "team",
        **kw,
    }
    result = await create_homework_assignment(
        cohort["id"], HomeworkAssignmentCreate(**values), manager, db
    )
    await publish_homework_assignment(result["id"], BackgroundTasks(), manager, db)
    return result["id"]


async def join(db, team_id, resident, captain):
    req = await create_team_application(
        team_id, AcceleratorTeamApplicationCreate(), resident.user, db
    )
    await respond_team_application(
        req["id"], AcceleratorTeamApplicationUpdate(status="accepted"), captain.user, db
    )


async def send(db, aid, resident, text="Project result", **kw):
    return await submit_homework(
        aid,
        HomeworkSubmissionUpsert(answer_text=text, **kw),
        BackgroundTasks(),
        resident.user,
        db,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "with_project,with_team",
    [(True, False), (False, False), (True, True), (False, True)],
)
async def test_project_homework_allows_solo_without_creating_team_or_project(
    with_project, with_team
):
    async with AsyncSessionLocal() as db:
        manager, cohort, people = await setup(db)
        person = people[0] if with_project else people[1]
        if with_team:
            await create_membership_team(
                person.membership_id,
                AcceleratorTeamCreate(name="Solo team", max_members=1),
                person.user,
                db,
            )
        aid = await assignment(db, manager, cohort)
        before = (
            (
                await db.execute(
                    select(AcceleratorTeamMember.id).where(
                        AcceleratorTeamMember.membership_id == person.membership_id
                    )
                )
            )
            .scalars()
            .all()
        )
        rows = await list_resident_homework(person.membership_id, person.user, db)
        assert (
            rows[0]["can_submit"] and len(rows[0]["submission_context"]["members"]) == 1
        )
        result = await send(
            db,
            aid,
            person,
            expected_revision=0,
            expected_context=rows[0]["submission_context"],
        )
        assert bool(result["team_id"]) == with_team
        assert result["context"]["project_id"] == person.project_id
        await review_homework_submission(
            result["id"],
            HomeworkReview(status="accepted"),
            BackgroundTasks(),
            manager,
            db,
        )
        assert (await list_resident_homework(person.membership_id, person.user, db))[0][
            "display_status"
        ] == "accepted"
        assert (
            await db.execute(
                select(AcceleratorTeamMember.id).where(
                    AcceleratorTeamMember.membership_id == person.membership_id
                )
            )
        ).scalars().all() == before


@pytest.mark.asyncio
async def test_any_member_submits_one_shared_work_and_stale_editor_cannot_overwrite():
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id, AcceleratorTeamCreate(name="Shared"), owner.user, db
        )
        await join(db, team["id"], member, owner)
        aid = await assignment(db, manager, cohort)
        row = await send(db, aid, member, expected_revision=0)
        assert {p["membership_id"] for p in row["context"]["members"]} == {
            owner.membership_id,
            member.membership_id,
        }
        with pytest.raises(HTTPException) as conflict:
            await send(db, aid, owner, "Stale version", expected_revision=0)
        assert conflict.value.status_code == 409
        await db.commit()
        assert (
            await db.get(AcceleratorHomeworkSubmission, row["id"])
        ).answer_text == "Project result"
        again = await send(db, aid, owner, "Revised result", expected_revision=1)
        assert again["id"] == row["id"] and again["attempt_count"] == 2
        history = await list_homework_attempts(row["id"], member.user, db)
        assert [a["answer_text"] for a in history] == [
            "Revised result",
            "Project result",
        ]
        await review_homework_submission(
            row["id"], HomeworkReview(status="accepted"), BackgroundTasks(), manager, db
        )
        for person in [owner, member]:
            assert (
                await list_resident_homework(person.membership_id, person.user, db)
            )[0]["display_status"] == "accepted"
        report = await list_homework_assignments(cohort["id"], manager, db)
        assert report[0]["submission_counts"] == {"accepted": 1} and report[0][
            "participant_counts"
        ] == {"accepted": 2}
        reminder = await remind_homework_assignment(aid, BackgroundTasks(), manager, db)
        assert reminder["reminded"] == 1


@pytest.mark.asyncio
async def test_leave_preserves_credit_and_history_without_exposing_future_versions():
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id, AcceleratorTeamCreate(name="Original"), owner.user, db
        )
        await join(db, team["id"], member, owner)
        aid = await assignment(db, manager, cohort)
        work = await send(db, aid, owner)
        await review_homework_submission(
            work["id"],
            HomeworkReview(status="accepted"),
            BackgroundTasks(),
            manager,
            db,
        )
        member_row = (
            await db.execute(
                select(AcceleratorTeamMember).where(
                    AcceleratorTeamMember.team_id == team["id"],
                    AcceleratorTeamMember.membership_id == member.membership_id,
                )
            )
        ).scalar_one()
        await delete_team_member(member_row.id, BackgroundTasks(), member.user, db)
        await join(db, team["id"], new, owner)
        entrant = (await list_resident_homework(new.membership_id, new.user, db))[0]
        assert (
            entrant["submission"] is None and entrant["display_status"] == "not_started"
        )
        assert entrant["workspace_submission"]["id"] == work["id"]
        await send(db, aid, new, "Private future revision", expected_revision=1)
        history = await list_homework_attempts(work["id"], member.user, db)
        assert [a["attempt_number"] for a in history] == [1] and history[0][
            "review_status"
        ] == "accepted"
        old = (await list_resident_homework(member.membership_id, member.user, db))[0]
        assert (
            old["submission"]["answer_text"] == "Project result"
            and old["display_status"] == "accepted"
        )
        assert old["workspace_submission"] is None
        results = await participant_results(
            db, [member.membership_id, new.membership_id], [aid]
        )
        assert (
            results[(aid, member.membership_id)].status == "accepted"
            and results[(aid, new.membership_id)].status == "submitted"
        )


@pytest.mark.asyncio
async def test_individual_exception_strict_minimum_and_personal_deadline():
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Collaborative"),
            owner.user,
            db,
        )
        await join(db, team["id"], member, owner)
        aid = await assignment(db, manager, cohort, min_participants=3)
        (await db.get(AcceleratorHomeworkAssignment, aid)).due_at = (
            datetime.utcnow() - timedelta(days=1)
        )
        await db.commit()
        with pytest.raises(HTTPException) as minimum:
            await send(db, aid, member)
        assert minimum.value.status_code == 409
        await db.commit()
        with pytest.raises(HTTPException) as denied:
            await set_homework_exception(
                aid,
                member.membership_id,
                HomeworkExceptionUpsert(allow_individual=True, reason="Not authorized"),
                member.user,
                db,
            )
        assert denied.value.status_code == 403
        await db.commit()
        await set_homework_exception(
            aid,
            member.membership_id,
            HomeworkExceptionUpsert(
                allow_individual=True,
                due_at=datetime.utcnow() + timedelta(days=1),
                reason="Индивидуально: провести три интервью",
            ),
            manager,
            db,
        )
        page = (await list_resident_homework(member.membership_id, member.user, db))[0]
        assert not page["is_overdue"] and page["display_status"] == "not_started"
        assert page["individual_instructions"] == "Индивидуально: провести три интервью"
        work = await send(db, aid, member)
        assert work["team_id"] is None and [
            p["membership_id"] for p in work["context"]["members"]
        ] == [member.membership_id]
        owner_page = (
            await list_resident_homework(owner.membership_id, owner.user, db)
        )[0]
        assert member.membership_id not in [
            m["membership_id"] for m in owner_page["submission_context"]["members"]
        ]
        assert owner_page["workspace_submission"] is None


@pytest.mark.asyncio
async def test_new_member_gets_no_old_credit_until_explicit_organizer_grant():
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id, AcceleratorTeamCreate(name="Grant"), owner.user, db
        )
        aid = await assignment(db, manager, cohort)
        work = await send(db, aid, owner)
        attempt = (
            await db.execute(
                select(AcceleratorHomeworkAttempt).where(
                    AcceleratorHomeworkAttempt.submission_id == work["id"]
                )
            )
        ).scalar_one()
        with pytest.raises(HTTPException) as unaccepted:
            await grant_homework_credit(
                aid,
                member.membership_id,
                HomeworkCreditGrant(attempt_id=attempt.id, reason="Premature credit"),
                manager,
                db,
            )
        assert unaccepted.value.status_code == 409
        await db.commit()
        await review_homework_submission(
            work["id"],
            HomeworkReview(status="accepted"),
            BackgroundTasks(),
            manager,
            db,
        )
        attempt.review_status = (
            None  # Legacy accepted versions may have no copied review status.
        )
        await db.commit()
        assert any(
            option["attempt_id"] == attempt.id
            for option in await homework_credit_options(aid, manager, db)
        )
        await join(db, team["id"], member, owner)
        assert (await list_resident_homework(member.membership_id, member.user, db))[0][
            "submission"
        ] is None
        with pytest.raises(HTTPException) as denied:
            await grant_homework_credit(
                aid,
                member.membership_id,
                HomeworkCreditGrant(attempt_id=attempt.id, reason="Own credit"),
                member.user,
                db,
            )
        assert denied.value.status_code == 403
        await db.commit()
        await grant_homework_credit(
            aid,
            member.membership_id,
            HomeworkCreditGrant(
                attempt_id=attempt.id, reason="Подтверждено участие в подготовке"
            ),
            manager,
            db,
        )
        assert (await list_resident_homework(member.membership_id, member.user, db))[0][
            "display_status"
        ] == "accepted"
        await db.refresh(attempt)
        assert [p["membership_id"] for p in attempt.context["members"]] == [
            owner.membership_id
        ]


@pytest.mark.asyncio
async def test_selected_audience_and_require_project_do_not_credit_unassigned_teammates():
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id, AcceleratorTeamCreate(name="Selected"), owner.user, db
        )
        await join(db, team["id"], member, owner)
        aid = await assignment(
            db,
            manager,
            cohort,
            audience="selected",
            target_membership_ids=[member.membership_id],
        )
        work = await send(db, aid, member)
        assert [p["membership_id"] for p in work["context"]["members"]] == [
            member.membership_id
        ]
        assert await list_resident_homework(owner.membership_id, owner.user, db) == []
        with pytest.raises(HTTPException) as unavailable:
            await send(db, aid, owner)
        assert unavailable.value.status_code == 404
        await db.commit()
        required = await assignment(db, manager, cohort, require_project=True)
        with pytest.raises(HTTPException) as missing:
            await send(db, required, new)
        assert missing.value.status_code == 409 and "проект" in missing.value.detail
        await db.commit()


@pytest.mark.asyncio
async def test_changing_roster_between_preview_and_submit_requires_confirmation():
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id, AcceleratorTeamCreate(name="Changing"), owner.user, db
        )
        aid = await assignment(db, manager, cohort)
        preview = (await list_resident_homework(owner.membership_id, owner.user, db))[0]
        await join(db, team["id"], member, owner)
        with pytest.raises(HTTPException) as changed:
            await send(
                db,
                aid,
                owner,
                expected_context=preview["submission_context"],
                expected_revision=0,
            )
        assert changed.value.status_code == 409
        await db.commit()
        assert not (
            await db.execute(
                select(AcceleratorHomeworkSubmission.id).where(
                    AcceleratorHomeworkSubmission.assignment_id == aid
                )
            )
        ).first()


@pytest.mark.asyncio
async def test_concurrent_team_submission_creates_one_version_on_postgres():
    async with AsyncSessionLocal() as db:
        if db.get_bind().dialect.name != "postgresql":
            pytest.skip("Requires PostgreSQL row locks")
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Concurrent"),
            owner.user,
            db,
        )
        await join(db, team["id"], member, owner)
        aid = await assignment(db, manager, cohort)
        ids = [owner.user.id, member.user.id]

    async def worker(uid):
        async with AsyncSessionLocal() as db:
            u = await db.get(User, uid)
            try:
                result = await submit_homework(
                    aid,
                    HomeworkSubmissionUpsert(answer_text=str(uid), expected_revision=0),
                    BackgroundTasks(),
                    u,
                    db,
                )
                return result["id"]
            except HTTPException as exc:
                await db.commit()
                return exc.status_code

    results = await asyncio.wait_for(
        asyncio.gather(*[worker(uid) for uid in ids]), timeout=20
    )
    assert results.count(409) == 1
    async with AsyncSessionLocal() as db:
        rows = (
            (
                await db.execute(
                    select(AcceleratorHomeworkSubmission).where(
                        AcceleratorHomeworkSubmission.assignment_id == aid
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1 and rows[0].attempt_count == 1


@pytest.mark.asyncio
async def test_snapshot_controls_program_completion_and_overdue_risk_after_leaving():
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        stage = await create_program_stage(
            cohort["id"], ProgramStageCreate(title="Research stage"), manager, db
        )
        await publish_program_stage(stage["id"], manager, db)
        team = await create_membership_team(
            owner.membership_id,
            AcceleratorTeamCreate(name="Stage team"),
            owner.user,
            db,
        )
        await join(db, team["id"], member, owner)
        aid = await assignment(db, manager, cohort, stage_id=stage["id"])
        (await db.get(AcceleratorHomeworkAssignment, aid)).due_at = (
            datetime.utcnow() - timedelta(days=1)
        )
        await db.commit()
        work = await send(db, aid, owner)
        row = (
            await db.execute(
                select(AcceleratorTeamMember).where(
                    AcceleratorTeamMember.team_id == team["id"],
                    AcceleratorTeamMember.membership_id == member.membership_id,
                )
            )
        ).scalar_one()
        await delete_team_member(row.id, BackgroundTasks(), member.user, db)
        await join(db, team["id"], new, owner)
        await review_homework_submission(
            work["id"],
            HomeworkReview(status="accepted"),
            BackgroundTasks(),
            manager,
            db,
        )
        service = ProgramProgressService(db)
        old = await service.get_stage_state(member.membership_id, stage["id"])
        entrant = await service.get_stage_state(new.membership_id, stage["id"])
        assert old["completed"] and not entrant["completed"]
        scoped_members = [await db.get(AcceleratorMembership, person.membership_id) for person in (member, new)]
        batched = await service.get_memberships_progress(scoped_members)
        for person in scoped_members:
            assert batched[person.id] == await service.get_membership_progress(person.id)
        assert batched[member.membership_id]["stages"][0]["completed"]
        assert not batched[new.membership_id]["stages"][0]["completed"]
        assert (
            await membership_tracking_risk(
                db, await db.get(AcceleratorMembership, member.membership_id)
            )
        )["overdue_homework"] == 0
        assert (
            await membership_tracking_risk(
                db, await db.get(AcceleratorMembership, new.membership_id)
            )
        )["overdue_homework"] == 1


def test_migration_preserves_existing_answers_scores_and_dated_membership_attribution(
    tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    import sqlalchemy as sa
    from models import (
        User,
        AcceleratorAuditLog,
        Accelerator,
        AcceleratorCohort,
        AcceleratorMembership,
        AcceleratorTeam,
        AcceleratorTeamMember,
        AcceleratorHomeworkAssignment,
        AcceleratorHomeworkSubmission,
        AcceleratorHomeworkAttempt,
    )

    url = "sqlite:///" + str(tmp_path / "legacy-homework.db")
    monkeypatch.setenv("DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "20261029_team_transfer")
    engine = sa.create_engine(url)
    meta = sa.MetaData()
    meta.reflect(engine)

    def insert(db, model, **kw):
        table = meta.tables[model.__tablename__]
        data = dict(kw)
        for c in model.__table__.columns:
            if c.name not in table.c or c.name in data or c.primary_key:
                continue
            if c.default is not None:
                data[c.name] = (
                    c.default.arg(None) if c.default.is_callable else c.default.arg
                )
        db.execute(table.insert().values(**data))

    now = datetime.utcnow()
    before = now - timedelta(days=2)
    after = now + timedelta(days=1)
    with engine.begin() as db:
        for uid in [1, 2, 3]:
            insert(
                db,
                User,
                id=uid,
                name=f"Legacy {uid}",
                email=f"legacy{uid}@example.test",
            )
        insert(db, Accelerator, id=1, name="Legacy accelerator", created_by_user_id=1)
        insert(
            db,
            AcceleratorCohort,
            id=1,
            name="Legacy cohort",
            accelerator_id=1,
            created_by_user_id=1,
        )
        for uid in [1, 2, 3]:
            insert(
                db,
                AcceleratorMembership,
                id=uid,
                user_id=uid,
                cohort_id=1,
                role="resident",
                status="enrolled",
                accepted_by_user_id=1,
            )
        insert(
            db,
            AcceleratorTeam,
            id=1,
            cohort_id=1,
            name="Legacy team",
            owner_membership_id=1,
            created_by_user_id=1,
        )
        for mid in [1, 2, 3]:
            insert(
                db,
                AcceleratorTeamMember,
                id=mid,
                team_id=1,
                membership_id=mid,
                role="owner" if mid == 1 else "member",
                joined_at=after if mid == 3 else before,
                left_at=after if mid == 2 else None,
                status="left" if mid == 2 else "active",
            )
        insert(
            db,
            AcceleratorHomeworkAssignment,
            id=1,
            cohort_id=1,
            title="Legacy homework",
            description="Keep",
            submission_mode="team",
            created_by_user_id=1,
            updated_by_user_id=1,
        )
        insert(
            db,
            AcceleratorHomeworkSubmission,
            id=1,
            assignment_id=1,
            membership_id=1,
            team_id=1,
            status="accepted",
            answer_text="Keep original answer",
            attachments=[],
            attempt_count=1,
            submitted_at=now,
            review_comment="Keep review",
        )
        insert(
            db,
            AcceleratorHomeworkAttempt,
            id=1,
            submission_id=1,
            attempt_number=1,
            answer_text="Keep original answer",
            attachments=[],
            created_at=now,
            review_status=None,
        )
        # The original sender left the team before this later version. Audit identifies the actual sender.
        later = after + timedelta(days=1)
        insert(
            db,
            AcceleratorHomeworkAssignment,
            id=2,
            cohort_id=1,
            title="Later legacy work",
            description="Keep",
            submission_mode="team",
            created_by_user_id=1,
            updated_by_user_id=1,
        )
        insert(
            db,
            AcceleratorHomeworkSubmission,
            id=2,
            assignment_id=2,
            membership_id=2,
            team_id=1,
            status="accepted",
            answer_text="Later answer",
            attachments=[],
            attempt_count=1,
            submitted_at=later,
        )
        insert(
            db,
            AcceleratorHomeworkAttempt,
            id=2,
            submission_id=2,
            attempt_number=1,
            answer_text="Later answer",
            attachments=[],
            created_at=later,
        )
        insert(
            db,
            AcceleratorAuditLog,
            accelerator_id=1,
            cohort_id=1,
            actor_user_id=1,
            action="homework.submitted",
            target_type="homework_submission",
            target_id=2,
            details={"assignment_id": 2, "attempt": 1},
        )
    command.upgrade(cfg, "head")
    meta = sa.MetaData()
    meta.reflect(engine)
    with engine.connect() as db:
        sub = (
            db.execute(
                sa.select(meta.tables["accelerator_homework_submissions"]).where(
                    meta.tables["accelerator_homework_submissions"].c.id == 1
                )
            )
            .mappings()
            .one()
        )
        attempt = (
            db.execute(
                sa.select(meta.tables["accelerator_homework_attempts"]).where(
                    meta.tables["accelerator_homework_attempts"].c.id == 1
                )
            )
            .mappings()
            .one()
        )
        members = set(
            db.execute(
                sa.select(
                    meta.tables["accelerator_homework_participants"].c.membership_id
                ).where(
                    meta.tables["accelerator_homework_participants"].c.attempt_id == 1
                )
            ).scalars()
        )
        assert (
            sub["answer_text"] == "Keep original answer"
            and sub["status"] == "accepted"
            and sub["review_comment"] == "Keep review"
        )
        assert members == {1, 2} and attempt["review_status"] is None
        assert {p["membership_id"] for p in attempt["context"]["members"]} == {1, 2}
        later = (
            db.execute(
                sa.select(meta.tables["accelerator_homework_attempts"]).where(
                    meta.tables["accelerator_homework_attempts"].c.id == 2
                )
            )
            .mappings()
            .one()
        )
        assert {p["membership_id"] for p in later["context"]["members"]} == {1, 3}
        assert later["context"]["submitted_by_user_id"] == 1
    engine.dispose()


@pytest.mark.asyncio
async def test_shared_attachments_can_be_reused_but_former_members_cannot_download_new_files(
    tmp_path, monkeypatch
):
    from models import AcceleratorFile
    from routers.accelerators import download_accelerator_file

    monkeypatch.setattr("routers.accelerators.ACCELERATOR_UPLOAD_DIR", tmp_path)
    async with AsyncSessionLocal() as db:
        manager, cohort, (owner, member, new) = await setup(db)
        team = await create_membership_team(
            owner.membership_id, AcceleratorTeamCreate(name="File team"), owner.user, db
        )
        await join(db, team["id"], member, owner)
        aid = await assignment(db, manager, cohort)

        async def upload(person, label):
            token = uuid.uuid4().hex
            stored = token + ".txt"
            (tmp_path / stored).write_text(label)
            db.add(
                AcceleratorFile(
                    token=token,
                    cohort_id=cohort["id"],
                    uploader_user_id=person.user.id,
                    purpose="homework",
                    stored_name=stored,
                    original_name=label + ".txt",
                    mime_type="text/plain",
                    size_bytes=len(label),
                )
            )
            await db.commit()
            return token, "/api/accelerators/files/" + token

        old_token, old_url = await upload(owner, "Original")
        work = await submit_homework(
            aid,
            HomeworkSubmissionUpsert(attachments=[old_url]),
            BackgroundTasks(),
            owner.user,
            db,
        )
        await submit_homework(
            aid,
            HomeworkSubmissionUpsert(attachments=[old_url], expected_revision=1),
            BackgroundTasks(),
            member.user,
            db,
        )
        tm = (
            await db.execute(
                select(AcceleratorTeamMember).where(
                    AcceleratorTeamMember.team_id == team["id"],
                    AcceleratorTeamMember.membership_id == member.membership_id,
                )
            )
        ).scalar_one()
        await delete_team_member(tm.id, BackgroundTasks(), member.user, db)
        new_token, new_url = await upload(owner, "Future private file")
        await submit_homework(
            aid,
            HomeworkSubmissionUpsert(attachments=[new_url], expected_revision=2),
            BackgroundTasks(),
            owner.user,
            db,
        )
        assert (
            await download_accelerator_file(old_token, False, member.user, db)
        ).status_code == 200
        with pytest.raises(HTTPException) as hidden:
            await download_accelerator_file(new_token, False, member.user, db)
        assert hidden.value.status_code == 404
        assert (
            await download_accelerator_file(new_token, False, owner.user, db)
        ).status_code == 200
