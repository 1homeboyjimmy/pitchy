from __future__ import annotations

from datetime import datetime, timedelta
import json
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
    AcceleratorArtifact,
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
    AcceleratorMatch,
    AcceleratorMatchProfile,
    AcceleratorProjectAudit,
    AcceleratorProjectAuditTaskLink,
    AcceleratorDemoDay,
    AcceleratorDemoDayProject,
    AcceleratorDemoDayScore,
    AcceleratorTrackerAssignment,
    AcceleratorParticipantProfile,
    ChatMessage,
    ChatSession,
    Project,
    User,
)
from routers.accelerator_artifacts import (
    launch_program_action,
    list_cohort_program_artifacts,
    sync_program_artifact,
    update_program_artifact,
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
    search_matchmaking_candidates,
    list_matchmaking_profiles,
    create_matchmaking_pool_profile,
    upsert_resident_match_profile,
    matchmaking_recommendations,
    create_accelerator_match,
    list_accelerator_matches,
    my_accelerator_matches,
    update_accelerator_match,
    list_cohort_project_audits,
    list_membership_project_audits,
    create_project_audit,
    create_project_audit_task,
    create_demo_day,
    assign_demo_day_expert,
    select_demo_day_project,
    update_demo_day_materials,
    update_demo_day_project_decision,
    upsert_demo_day_score,
    update_demo_day_status,
    list_cohort_demo_days,
    list_membership_demo_days,
    export_demo_day,
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
    AcceleratorArtifactUpdate,
    ProgramActionCreate,
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
    MatchProfileData,
    MatchPoolProfileCreate,
    MatchCreate,
    MatchStatusUpdate,
    ProjectAuditCreate,
    ProjectAuditGeneratedResult,
    ProjectAuditTaskCreate,
    DemoDayCreate,
    DemoDayCriterion,
    DemoDayExpertAssign,
    DemoDayProjectSelect,
    DemoDayMaterialsUpdate,
    DemoDayProjectDecision,
    DemoDayScoreUpsert,
    DemoDayStatusUpdate,
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
            "matchmaking": False,
            "project_audit": False,
            "demo_day": False,
            "pitchy_artifacts": False,
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
async def test_matchmaking_profiles_recommendations_matches_and_role_boundaries():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-match-{suffix}@example.test", name="Admin", is_admin=True)
        organizer = User(email=f"organizer-match-{suffix}@example.test", name="Organizer")
        resident = User(email=f"resident-match-{suffix}@example.test", name="Resident")
        peer = User(email=f"peer-match-{suffix}@example.test", name="Peer")
        tracker = User(email=f"tracker-match-{suffix}@example.test", name="Tracker")
        expert = User(email=f"expert-match-{suffix}@example.test", name="Expert")
        outsider = User(email=f"outsider-match-{suffix}@example.test", name="Outsider")
        db.add_all([admin, organizer, resident, peer, tracker, expert, outsider])
        await db.commit()
        for person in (admin, organizer, resident, peer, tracker, expert, outsider):
            await db.refresh(person)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Matchmaking accelerator"), admin, db
        )
        await assign_organizer(
            accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"], CohortCreate(name="Matchmaking cohort"), organizer, db
        )
        await update_program_config(
            cohort["id"], ProgramConfigUpdate(version=1, modules={"matchmaking": True}),
            organizer, db,
        )
        await update_cohort_status(
            cohort["id"], StatusUpdate(status="accepting"), organizer, db
        )

        membership_ids = []
        for index, person in enumerate((resident, peer), start=1):
            application = await submit_application(
                cohort["id"],
                ApplicationCreate(
                    form_payload={"project_name": f"Match project {index}"},
                    accept_privacy=True, accept_program_rules=True,
                ),
                person, db,
            )
            accepted = await accept_application(
                application["id"], ApplicationReview(), BackgroundTasks(), organizer, db
            )
            await enroll_application(application["id"], organizer, db)
            membership_ids.append(accepted["membership_id"])

        resident_profile = await upsert_resident_match_profile(
            membership_ids[0],
            MatchProfileData(
                bio="B2B SaaS проект",
                expertise=["продукт"], needs=["продажи", "маркетинг"],
                industries=["SaaS"], goals=["первые продажи"],
                preferred_formats=["онлайн"], max_matches=4,
            ),
            resident, db,
        )
        assert resident_profile["role"] == "resident"
        await upsert_resident_match_profile(
            membership_ids[1],
            MatchProfileData(
                bio="Основатель с опытом продаж", expertise=["продажи"],
                industries=["SaaS"], preferred_formats=["онлайн"], max_matches=2,
            ),
            peer, db,
        )

        candidates = await search_matchmaking_candidates(
            cohort["id"], "expert", "expert-match", organizer, db
        )
        assert [row["id"] for row in candidates] == [expert.id]
        expert_profile = await create_matchmaking_pool_profile(
            cohort["id"],
            MatchPoolProfileCreate(
                user_id=expert.id, role="expert", bio="Эксперт по B2B продажам",
                expertise=["продажи", "маркетинг"], industries=["SaaS"],
                goals=["первые продажи"], preferred_formats=["онлайн"], max_matches=3,
            ),
            organizer, db,
        )
        tracker_profile = await create_matchmaking_pool_profile(
            cohort["id"],
            MatchPoolProfileCreate(
                user_id=tracker.id, role="tracker", bio="Трекер продуктовых команд",
                expertise=["продажи"], industries=["SaaS"],
                preferred_formats=["онлайн"], max_matches=3,
            ),
            organizer, db,
        )
        profiles = await list_matchmaking_profiles(cohort["id"], None, organizer, db)
        assert {row["role"] for row in profiles} == {"resident", "tracker", "expert"}

        expert_recommendations = await matchmaking_recommendations(
            membership_ids[0], "expert", resident, db
        )
        assert expert_recommendations[0]["profile"]["id"] == expert_profile["id"]
        assert expert_recommendations[0]["score"] >= 80
        assert "email" not in expert_recommendations[0]["profile"]
        with pytest.raises(HTTPException) as outsider_recommendations:
            await matchmaking_recommendations(
                membership_ids[0], "expert", outsider, db
            )
        assert outsider_recommendations.value.status_code == 403

        expert_match = await create_accelerator_match(
            membership_ids[0], MatchCreate(counterpart_profile_id=expert_profile["id"]),
            BackgroundTasks(), organizer, db,
        )
        assert expert_match["status"] == "active"
        assert (await list_accelerators(expert, db))[0]["access_role"] == "expert"
        assert [row["id"] for row in await list_cohorts(accelerator["id"], expert, db)] == [cohort["id"]]
        expert_workspace = await my_accelerator_matches(cohort["id"], expert, db)
        assert expert_workspace["access_role"] == "expert"
        assert [row["id"] for row in expert_workspace["matches"]] == [expert_match["id"]]
        with pytest.raises(HTTPException) as expert_cannot_read_residents:
            await list_residents(cohort["id"], expert, db)
        assert expert_cannot_read_residents.value.status_code == 403

        tracker_match = await create_accelerator_match(
            membership_ids[0], MatchCreate(counterpart_profile_id=tracker_profile["id"]),
            BackgroundTasks(), organizer, db,
        )
        tracker_assignment = (await db.execute(select(AcceleratorTrackerAssignment).where(
            AcceleratorTrackerAssignment.tracker_user_id == tracker.id,
            AcceleratorTrackerAssignment.membership_id == membership_ids[0],
        ))).scalar_one()
        assert tracker_assignment.id > 0
        tracker_report = await cohort_resident_report(cohort["id"], "json", tracker, db)
        assert [row["membership_id"] for row in tracker_report["rows"]] == [membership_ids[0]]

        ended = await update_accelerator_match(
            tracker_match["id"], MatchStatusUpdate(status="ended"),
            BackgroundTasks(), organizer, db,
        )
        assert ended["status"] == "ended"
        assert (await db.execute(select(func.count(AcceleratorTrackerAssignment.id)).where(
            AcceleratorTrackerAssignment.id == tracker_assignment.id
        ))).scalar_one() == 0
        assert await list_accelerators(tracker, db) == []
        all_matches = await list_accelerator_matches(cohort["id"], organizer, db)
        assert {row["status"] for row in all_matches} == {"active", "ended"}
        assert (await db.execute(select(func.count(AcceleratorNotificationOutbox.id)).where(
            AcceleratorNotificationOutbox.cohort_id == cohort["id"],
            AcceleratorNotificationOutbox.event_type.like("matchmaking_%"),
        ))).scalar_one() >= 6
        assert (await db.execute(select(func.count(AcceleratorMatch.id)).where(
            AcceleratorMatch.cohort_id == cohort["id"]
        ))).scalar_one() == 2
        assert (await db.execute(select(func.count(AcceleratorMatchProfile.id)).where(
            AcceleratorMatchProfile.cohort_id == cohort["id"]
        ))).scalar_one() == 4


