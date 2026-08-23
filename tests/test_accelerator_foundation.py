from __future__ import annotations

from datetime import datetime, timedelta
import uuid

import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError

from accelerator_service import accelerator_quota_snapshot
from accelerator_notification_service import enqueue_due_homework_reminders
from db_async import AsyncSessionLocal
from models import (
    AcceleratorApplication,
    AcceleratorApplicationEvent,
    AcceleratorInvitation,
    AcceleratorHomeworkAssignment,
    AcceleratorHomeworkSubmission,
    AcceleratorAttendanceRecord,
    AcceleratorEvent,
    AcceleratorNotificationOutbox,
    AcceleratorAuditLog,
    AcceleratorProgramConfig,
    AcceleratorQuotaUsageEvent,
    AcceleratorMembershipEvent,
    AcceleratorParticipantProfile,
    Project,
    User,
)
from routers.accelerators import (
    accept_accelerator_invitation,
    accept_application,
    assign_cohort_quota,
    assign_organizer,
    assign_tracker,
    assign_resident_quota,
    create_accelerator,
    create_cohort,
    create_homework_assignment,
    create_event,
    create_program_stage,
    check_in_to_event,
    complete_program_material,
    complete_program_stage,
    enroll_application,
    list_cohorts,
    list_accelerators,
    list_my_accelerator_memberships,
    list_homework_submissions,
    list_resident_homework,
    list_resident_program_stages,
    list_resident_events,
    list_event_attendance,
    list_residents,
    list_membership_events,
    cohort_resident_report,
    tracking_dashboard,
    membership_tracking,
    upsert_progress_checkin,
    create_tracking_feedback,
    create_tracking_task,
    update_tracking_task,
    get_resident_quota,
    get_program_config,
    publish_homework_assignment,
    publish_event,
    publish_program_stage,
    review_homework_submission,
    submit_public_application,
    submit_application,
    submit_homework,
    get_application_revision,
    submit_application_revision,
    update_application_status,
    update_cohort,
    update_program_config,
    update_cohort_status,
    update_membership_status,
    update_tracker_assignments,
    mark_event_attendance,
    validate_application_form,
)
from schemas.accelerators import (
    AcceleratorCreate,
    ApplicationCreate,
    ApplicationReview,
    ApplicationRevisionUpdate,
    ApplicationStatusUpdate,
    CohortCreate,
    CohortUpdate,
    CohortQuotaAssign,
    OrganizerAssign,
    TrackerAssign,
    TrackerAssignmentsUpdate,
    InvitationAccept,
    HomeworkAssignmentCreate,
    HomeworkReview,
    HomeworkSubmissionUpsert,
    AttendanceMark,
    EventCreate,
    ProgramMaterialCreate,
    ProgramStageCreate,
    PublicApplicationCreate,
    ProgramConfigUpdate,
    ResidentQuotaAssign,
    ResidentQuotaLimits,
    StatusUpdate,
    MembershipStatusUpdate,
    ProgressCheckinUpsert,
    TrackingFeedbackCreate,
    TrackingTaskCreate,
    TrackingTaskUpdate,
)
from subscription_service import consume_quota
from sqlalchemy import func, select


def test_application_form_supports_type_specific_required_fields():
    with pytest.raises(HTTPException):
        validate_application_form({"required": ["legacy_field"]}, {"another": "value"})
    schema = {
        "required": ["motivation", "project_name"],
        "fields": [
            {"key": "motivation", "required": True, "application_types": ["project", "participant"]},
            {"key": "project_name", "required": True, "application_types": ["project"]},
        ],
    }
    validate_application_form(schema, {"motivation": "Хочу развить компетенции"}, "participant")
    with pytest.raises(HTTPException) as missing_project_name:
        validate_application_form(schema, {"motivation": "Хочу развить проект"}, "project")
    assert missing_project_name.value.status_code == 422
    assert "project_name" in missing_project_name.value.detail


def test_membership_status_requires_meaningful_reason():
    with pytest.raises(ValidationError):
        MembershipStatusUpdate(status="suspended", reason="  ")


@pytest.mark.asyncio
async def test_application_enrollment_and_per_resident_quota_precedence():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-{suffix}@example.test", name="Admin", is_admin=True)
        organizer = User(email=f"organizer-{suffix}@example.test", name="Organizer")
        resident = User(email=f"resident-{suffix}@example.test", name="Resident")
        other_resident = User(email=f"resident-other-{suffix}@example.test", name="Other resident")
        db.add_all([admin, organizer, resident, other_resident])
        await db.commit()
        await db.refresh(admin)
        await db.refresh(organizer)
        await db.refresh(resident)
        await db.refresh(other_resident)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Test accelerator"), admin, db
        )
        await assign_organizer(
            accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"],
            CohortCreate(
                name="First cohort",
                application_form_schema={"required": ["project_name"]},
            ),
            admin,
            db,
        )
        updated_cohort = await update_cohort(
            cohort["id"],
            CohortUpdate(
                application_form_schema={
                    "title": "Анкета первого потока",
                    "description": "Расскажите о проекте",
                    "required": ["project_name"],
                    "fields": [
                        {
                            "key": "project_name",
                            "label": "Название проекта",
                            "type": "text",
                            "required": True,
                        },
                        {
                            "key": "stage",
                            "label": "Стадия",
                            "type": "select",
                            "options": ["Идея", "Прототип"],
                        },
                    ],
                }
            ),
            organizer,
            db,
        )
        assert updated_cohort["application_form_schema"]["title"] == "Анкета первого потока"
        with pytest.raises(HTTPException) as disabled_homework:
            await create_homework_assignment(
                cohort["id"],
                HomeworkAssignmentCreate(title="Гипотезы", description="Сформулируйте гипотезы"),
                organizer,
                db,
            )
        assert disabled_homework.value.status_code == 409
        program = await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=1, modules={"homework": True}),
            organizer,
            db,
        )
        assert program["modules"]["homework"] is True
        hidden_cohort = await create_cohort(
            accelerator["id"],
            CohortCreate(name="Other cohort"),
            admin,
            db,
        )
        await update_cohort_status(
            cohort["id"], StatusUpdate(status="accepting"), organizer, db
        )

        flow_limits = ResidentQuotaLimits(
            messages=70, roadmaps=4, custdev=2, grants=1
        )
        template_result = await assign_cohort_quota(
            cohort["id"],
            CohortQuotaAssign(limits=flow_limits),
            admin,
            db,
        )
        assert template_result["affected"] == 0

        with pytest.raises(HTTPException) as missing_form:
            await submit_application(
                cohort["id"],
                ApplicationCreate(
                    form_payload={"about": "idea"},
                    accept_privacy=True,
                    accept_program_rules=True,
                ),
                resident,
                db,
            )
        assert missing_form.value.status_code == 422

        application = await submit_application(
            cohort["id"],
            ApplicationCreate(
                form_payload={"project_name": "Pitch"},
                accept_privacy=True,
                accept_program_rules=True,
            ),
            resident,
            db,
        )
        accepted = await accept_application(
            application["id"],
            ApplicationReview(comment="Подходит"),
            BackgroundTasks(),
            organizer,
            db,
        )
        assert accepted["membership_status"] == "accepted"
        accepted_workspace = await list_my_accelerator_memberships(resident, db)
        assert accepted_workspace["memberships"][0]["status"] == "accepted"
        assert accepted_workspace["memberships"][0]["modules"] == {}

        enrolled = await enroll_application(application["id"], organizer, db)
        assert enrolled["status"] == "enrolled"
        membership_id = enrolled["membership_id"]

        flow_snapshot = await accelerator_quota_snapshot(db, resident.id, "messages")
        assert flow_snapshot is not None
        assert flow_snapshot["limit"] == 70
        assert flow_snapshot["override"].source == "cohort"

        personal_limits = ResidentQuotaLimits(
            messages=5, roadmaps=1, custdev=0, grants=0
        )
        await assign_resident_quota(
            membership_id,
            ResidentQuotaAssign(limits=personal_limits, reason="Индивидуальный лимит"),
            admin,
            db,
        )
        personal_snapshot = await accelerator_quota_snapshot(db, resident.id, "messages")
        assert personal_snapshot is not None
        assert personal_snapshot["limit"] == 5
        assert personal_snapshot["override"].source == "individual"

        mass_result = await assign_cohort_quota(
            cohort["id"],
            CohortQuotaAssign(
                limits=ResidentQuotaLimits(messages=80, roadmaps=5, custdev=3, grants=2),
                overwrite_personal=False,
            ),
            admin,
            db,
        )
        assert mass_result["affected"] == 0
        assert mass_result["skipped_personal"] == 1
        still_personal = await accelerator_quota_snapshot(db, resident.id, "messages")
        assert still_personal is not None
        assert still_personal["limit"] == 5

        overwrite_result = await assign_cohort_quota(
            cohort["id"],
            CohortQuotaAssign(
                limits=ResidentQuotaLimits(messages=90, roadmaps=6, custdev=4, grants=3),
                overwrite_personal=True,
            ),
            admin,
            db,
        )
        assert overwrite_result["affected"] == 1
        overwritten = await accelerator_quota_snapshot(db, resident.id, "messages")
        assert overwritten is not None
        assert overwritten["limit"] == 90
        assert overwritten["override"].source == "cohort"

        resident_cohorts = await list_cohorts(accelerator["id"], resident, db)
        assert [row["id"] for row in resident_cohorts] == [cohort["id"]]
        assert hidden_cohort["id"] not in {row["id"] for row in resident_cohorts}

        workspace = await list_my_accelerator_memberships(resident, db)
        assert len(workspace["memberships"]) == 1
        membership_view = workspace["memberships"][0]
        assert membership_view["membership_id"] == membership_id
        assert membership_view["status"] == "enrolled"
        assert membership_view["project"]["name"] == "Pitch"
        assert membership_view["modules"]["applications"] is True
        assert workspace["effective_quotas"]["messages"]["limit"] == 90

        other_application = await submit_application(
            cohort["id"],
            ApplicationCreate(
                form_payload={"project_name": "Other project"},
                accept_privacy=True,
                accept_program_rules=True,
            ),
            other_resident,
            db,
        )
        await accept_application(
            other_application["id"], ApplicationReview(), BackgroundTasks(), organizer, db
        )
        other_enrolled = await enroll_application(other_application["id"], organizer, db)

        homework = await create_homework_assignment(
            cohort["id"],
            HomeworkAssignmentCreate(
                title="Пять интервью",
                description="Проведите пять проблемных интервью и приложите выводы.",
                due_at=datetime.utcnow() + timedelta(days=7),
                audience="selected",
                target_membership_ids=[membership_id],
                allow_resubmit=True,
            ),
            organizer,
            db,
        )
        assignment = await db.get(AcceleratorHomeworkAssignment, homework["id"])
        assert assignment is not None
        published = await publish_homework_assignment(
            assignment.id, BackgroundTasks(), organizer, db
        )
        assert published["status"] == "published"
        assert published["recipient_count"] == 1

        resident_homework = await list_resident_homework(membership_id, resident, db)
        assert [item["title"] for item in resident_homework] == ["Пять интервью"]
        other_homework = await list_resident_homework(
            other_enrolled["membership_id"], other_resident, db
        )
        assert other_homework == []
        submitted_homework = await submit_homework(
            assignment.id,
            HomeworkSubmissionUpsert(
                answer_text="Провели пять интервью, три респондента подтвердили проблему.",
                attachments=["https://example.com/interviews"],
            ),
            BackgroundTasks(),
            resident,
            db,
        )
        assert submitted_homework["status"] == "submitted"
        submissions = await list_homework_submissions(assignment.id, organizer, db)
        assert len(submissions) == 1
        assert submissions[0]["resident"]["email"] == resident.email

        revision = await review_homework_submission(
            submissions[0]["id"],
            HomeworkReview(status="needs_revision", comment="Добавьте прямые цитаты."),
            BackgroundTasks(),
            organizer,
            db,
        )
        assert revision["status"] == "needs_revision"
        resubmitted = await submit_homework(
            assignment.id,
            HomeworkSubmissionUpsert(answer_text="Добавили цитаты респондентов."),
            BackgroundTasks(),
            resident,
            db,
        )
        assert resubmitted["attempt_count"] == 2
        accepted_submission = await review_homework_submission(
            submissions[0]["id"],
            HomeworkReview(status="accepted", comment="Зачтено"),
            BackgroundTasks(),
            organizer,
            db,
        )
        assert accepted_submission["status"] == "accepted"
        stored_submission = await db.get(AcceleratorHomeworkSubmission, submissions[0]["id"])
        assert stored_submission is not None
        assert stored_submission.review_comment == "Зачтено"

        deadline_homework = await create_homework_assignment(
            cohort["id"],
            HomeworkAssignmentCreate(
                title="Отчёт к дедлайну",
                description="Загрузите итоговый отчёт.",
                due_at=datetime.utcnow() + timedelta(hours=12),
                audience="selected",
                target_membership_ids=[membership_id],
            ),
            organizer,
            db,
        )
        await publish_homework_assignment(
            deadline_homework["id"], BackgroundTasks(), organizer, db
        )
        reminder_result = await enqueue_due_homework_reminders(now=datetime.utcnow())
        assert reminder_result["created"] == 1
        repeated_reminder = await enqueue_due_homework_reminders(now=datetime.utcnow())
        assert repeated_reminder["created"] == 0
        deadline_reminder = (await db.execute(select(AcceleratorNotificationOutbox).where(
            AcceleratorNotificationOutbox.event_type == "homework_deadline_reminder",
            AcceleratorNotificationOutbox.recipient_email == resident.email,
        ))).scalar_one()
        assert "меньше 24 часов" in deadline_reminder.body

        # A manager editing this cohort must see its own assignment even when a
        # stronger entitlement from another simultaneous cohort wins globally.
        await update_cohort_status(
            hidden_cohort["id"], StatusUpdate(status="accepting"), admin, db
        )
        second_application = await submit_application(
            hidden_cohort["id"],
            ApplicationCreate(
                form_payload={"project_name": "Pitch in another cohort"},
                accept_privacy=True,
                accept_program_rules=True,
            ),
            resident,
            db,
        )
        second_accepted = await accept_application(
            second_application["id"], ApplicationReview(), BackgroundTasks(), admin, db
        )
        await enroll_application(second_application["id"], admin, db)
        await assign_resident_quota(
            second_accepted["membership_id"],
            ResidentQuotaAssign(
                limits=ResidentQuotaLimits(messages=200, roadmaps=10, custdev=10, grants=10)
            ),
            admin,
            db,
        )
        assert (await accelerator_quota_snapshot(db, resident.id, "messages"))["limit"] == 200
        first_cohort_quota = await get_resident_quota(membership_id, organizer, db)
        assert first_cohort_quota["resources"]["messages"]["limit"] == 90