@pytest.mark.asyncio
async def test_project_audit_uses_membership_quota_scopes_tracker_and_creates_task(monkeypatch):
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-audit-{suffix}@example.test", name="Admin", is_admin=True)
        organizer = User(email=f"organizer-audit-{suffix}@example.test", name="Organizer")
        resident = User(email=f"resident-audit-{suffix}@example.test", name="Resident")
        tracker = User(email=f"tracker-audit-{suffix}@example.test", name="Tracker")
        outsider = User(email=f"outsider-audit-{suffix}@example.test", name="Outsider")
        db.add_all([admin, organizer, resident, tracker, outsider])
        await db.commit()
        for person in (admin, organizer, resident, tracker, outsider):
            await db.refresh(person)
        project = Project(
            user_id=resident.id,
            name="Audit project",
            passport={
                "core": {"problem": "Команды теряют знания", "solution": "B2B SaaS"},
                "market": {"segment": "Продуктовые команды"},
            },
            readiness_index=65,
        )
        db.add(project)
        await db.commit()
        await db.refresh(project)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Project audit accelerator"), admin, db
        )
        await assign_organizer(
            accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"], CohortCreate(name="Project audit cohort"), organizer, db
        )
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(
                version=1,
                modules={"project_audit": True, "progress_tracking": True},
            ),
            organizer,
            db,
        )
        await update_cohort_status(
            cohort["id"], StatusUpdate(status="accepting"), organizer, db
        )
        application = await submit_application(
            cohort["id"],
            ApplicationCreate(
                project_id=project.id,
                form_payload={"project_name": project.name, "traction": "12 интервью"},
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
        membership_id = accepted["membership_id"]
        await assign_tracker(
            cohort["id"],
            TrackerAssign(user_id=tracker.id, membership_ids=[membership_id]),
            organizer,
            db,
        )
        await assign_resident_quota(
            membership_id,
            ResidentQuotaAssign(
                limits=ResidentQuotaLimits(messages=10, roadmaps=1, custdev=2, grants=0)
            ),
            admin,
            db,
        )

        generated_results = [
            ProjectAuditGeneratedResult(
                summary="Гипотеза проблемы описана, но сегмент слишком широкий.",
                overall_score=60,
                strengths=["Проблема сформулирована"],
                findings=[{
                    "title": "Слабая сегментация",
                    "description": "Сегмент требует сужения.",
                    "severity": "high",
                    "evidence": "В паспорте указан общий сегмент.",
                }],
                recommendations=[{
                    "title": "Провести пять интервью",
                    "description": "Проверить проблему на одном подсегменте.",
                    "priority": "high",
                    "expected_result": "Пять протоколов и решение по сегменту.",
                }],
                data_gaps=["Нет метрик конверсии"],
            ),
            ProjectAuditGeneratedResult(
                summary="Сегмент уточнён, нужно проверить монетизацию.",
                overall_score=75,
                strengths=["Сегмент подтверждён интервью"],
                findings=[{
                    "title": "Не проверена цена",
                    "description": "Нет подтверждения готовности платить.",
                    "severity": "medium",
                }],
                recommendations=[{
                    "title": "Провести тест цены",
                    "description": "Предложить пилот трём клиентам.",
                    "priority": "high",
                    "expected_result": "Не менее одного оплаченного пилота.",
                }],
                data_gaps=[],
            ),
        ]
        calls = []

        async def fake_generate_project_audit(**kwargs):
            calls.append(kwargs)
            return generated_results[len(calls) - 1]

        monkeypatch.setattr(
            "routers.accelerators.generate_project_audit", fake_generate_project_audit
        )
        first = await create_project_audit(
            membership_id,
            ProjectAuditCreate(
                audit_type="product",
                focus="Проверить доказательства спроса",
                client_request_id=f"audit-{suffix}-first",
            ),
            BackgroundTasks(),
            resident,
            db,
        )
        assert first["status"] == "completed"
        assert first["overall_score"] == 60
        assert first["quota"]["consumed"] is True
        assert calls[0]["project_snapshot"]["project"]["passport"]["core"]["solution"] == "B2B SaaS"

        repeated = await create_project_audit(
            membership_id,
            ProjectAuditCreate(
                audit_type="product",
                client_request_id=f"audit-{suffix}-first",
            ),
            BackgroundTasks(),
            resident,
            db,
        )
        assert repeated["id"] == first["id"]
        assert len(calls) == 1

        second = await create_project_audit(
            membership_id,
            ProjectAuditCreate(
                audit_type="product",
                client_request_id=f"audit-{suffix}-second",
            ),
            BackgroundTasks(),
            tracker,
            db,
        )
        assert second["overall_score"] == 75
        resident_history = await list_membership_project_audits(
            membership_id, resident, db
        )
        assert resident_history["audits"][0]["comparison"]["score_delta"] == 15
        assert resident_history["audits"][0]["comparison"]["resolved_findings"] == [
            "Слабая сегментация"
        ]
        tracker_history = await list_cohort_project_audits(cohort["id"], tracker, db)
        assert {row["id"] for row in tracker_history["audits"]} == {
            first["id"], second["id"]
        }
        with pytest.raises(HTTPException) as outsider_history:
            await list_membership_project_audits(membership_id, outsider, db)
        assert outsider_history.value.status_code == 403

        task_link = await create_project_audit_task(
            second["id"],
            ProjectAuditTaskCreate(recommendation_index=0),
            BackgroundTasks(),
            tracker,
            db,
        )
        assert task_link["task"]["title"] == "Провести тест цены"
        with pytest.raises(HTTPException) as resident_task:
            await create_project_audit_task(
                second["id"],
                ProjectAuditTaskCreate(recommendation_index=0),
                BackgroundTasks(),
                resident,
                db,
            )
        assert resident_task.value.status_code == 403
        assert (await db.execute(select(func.count(AcceleratorProjectAuditTaskLink.id)).where(
            AcceleratorProjectAuditTaskLink.audit_id == second["id"]
        ))).scalar_one() == 1

        with pytest.raises(HTTPException) as exhausted:
            await create_project_audit(
                membership_id,
                ProjectAuditCreate(
                    audit_type="market",
                    client_request_id=f"audit-{suffix}-exhausted",
                ),
                BackgroundTasks(),
                organizer,
                db,
            )
        assert exhausted.value.status_code == 402
        assert len(calls) == 2
        assert (await db.execute(select(func.count(AcceleratorQuotaUsageEvent.id)).where(
            AcceleratorQuotaUsageEvent.membership_id == membership_id,
            AcceleratorQuotaUsageEvent.resource == "custdev",
            AcceleratorQuotaUsageEvent.reference_type == "accelerator_project_audit",
        ))).scalar_one() == 2
        assert (await db.execute(select(func.count(AcceleratorProjectAudit.id)).where(
            AcceleratorProjectAudit.membership_id == membership_id
        ))).scalar_one() == 2
        audit_actions = set((await db.execute(select(AcceleratorAuditLog.action).where(
            AcceleratorAuditLog.accelerator_id == accelerator["id"]
        ))).scalars().all())
        assert {
            "project_audit.requested",
            "project_audit.completed",
            "project_audit.task_created",
        } <= audit_actions


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
        attendance = (await db.execute(select(AcceleratorAttendanceRecord).where(
            AcceleratorAttendanceRecord.event_id == event["id"],
            AcceleratorAttendanceRecord.membership_id == membership_id,
        ))).scalar_one()
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


@pytest.mark.asyncio
async def test_demo_day_selection_scoring_ranking_and_exports():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-demo-{suffix}@example.test", name="Admin", is_admin=True)
        organizer = User(email=f"organizer-demo-{suffix}@example.test", name="Organizer")
        resident = User(email=f"resident-demo-{suffix}@example.test", name="Resident")
        expert = User(email=f"expert-demo-{suffix}@example.test", name="Expert")
        outsider = User(email=f"outsider-demo-{suffix}@example.test", name="Outsider")
        db.add_all([admin, organizer, resident, expert, outsider])
        await db.commit()
        for person in (admin, organizer, resident, expert, outsider):
            await db.refresh(person)

        project = Project(
            user_id=resident.id,
            name="Demo project",
            passport={"core": {"problem": "Ручной процесс", "solution": "Автоматизация"}},
            readiness_index=80,
        )
        db.add(project)
        await db.commit()
        await db.refresh(project)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Demo day accelerator"), admin, db
        )
        await assign_organizer(
            accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"], CohortCreate(name="Demo day cohort"), organizer, db
        )
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=1, modules={"demo_day": True}),
            organizer,
            db,
        )
        await update_cohort_status(
            cohort["id"], StatusUpdate(status="accepting"), organizer, db
        )
        application = await submit_application(
            cohort["id"],
            ApplicationCreate(
                project_id=project.id,
                form_payload={"project_name": project.name},
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
        membership_id = accepted["membership_id"]

        stage = await create_program_stage(
            cohort["id"], ProgramStageCreate(title="Проверка проблемы"), organizer, db
        )
        await publish_program_stage(stage["id"], organizer, db)
        await complete_program_stage(stage["id"], resident, db)

        demo_day = await create_demo_day(
            cohort["id"],
            DemoDayCreate(
                title="Demo Day 2026",
                criteria=[
                    DemoDayCriterion(key="problem", label="Проблема", weight=60, max_score=10),
                    DemoDayCriterion(key="market", label="Рынок", weight=40, max_score=10),
                ],
            ),
            organizer,
            db,
        )
        selected = await select_demo_day_project(
            demo_day["id"],
            DemoDayProjectSelect(
                membership_id=membership_id,
                selection_reason="Завершён обязательный этап",
            ),
            BackgroundTasks(),
            organizer,
            db,
        )
        demo_project_id = selected["projects"][0]["id"]
        await assign_demo_day_expert(
            demo_day["id"],
            DemoDayExpertAssign(user_id=expert.id),
            BackgroundTasks(),
            organizer,
            db,
        )

        expert_accelerators = await list_accelerators(expert, db)
        assert expert_accelerators[0]["access_role"] == "expert"
        assert [row["id"] for row in await list_cohorts(accelerator["id"], expert, db)] == [
            cohort["id"]
        ]
        expert_days = await list_cohort_demo_days(cohort["id"], expert, db)
        assert expert_days["access_role"] == "expert"
        with pytest.raises(HTTPException) as outsider_access:
            await list_cohort_demo_days(cohort["id"], outsider, db)
        assert outsider_access.value.status_code == 403

        await update_demo_day_status(
            demo_day["id"], DemoDayStatusUpdate(status="open"), BackgroundTasks(), organizer, db
        )
        await update_demo_day_materials(
            demo_project_id,
            DemoDayMaterialsUpdate(
                pitch_title="Demo project pitch",
                summary="Автоматизируем ручной процесс для продуктовых команд.",
                presentation_url="https://example.test/pitch.pdf",
                video_url="https://example.test/video",
                attachments=["https://example.test/metrics"],
            ),
            BackgroundTasks(),
            resident,
            db,
        )
        await update_demo_day_status(
            demo_day["id"], DemoDayStatusUpdate(status="scoring"), BackgroundTasks(), organizer, db
        )
        with pytest.raises(HTTPException) as organizer_score:
            await upsert_demo_day_score(
                demo_project_id,
                DemoDayScoreUpsert(
                    scores={"problem": 10, "market": 8}, recommendation="advance"
                ),
                organizer,
                db,
            )
        assert organizer_score.value.status_code == 403
        scored = await upsert_demo_day_score(
            demo_project_id,
            DemoDayScoreUpsert(
                scores={"problem": 10, "market": 8},
                comment="Есть подтверждённая проблема.",
                recommendation="advance",
            ),
            expert,
            db,
        )
        assert scored["projects"][0]["evaluations"][0]["normalized_score"] == 92

        await update_demo_day_project_decision(
            demo_project_id,
            DemoDayProjectDecision(
                score_adjustment=3,
                outcome="winner",
                manager_note="Решение жюри",
            ),
            organizer,
            db,
        )
        finalized = await update_demo_day_status(
            demo_day["id"],
            DemoDayStatusUpdate(status="finalized"),
            BackgroundTasks(),
            organizer,
            db,
        )
        assert finalized["projects"][0]["rank"] == 1
        assert finalized["projects"][0]["final_score"] == 95
        assert finalized["projects"][0]["outcome"] == "winner"

        resident_days = await list_membership_demo_days(membership_id, resident, db)
        assert resident_days["demo_days"][0]["projects"][0]["rank"] == 1
        assert resident_days["demo_days"][0]["projects"][0]["evaluations"] == []

        csv_export = await export_demo_day(demo_day["id"], "csv", organizer, db)
        csv_text = csv_export.body.decode("utf-8")
        assert "Demo project" in csv_text
        assert "winner" in csv_text
        json_export = await export_demo_day(demo_day["id"], "json", organizer, db)
        cards = json.loads(json_export.body)
        assert cards["project_cards"][0]["passport"]["core"]["solution"] == "Автоматизация"

        assert (await db.execute(select(func.count(AcceleratorDemoDay.id)).where(
            AcceleratorDemoDay.cohort_id == cohort["id"]
        ))).scalar_one() == 1
        assert (await db.execute(select(func.count(AcceleratorDemoDayProject.id)).where(
            AcceleratorDemoDayProject.demo_day_id == demo_day["id"]
        ))).scalar_one() == 1
        assert (await db.execute(select(func.count(AcceleratorDemoDayScore.id)).where(
            AcceleratorDemoDayScore.demo_project_id == demo_project_id
        ))).scalar_one() == 1
        audit_actions = set((await db.execute(select(AcceleratorAuditLog.action).where(
            AcceleratorAuditLog.accelerator_id == accelerator["id"]
        ))).scalars().all())
        assert {
            "demo_day.created",
            "demo_day.project_selected",
            "demo_day.expert_assigned",
            "demo_day.materials_submitted",
            "demo_day.score_submitted",
            "demo_day.decision_updated",
            "demo_day.status_changed",
        } <= audit_actions


@pytest.mark.asyncio
async def test_stage_actions_artifacts_access_completion_and_visibility():
    suffix = uuid.uuid4().hex
    async with AsyncSessionLocal() as db:
        admin = User(
            email=f"admin-artifacts-{suffix}@example.test",
            name="Admin",
            is_admin=True,
        )
        organizer = User(
            email=f"organizer-artifacts-{suffix}@example.test",
            name="Organizer",
        )
        resident = User(
            email=f"resident-artifacts-{suffix}@example.test",
            name="Resident",
        )
        other_resident = User(
            email=f"other-artifacts-{suffix}@example.test",
            name="Other resident",
        )
        tracker = User(
            email=f"tracker-artifacts-{suffix}@example.test",
            name="Tracker",
        )
        db.add_all([admin, organizer, resident, other_resident, tracker])
        await db.commit()
        for person in (admin, organizer, resident, other_resident, tracker):
            await db.refresh(person)

        project = Project(
            user_id=resident.id,
            name="Artifact project",
            passport={"core": {"problem": "Manual work", "solution": "Automation"}},
            readiness_index=60,
        )
        other_project = Project(
            user_id=other_resident.id,
            name="Other artifact project",
            passport={"core": {"problem": "Other problem", "solution": "Other solution"}},
            readiness_index=40,
        )
        db.add_all([project, other_project])
        await db.commit()
        await db.refresh(project)
        await db.refresh(other_project)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Artifacts accelerator"), admin, db
        )
        await assign_organizer(
            accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"], CohortCreate(name="Artifacts cohort"), organizer, db
        )
        await update_cohort_status(
            cohort["id"], StatusUpdate(status="accepting"), organizer, db
        )

        membership_ids: dict[int, int] = {}
        for person, resident_project in (
            (resident, project),
            (other_resident, other_project),
        ):
            application = await submit_application(
                cohort["id"],
                ApplicationCreate(
                    project_id=resident_project.id,
                    form_payload={"project_name": resident_project.name},
                    accept_privacy=True,
                    accept_program_rules=True,
                ),
                person,
                db,
            )
            accepted = await accept_application(
                application["id"],
                ApplicationReview(),
                BackgroundTasks(),
                organizer,
                db,
            )
            await enroll_application(application["id"], organizer, db)
            membership_ids[person.id] = accepted["membership_id"]

        membership_id = membership_ids[resident.id]
        await assign_tracker(
            cohort["id"],
            TrackerAssign(user_id=tracker.id, membership_ids=[membership_id]),
            organizer,
            db,
        )

        first_stage = await create_program_stage(
            cohort["id"],
            ProgramStageCreate(
                title="Validate the problem",
                actions=[
                    ProgramActionCreate(
                        action_type="chat",
                        title="Discuss interview evidence",
                        required=True,
                    )
                ],
            ),
            organizer,
            db,
        )
        second_stage = await create_program_stage(
            cohort["id"],
            ProgramStageCreate(
                title="Build the plan",
                actions=[
                    ProgramActionCreate(
                        action_type="chat",
                        title="Plan next experiments",
                    )
                ],
            ),
            organizer,
            db,
        )
        await publish_program_stage(first_stage["id"], organizer, db)
        await publish_program_stage(second_stage["id"], organizer, db)
        first_action_id = first_stage["actions"][0]["id"]
        second_action_id = second_stage["actions"][0]["id"]

        # Actions are hidden and cannot be launched while the module is disabled.
        disabled_program = await list_resident_program_stages(
            membership_id, resident, db
        )
        assert disabled_program[0]["actions"] == []
        with pytest.raises(HTTPException) as module_disabled:
            await launch_program_action(first_action_id, resident, db)
        assert module_disabled.value.status_code == 409

        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=1, modules={"pitchy_artifacts": True}),
            organizer,
            db,
        )

        # A later required stage cannot be used before the previous one is done.
        with pytest.raises(HTTPException) as unavailable_stage:
            await launch_program_action(second_action_id, resident, db)
        assert unavailable_stage.value.status_code == 409
        assert "закрыт" in unavailable_stage.value.detail

        launched = await launch_program_action(first_action_id, resident, db)
        artifact_id = launched["artifact"]["id"]
        own_chat_id = launched["artifact"]["source_id"]
        assert launched["artifact"]["membership_id"] == membership_id
        assert launched["artifact"]["project_id"] == project.id
        assert launched["artifact"]["status"] == "started"
        assert launched["launch_url"].endswith(f"session={own_chat_id}")

        repeated = await launch_program_action(first_action_id, resident, db)
        assert repeated["artifact"]["id"] == artifact_id
        assert repeated["artifact"]["source_id"] == own_chat_id
        assert repeated["launch_url"].endswith(f"session={own_chat_id}")
        assert (await db.execute(select(func.count(AcceleratorArtifact.id)).where(
            AcceleratorArtifact.action_id == first_action_id,
            AcceleratorArtifact.membership_id == membership_id,
        ))).scalar_one() == 1
        assert (await db.execute(select(func.count(ChatSession.id)).where(
            ChatSession.user_id == resident.id,
            ChatSession.project_id == project.id,
        ))).scalar_one() == 1
        launched_chat = await db.get(ChatSession, int(own_chat_id))
        assert launched_chat.accelerator_membership_id == membership_id
        assert launched_chat.accelerator_action_id == first_action_id

        # A required action blocks stage completion until its artifact is ready.
        with pytest.raises(HTTPException) as required_action:
            await complete_program_stage(first_stage["id"], resident, db)
        assert required_action.value.status_code == 409
        assert "обязательные действия" in required_action.value.detail

        other_launch = await launch_program_action(
            first_action_id, other_resident, db
        )
        with pytest.raises(HTTPException) as artifact_owner:
            await update_program_artifact(
                artifact_id,
                AcceleratorArtifactUpdate(
                    status="ready",
                    source_type="chat_session",
                    source_id=other_launch["artifact"]["source_id"],
                ),
                other_resident,
                db,
            )
        assert artifact_owner.value.status_code == 404

        with pytest.raises(HTTPException) as another_owner_source:
            await update_program_artifact(
                artifact_id,
                AcceleratorArtifactUpdate(
                    status="ready",
                    source_type="chat_session",
                    source_id=other_launch["artifact"]["source_id"],
                ),
                resident,
                db,
            )
        assert another_owner_source.value.status_code == 404

        unrelated_project = Project(
            user_id=resident.id,
            name="Unrelated resident project",
            passport={"core": {"problem": "Not the accelerator project"}},
            readiness_index=10,
        )
        db.add(unrelated_project)
        await db.flush()
        unrelated_chat = ChatSession(
            user_id=resident.id,
            project_id=unrelated_project.id,
            title="Wrong project chat",
        )
        db.add(unrelated_chat)
        await db.commit()
        await db.refresh(unrelated_chat)
        with pytest.raises(HTTPException) as cross_project_source:
            await update_program_artifact(
                artifact_id,
                AcceleratorArtifactUpdate(
                    status="ready",
                    source_type="chat_session",
                    source_id=str(unrelated_chat.id),
                ),
                resident,
                db,
            )
        assert cross_project_source.value.status_code == 404

        # Private details are redacted for both organizer and assigned tracker.
        organizer_private = await list_cohort_program_artifacts(
            cohort["id"], organizer, db
        )
        organizer_private_row = next(
            row for row in organizer_private["artifacts"] if row["id"] == artifact_id
        )
        assert organizer_private_row["details_visible"] is False
        assert "url" not in organizer_private_row
        assert "source_id" not in organizer_private_row

        tracker_private = await list_cohort_program_artifacts(
            cohort["id"], tracker, db
        )
        assert [row["id"] for row in tracker_private["artifacts"]] == [artifact_id]
        assert tracker_private["artifacts"][0]["details_visible"] is False
        assert "summary" not in tracker_private["artifacts"][0]

        db.add(ChatMessage(
            session_id=int(own_chat_id),
            role="user",
            content="Five interviews confirmed the problem.",
        ))
        await db.commit()
        synced = await sync_program_artifact(artifact_id, resident, db)
        assert synced["status"] == "ready"
        assert synced["source_id"] == own_chat_id

        # A partial visibility update preserves the canonical source and status.
        ready = await update_program_artifact(
            artifact_id,
            AcceleratorArtifactUpdate(
                title="Validated interview evidence",
                summary="Five interviews confirmed the problem.",
                share_with_organizer=True,
                share_with_tracker=False,
            ),
            resident,
            db,
        )
        assert ready["status"] == "ready"
        assert ready["visibility"] == {"organizer": True, "tracker": False}

        organizer_shared = await list_cohort_program_artifacts(
            cohort["id"], organizer, db
        )
        organizer_shared_row = next(
            row for row in organizer_shared["artifacts"] if row["id"] == artifact_id
        )
        assert organizer_shared_row["details_visible"] is True
        assert organizer_shared_row["summary"] == "Five interviews confirmed the problem."
        assert "source_id" not in organizer_shared_row
        assert "url" not in organizer_shared_row

        tracker_redacted = await list_cohort_program_artifacts(
            cohort["id"], tracker, db
        )
        assert tracker_redacted["artifacts"][0]["details_visible"] is False
        assert "url" not in tracker_redacted["artifacts"][0]
        assert "source_id" not in tracker_redacted["artifacts"][0]

        completed = await complete_program_stage(first_stage["id"], resident, db)
        assert completed == {"stage_id": first_stage["id"], "completed": True}
        available_program = await list_resident_program_stages(
            membership_id, resident, db
        )
        assert [row["state"] for row in available_program] == [
            "completed",
            "available",
        ]

        audit_actions = set((await db.execute(select(AcceleratorAuditLog.action).where(
            AcceleratorAuditLog.accelerator_id == accelerator["id"]
        ))).scalars().all())
        assert {"artifact.launched", "artifact.updated", "program_stage.completed"} <= audit_actions