@pytest.mark.asyncio
async def test_role_boundaries_block_cross_accelerator_management_and_quota_changes():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-roles-{suffix}@example.test", name="Admin", is_admin=True)
        organizer = User(email=f"organizer-roles-{suffix}@example.test", name="Organizer")
        resident = User(email=f"resident-roles-{suffix}@example.test", name="Resident")
        db.add_all([admin, organizer, resident])
        await db.commit()
        for user in (admin, organizer, resident):
            await db.refresh(user)

        own_accelerator = await create_accelerator(
            AcceleratorCreate(name="Organizer accelerator"), admin, db
        )
        foreign_accelerator = await create_accelerator(
            AcceleratorCreate(name="Foreign accelerator"), admin, db
        )
        await assign_organizer(
            own_accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
        )
        own_cohort = await create_cohort(
            own_accelerator["id"], CohortCreate(name="Own cohort"), organizer, db
        )
        foreign_cohort = await create_cohort(
            foreign_accelerator["id"], CohortCreate(name="Foreign cohort"), admin, db
        )

        own_config = await update_program_config(
            own_cohort["id"],
            ProgramConfigUpdate(version=1, modules={"homework": True}),
            organizer,
            db,
        )
        assert own_config["modules"]["homework"] is True
        stored_config = (await db.execute(select(AcceleratorProgramConfig).where(
            AcceleratorProgramConfig.cohort_id == own_cohort["id"]
        ))).scalar_one()
        stored_config.modules = {"homework": True, "legacy_fake_module": True}
        await db.commit()
        compatible_config = await get_program_config(own_cohort["id"], organizer, db)
        assert compatible_config["modules"] == {
            "applications": True,
            "program": True,
            "homework": True,
            "attendance": False,
            "progress_tracking": False,
        }
        assert "legacy_fake_module" not in compatible_config["modules"]
        with pytest.raises(HTTPException) as foreign_management:
            await update_program_config(
                foreign_cohort["id"],
                ProgramConfigUpdate(version=1, modules={"homework": True}),
                organizer,
                db,
            )
        assert foreign_management.value.status_code == 403
        with pytest.raises(HTTPException) as resident_management:
            await update_program_config(
                own_cohort["id"],
                ProgramConfigUpdate(version=own_config["version"], modules={"attendance": True}),
                resident,
                db,
            )
        assert resident_management.value.status_code == 403
        with pytest.raises(HTTPException) as organizer_quota:
            await assign_cohort_quota(
                own_cohort["id"],
                CohortQuotaAssign(
                    limits=ResidentQuotaLimits(messages=70, roadmaps=4, custdev=2, grants=1)
                ),
                organizer,
                db,
            )
        assert organizer_quota.value.status_code == 403


@pytest.mark.asyncio
async def test_tracker_report_scope_and_resident_lifecycle():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-tracker-{suffix}@example.test", name="Admin", is_admin=True)
        organizer = User(email=f"organizer-tracker-{suffix}@example.test", name="Organizer")
        tracker = User(email=f"tracker-{suffix}@example.test", name="Tracker")
        outsider = User(email=f"outsider-tracker-{suffix}@example.test", name="Outsider")
        first_resident = User(email=f"resident-a-{suffix}@example.test", name="Resident A")
        second_resident = User(email=f"resident-b-{suffix}@example.test", name="Resident B")
        db.add_all([admin, organizer, tracker, outsider, first_resident, second_resident])
        await db.commit()
        for row in (admin, organizer, tracker, outsider, first_resident, second_resident):
            await db.refresh(row)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Tracker accelerator"), admin, db
        )
        await assign_organizer(
            accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"], CohortCreate(name="Tracker cohort"), organizer, db
        )
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(
                version=1,
                modules={"homework": True, "attendance": True, "progress_tracking": True},
            ),
            organizer,
            db,
        )
        await assign_cohort_quota(
            cohort["id"],
            CohortQuotaAssign(
                limits=ResidentQuotaLimits(messages=70, roadmaps=4, custdev=2, grants=1)
            ),
            admin,
            db,
        )
        await update_cohort_status(
            cohort["id"], StatusUpdate(status="accepting"), organizer, db
        )

        membership_ids = []
        for index, resident in enumerate((first_resident, second_resident), start=1):
            application = await submit_application(
                cohort["id"],
                ApplicationCreate(
                    form_payload={"project_name": f"Project {index}"},
                    accept_privacy=True,
                    accept_program_rules=True,
                ),
                resident,
                db,
            )
            accepted = await accept_application(
                application["id"], ApplicationReview(), BackgroundTasks(), organizer, db
            )
            await enroll_application(application["id"], organizer, db)
            membership_ids.append(accepted["membership_id"])

        assigned = await assign_tracker(
            cohort["id"],
            TrackerAssign(user_id=tracker.id, membership_ids=[membership_ids[0]]),
            organizer,
            db,
        )
        assert assigned["membership_ids"] == [membership_ids[0]]
        tracker_accelerators = await list_accelerators(tracker, db)
        assert tracker_accelerators[0]["access_role"] == "tracker"
        tracker_cohorts = await list_cohorts(accelerator["id"], tracker, db)
        assert [row["id"] for row in tracker_cohorts] == [cohort["id"]]
        tracker_residents = await list_residents(cohort["id"], tracker, db)
        assert [row["membership_id"] for row in tracker_residents] == [membership_ids[0]]

        tracker_report = await cohort_resident_report(cohort["id"], "json", tracker, db)
        assert tracker_report["access_role"] == "tracker"
        assert [row["membership_id"] for row in tracker_report["rows"]] == [membership_ids[0]]
        manager_report = await cohort_resident_report(cohort["id"], "json", organizer, db)
        assert manager_report["summary"]["residents"] == 2
        csv_report = await cohort_resident_report(cohort["id"], "csv", organizer, db)
        assert csv_report.body.startswith("\ufeff".encode("utf-8"))
        assert "Resident A".encode("utf-8") in csv_report.body
        assert "Сообщения лимит".encode("utf-8") in csv_report.body
        with pytest.raises(HTTPException) as no_report_access:
            await cohort_resident_report(cohort["id"], "json", outsider, db)
        assert no_report_access.value.status_code == 403

        checkin = await upsert_progress_checkin(
            membership_ids[0],
            ProgressCheckinUpsert(
                health="yellow",
                summary="Проверили две гипотезы",
                blockers="Не хватает интервью",
                next_steps="Провести ещё пять интервью",
                help_needed="Нужны контакты респондентов",
            ),
            BackgroundTasks(),
            first_resident,
            db,
        )
        assert checkin["health"] == "yellow"
        feedback = await create_tracking_feedback(
            membership_ids[0],
            TrackingFeedbackCreate(body="Сфокусируйтесь на одном сегменте"),
            BackgroundTasks(),
            tracker,
            db,
        )
        assert feedback["body"].startswith("Сфокусируйтесь")
        task = await create_tracking_task(
            membership_ids[0],
            TrackingTaskCreate(
                title="Провести интервью",
                due_at=datetime.utcnow() + timedelta(days=3),
            ),
            BackgroundTasks(),
            tracker,
            db,
        )
        completed_task = await update_tracking_task(
            task["id"], TrackingTaskUpdate(status="done"), BackgroundTasks(), first_resident, db
        )
        assert completed_task["status"] == "done"
        tracking = await membership_tracking(membership_ids[0], tracker, db)
        assert tracking["access_role"] == "tracker"
        assert len(tracking["checkins"]) == 1
        assert len(tracking["feedback"]) == 1
        assert tracking["tasks"][0]["status"] == "done"
        dashboard = await tracking_dashboard(cohort["id"], tracker, db)
        assert [row["membership_id"] for row in dashboard["rows"]] == [membership_ids[0]]
        assert dashboard["rows"][0]["risk"]["last_checkin_health"] == "yellow"
        with pytest.raises(HTTPException) as tracker_cannot_task_other:
            await create_tracking_task(
                membership_ids[1],
                TrackingTaskCreate(title="Недоступная задача"),
                BackgroundTasks(),
                tracker,
                db,
            )
        assert tracker_cannot_task_other.value.status_code == 403

        assignment = await create_homework_assignment(
            cohort["id"],
            HomeworkAssignmentCreate(
                title="Проверка трекера",
                description="Отправьте короткий ответ",
                due_at=datetime.utcnow() + timedelta(days=2),
            ),
            organizer,
            db,
        )
        await publish_homework_assignment(
            assignment["id"], BackgroundTasks(), organizer, db
        )
        first_submission = await submit_homework(
            assignment["id"],
            HomeworkSubmissionUpsert(answer_text="Ответ первого резидента"),
            BackgroundTasks(),
            first_resident,
            db,
        )
        second_submission = await submit_homework(
            assignment["id"],
            HomeworkSubmissionUpsert(answer_text="Ответ второго резидента"),
            BackgroundTasks(),
            second_resident,
            db,
        )
        tracker_submissions = await list_homework_submissions(
            assignment["id"], tracker, db
        )
        assert [row["id"] for row in tracker_submissions] == [first_submission["id"]]
        await review_homework_submission(
            first_submission["id"],
            HomeworkReview(status="accepted"),
            BackgroundTasks(),
            tracker,
            db,
        )
        with pytest.raises(HTTPException) as tracker_cannot_review_other:
            await review_homework_submission(
                second_submission["id"],
                HomeworkReview(status="accepted"),
                BackgroundTasks(),
                tracker,
                db,
            )
        assert tracker_cannot_review_other.value.status_code == 403

        event = await create_event(
            cohort["id"],
            EventCreate(
                title="Трекерская встреча",
                starts_at=datetime.utcnow() + timedelta(hours=1),
                ends_at=datetime.utcnow() + timedelta(hours=2),
            ),
            organizer,
            db,
        )
        await publish_event(event["id"], organizer, db)
        tracker_attendance = await list_event_attendance(event["id"], tracker, db)
        assert [row["membership_id"] for row in tracker_attendance] == [membership_ids[0]]
        marked = await mark_event_attendance(
            event["id"],
            AttendanceMark(membership_id=membership_ids[0], status="present"),
            tracker,
            db,
        )
        assert marked["status"] == "present"
        with pytest.raises(HTTPException) as tracker_cannot_mark_other:
            await mark_event_attendance(
                event["id"],
                AttendanceMark(membership_id=membership_ids[1], status="present"),
                tracker,
                db,
            )
        assert tracker_cannot_mark_other.value.status_code == 403

        with pytest.raises(HTTPException) as tracker_cannot_suspend:
            await update_membership_status(
                membership_ids[0],
                MembershipStatusUpdate(status="suspended", reason="Нет связи"),
                tracker,
                db,
            )
        assert tracker_cannot_suspend.value.status_code == 403

        suspended = await update_membership_status(
            membership_ids[0],
            MembershipStatusUpdate(status="suspended", reason="Пауза по просьбе резидента"),
            organizer,
            db,
        )
        assert suspended["status"] == "suspended"
        assert await accelerator_quota_snapshot(db, first_resident.id, "messages") is None
        suspended_workspace = await list_my_accelerator_memberships(first_resident, db)
        assert suspended_workspace["memberships"][0]["modules"] == {}

        resumed = await update_membership_status(
            membership_ids[0],
            MembershipStatusUpdate(status="enrolled", reason="Резидент вернулся"),
            organizer,
            db,
        )
        assert resumed["status"] == "enrolled"
        assert (await accelerator_quota_snapshot(db, first_resident.id, "messages"))["limit"] == 70
        completed = await update_membership_status(
            membership_ids[0],
            MembershipStatusUpdate(status="completed", reason="Программа успешно завершена"),
            organizer,
            db,
        )
        assert completed["status"] == "completed"
        assert await accelerator_quota_snapshot(db, first_resident.id, "messages") is None
        with pytest.raises(HTTPException) as terminal_status:
            await update_membership_status(
                membership_ids[0],
                MembershipStatusUpdate(status="enrolled", reason="Попытка вернуть"),
                organizer,
                db,
            )
        assert terminal_status.value.status_code == 409
        lifecycle = await list_membership_events(membership_ids[0], tracker, db)
        assert [row["to_status"] for row in lifecycle] == [
            "accepted", "enrolled", "suspended", "enrolled", "completed"
        ]
        assert (await db.execute(select(func.count(AcceleratorMembershipEvent.id)).where(
            AcceleratorMembershipEvent.membership_id == membership_ids[0]
        ))).scalar_one() == 5
        await update_tracker_assignments(
            cohort["id"], tracker.id, TrackerAssignmentsUpdate(membership_ids=[]), organizer, db
        )
        assert await list_accelerators(tracker, db) == []


@pytest.mark.asyncio
async def test_free_resident_can_spend_accelerator_message_quota_atomically():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-quota-{suffix}@example.test", name="Admin", is_admin=True)
        resident = User(email=f"resident-quota-{suffix}@example.test", name="Resident")
        db.add_all([admin, resident])
        await db.commit()
        await db.refresh(admin)
        await db.refresh(resident)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Quota accelerator"), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"],
            CohortCreate(name="Quota cohort", application_form_schema={"required": ["project"]}),
            admin,
            db,
        )
        await update_cohort_status(cohort["id"], StatusUpdate(status="accepting"), admin, db)
        application = await submit_application(
            cohort["id"],
            ApplicationCreate(
                form_payload={"project": "A"},
                accept_privacy=True,
                accept_program_rules=True,
            ),
            resident,
            db,
        )
        accepted = await accept_application(
            application["id"], ApplicationReview(), BackgroundTasks(), admin, db
        )
        await enroll_application(application["id"], admin, db)
        await assign_resident_quota(
            accepted["membership_id"],
            ResidentQuotaAssign(
                # Free already includes 5 messages; accelerator entitlement wins
                # only when it is stronger, so grant 7 here.
                limits=ResidentQuotaLimits(messages=7, roadmaps=0, custdev=0, grants=0)
            ),
            admin,
            db,
        )

        for index in range(7):
            handled = await consume_quota(
                db,
                resident,
                "messages",
                idempotency_key=f"accelerator-test:{suffix}:{index}",
            )
            assert handled is True
            await db.commit()

        repeated = await consume_quota(
            db,
            resident,
            "messages",
            idempotency_key=f"accelerator-test:{suffix}:0",
        )
        assert repeated is True
        await db.commit()
        usage_count = (await db.execute(select(func.count(AcceleratorQuotaUsageEvent.id)).where(
            AcceleratorQuotaUsageEvent.user_id == resident.id,
            AcceleratorQuotaUsageEvent.resource == "messages",
        ))).scalar_one()
        assert usage_count == 7

        with pytest.raises(HTTPException) as exhausted:
            await consume_quota(
                db,
                resident,
                "messages",
                idempotency_key=f"accelerator-test:{suffix}:exhausted",
            )
        assert exhausted.value.status_code == 402
        assert "лимит резидента" in exhausted.value.detail


def test_application_form_schema_rejects_duplicate_keys_and_invalid_select():
    with pytest.raises(ValidationError):
        CohortUpdate(application_form_schema={
            "fields": [
                {"key": "stage", "label": "Стадия"},
                {"key": "stage", "label": "Стадия ещё раз"},
            ]
        })
    with pytest.raises(ValidationError):
        CohortUpdate(application_form_schema={
            "fields": [
                {"key": "stage", "label": "Стадия", "type": "select", "options": ["Идея"]},
            ]
        })


@pytest.mark.asyncio
async def test_program_attendance_and_candidate_revision_flow(monkeypatch):
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-modules-{suffix}@example.test", name="Admin", is_admin=True)
        resident = User(email=f"resident-modules-{suffix}@example.test", name="Resident")
        candidate = User(email=f"candidate-modules-{suffix}@example.test", name="Candidate")
        db.add_all([admin, resident, candidate])
        await db.commit()
        for user in (admin, resident, candidate):
            await db.refresh(user)
        accelerator = await create_accelerator(AcceleratorCreate(name="Program accelerator"), admin, db)
        cohort = await create_cohort(
            accelerator["id"],
            CohortCreate(name="Program cohort", application_form_schema={"required": ["project_name"]}),
            admin, db,
        )
        await update_program_config(
            cohort["id"], ProgramConfigUpdate(version=1, modules={"attendance": True}), admin, db
        )
        await update_cohort_status(cohort["id"], StatusUpdate(status="accepting"), admin, db)
        application = await submit_application(
            cohort["id"], ApplicationCreate(form_payload={"project_name": "Resident project"}, accept_privacy=True, accept_program_rules=True), resident, db,
        )
        accepted = await accept_application(application["id"], ApplicationReview(), BackgroundTasks(), admin, db)
        await enroll_application(application["id"], admin, db)
        membership_id = accepted["membership_id"]

        first = await create_program_stage(
            cohort["id"], ProgramStageCreate(
                title="Проверка гипотез", description="Изучите материал",
                materials=[ProgramMaterialCreate(title="Методика", kind="link", url="https://example.com/guide")],
            ), admin, db,
        )
        second = await create_program_stage(
            cohort["id"], ProgramStageCreate(title="Первые продажи"), admin, db,
        )
        await publish_program_stage(first["id"], admin, db)
        await publish_program_stage(second["id"], admin, db)
        resident_stages = await list_resident_program_stages(membership_id, resident, db)
        assert [row["state"] for row in resident_stages] == ["available", "locked"]
        await complete_program_material(first["materials"][0]["id"], resident, db)
        await complete_program_stage(first["id"], resident, db)
        resident_stages = await list_resident_program_stages(membership_id, resident, db)
        assert [row["state"] for row in resident_stages] == ["completed", "available"]

        event = await create_event(
            cohort["id"], EventCreate(
                title="Воркшоп", starts_at=datetime.utcnow() + timedelta(minutes=30),
                ends_at=datetime.utcnow() + timedelta(minutes=90), event_format="online",
                meeting_url="https://example.com/meet",
            ), admin, db,
        )
        await publish_event(event["id"], admin, db)
        code = (await db.execute(select(AcceleratorEvent.checkin_code).where(
            AcceleratorEvent.id == event["id"]
        ))).scalar_one()
        checked = await check_in_to_event(code, resident, db)
        assert checked["checked_in"] is True
        resident_events = await list_resident_events(membership_id, resident, db)
        assert resident_events[0]["attendance"]["status"] == "present"
        attendance = (await db.execute(select(AcceleratorAttendanceRecord))).scalar_one()
        assert attendance.checkin_method == "qr"
        audit_actions = set((await db.execute(
            select(AcceleratorAuditLog.action).where(
                AcceleratorAuditLog.accelerator_id == accelerator["id"]
            )
        )).scalars().all())
        assert {
            "program_material.completed",
            "program_stage.completed",
            "attendance.checked_in",
        } <= audit_actions

        candidate_application = await submit_application(
            cohort["id"], ApplicationCreate(form_payload={"project_name": "Draft"}, accept_privacy=True, accept_program_rules=True), candidate, db,
        )
        monkeypatch.setattr("routers.accelerators.secrets.token_urlsafe", lambda _: "revision-token")
        revised_status = await update_application_status(
            candidate_application["id"],
            ApplicationStatusUpdate(status="needs_info", comment="Добавьте подтверждение спроса"),
            BackgroundTasks(), admin, db,
        )
        assert revised_status["status"] == "needs_info"
        revision_form = await get_application_revision("revision-token", db)
        assert revision_form["review_comment"] == "Добавьте подтверждение спроса"
        revised = await submit_application_revision(
            "revision-token", ApplicationRevisionUpdate(form_payload={"project_name": "Draft", "traction": "10 интервью"}), db,
        )
        assert revised["status"] == "under_review"
        with pytest.raises(HTTPException):
            await get_application_revision("revision-token", db)


@pytest.mark.asyncio
async def test_public_application_approval_creates_account_project_profile_and_invitation():
    suffix = uuid.uuid4().hex
    candidate_email = f"candidate-{suffix}@example.com"
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-public-{suffix}@example.test", name="Admin", is_admin=True)
        db.add(admin)
        await db.commit()
        await db.refresh(admin)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Public applications"), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"],
            CohortCreate(
                name="Open cohort",
                application_form_schema={
                    "required": ["project_name", "problem"],
                    "fields": [
                        {"key": "project_name", "label": "Проект", "required": True},
                        {"key": "problem", "label": "Проблема", "required": True},
                    ],
                },
            ),
            admin,
            db,
        )
        await update_cohort_status(
            cohort["id"], StatusUpdate(status="accepting"), admin, db
        )

        submitted = await submit_public_application(
            cohort["id"],
            PublicApplicationCreate(
                applicant_name="Иван Кандидат",
                applicant_email=candidate_email,
                form_payload={
                    "project_name": "Новый проект",
                    "problem": "Ручной процесс занимает неделю",
                    "solution": "Автоматизация",
                },
                accept_privacy=True,
                accept_program_rules=True,
            ),
            db,
        )
        application = await db.get(AcceleratorApplication, submitted["id"])
        assert application is not None
        assert application.user_id is None
        assert application.status == "submitted"

        approved = await accept_application(
            application.id,
            ApplicationReview(comment="Проходит базовые критерии"),
            BackgroundTasks(),
            admin,
            db,
        )
        assert approved["created_user"] is True
        assert approved["project_id"] is not None

        candidate = (await db.execute(
            select(User).where(User.email == candidate_email)
        )).scalar_one()
        project = await db.get(Project, approved["project_id"])
        assert project is not None
        assert project.user_id == candidate.id
        assert project.passport["core"]["name"] == "Новый проект"
        assert project.passport["core"]["problem"] == "Ручной процесс занимает неделю"

        invitation = (await db.execute(
            select(AcceleratorInvitation).where(AcceleratorInvitation.application_id == application.id)
        )).scalar_one()
        profile = (await db.execute(
            select(AcceleratorParticipantProfile).where(
                AcceleratorParticipantProfile.membership_id == approved["membership_id"]
            )
        )).scalar_one()
        outbox = (await db.execute(
            select(AcceleratorNotificationOutbox).where(
                AcceleratorNotificationOutbox.event_type == "application_approved",
                AcceleratorNotificationOutbox.recipient_email == candidate_email,
            )
        )).scalar_one()
        events = (await db.execute(
            select(AcceleratorApplicationEvent).where(
                AcceleratorApplicationEvent.application_id == application.id
            )
        )).scalars().all()
        assert invitation.accepted_at is None
        assert profile.visibility == {"organizer": True, "mentor": False, "public": False}
        assert outbox.status == "pending"
        assert [event.to_status for event in events] == ["submitted", "approved"]

        raw_token = outbox.body.split("token=", 1)[1].split()[0]
        activated = await accept_accelerator_invitation(
            raw_token,
            InvitationAccept(password="Resident2026"),
            db,
        )
        assert activated == {"status": "accepted", "email": candidate_email}
        await db.refresh(candidate)
        await db.refresh(invitation)
        assert candidate.password_hash
        assert candidate.email_verified is True
        assert invitation.accepted_at is not None
