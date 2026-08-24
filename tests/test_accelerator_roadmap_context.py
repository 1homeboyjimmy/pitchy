from __future__ import annotations

import uuid

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select

from db_async import AsyncSessionLocal
from models import (
    AcceleratorArtifact,
    AcceleratorProgramAction,
    AcceleratorProgramStage,
    AcceleratorQuotaUsageEvent,
    Project,
    User,
)
from projects_router import analyze_roadmap_overall, delete_project
from routers.accelerators import (
    accept_application,
    assign_resident_quota,
    create_accelerator,
    create_cohort,
    enroll_application,
    submit_application,
    update_cohort_status,
    update_program_config,
)
from schemas.accelerators import (
    AcceleratorCreate,
    ApplicationCreate,
    ApplicationReview,
    CohortCreate,
    ResidentQuotaAssign,
    ResidentQuotaLimits,
    StatusUpdate,
    ProgramConfigUpdate,
)


async def _close_stream(response) -> None:
    close = getattr(response.body_iterator, "aclose", None)
    if close:
        await close()


@pytest.mark.asyncio
async def test_contextual_roadmap_debits_exact_membership_once_and_checks_ownership():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-roadmap-{suffix}@example.test", name="Admin", is_admin=True)
        resident = User(email=f"resident-roadmap-{suffix}@example.test", name="Resident")
        outsider = User(email=f"outsider-roadmap-{suffix}@example.test", name="Outsider")
        db.add_all([admin, resident, outsider])
        await db.commit()
        for row in (admin, resident, outsider):
            await db.refresh(row)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Roadmap accelerator"), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"],
            CohortCreate(
                name="Roadmap cohort",
                application_form_schema={"required": ["project"]},
            ),
            admin,
            db,
        )
        await update_cohort_status(cohort["id"], StatusUpdate(status="accepting"), admin, db)
        application = await submit_application(
            cohort["id"],
            ApplicationCreate(
                form_payload={"project": "Context project"},
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
                limits=ResidentQuotaLimits(messages=0, roadmaps=2, custdev=0, grants=0)
            ),
            admin,
            db,
        )
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=1, modules={"pitchy_artifacts": True}),
            admin,
            db,
        )

        stage = AcceleratorProgramStage(
            cohort_id=cohort["id"],
            title="Проверка стратегии",
            position=1,
            status="published",
            created_by_user_id=admin.id,
            updated_by_user_id=admin.id,
        )
        db.add(stage)
        await db.flush()
        action = AcceleratorProgramAction(
            stage_id=stage.id,
            action_type="roadmap",
            title="Сформировать дорожную карту",
            position=1,
        )
        db.add(action)
        await db.flush()
        db.add(AcceleratorArtifact(
            action_id=action.id,
            membership_id=accepted["membership_id"],
            project_id=accepted["project_id"],
            artifact_type="roadmap",
            status="started",
            title=action.title,
            visibility={},
        ))
        outsider_project = Project(user_id=outsider.id, name="Foreign project", passport={})
        db.add(outsider_project)
        await db.commit()
        await db.refresh(action)
        await db.refresh(outsider_project)

        response = await analyze_roadmap_overall(
            project_id=accepted["project_id"],
            accelerator_membership=accepted["membership_id"],
            accelerator_action=action.id,
            user=resident,
            db=db,
        )
        await _close_stream(response)
        repeated = await analyze_roadmap_overall(
            project_id=accepted["project_id"],
            accelerator_membership=accepted["membership_id"],
            accelerator_action=action.id,
            user=resident,
            db=db,
        )
        await _close_stream(repeated)

        usage_count = (await db.execute(select(func.count(AcceleratorQuotaUsageEvent.id)).where(
            AcceleratorQuotaUsageEvent.membership_id == accepted["membership_id"],
            AcceleratorQuotaUsageEvent.resource == "roadmaps",
        ))).scalar_one()
        assert usage_count == 1
        event = (await db.execute(select(AcceleratorQuotaUsageEvent).where(
            AcceleratorQuotaUsageEvent.membership_id == accepted["membership_id"],
            AcceleratorQuotaUsageEvent.resource == "roadmaps",
        ))).scalar_one()
        assert event.reference_type == "accelerator_program_action"
        assert event.reference_id == str(action.id)
        assert event.event_metadata == {
            "project_id": accepted["project_id"],
            "action_type": "roadmap",
        }

        # No accelerator context uses the normal quota path and spends a
        # separate roadmap unit instead of reusing the program action debit.
        ordinary = await analyze_roadmap_overall(
            project_id=accepted["project_id"],
            accelerator_membership=None,
            accelerator_action=None,
            request_id=f"ordinary-{suffix}",
            user=resident,
            db=db,
        )
        await _close_stream(ordinary)
        assert (await db.execute(select(func.count(AcceleratorQuotaUsageEvent.id)).where(
            AcceleratorQuotaUsageEvent.membership_id == accepted["membership_id"],
            AcceleratorQuotaUsageEvent.resource == "roadmaps",
        ))).scalar_one() == 2

        with pytest.raises(HTTPException) as foreign_context:
            await analyze_roadmap_overall(
                project_id=outsider_project.id,
                accelerator_membership=accepted["membership_id"],
                accelerator_action=action.id,
                request_id=None,
                user=outsider,
                db=db,
            )
        assert foreign_context.value.status_code == 404

        with pytest.raises(HTTPException) as incomplete_context:
            await analyze_roadmap_overall(
                project_id=accepted["project_id"],
                accelerator_membership=accepted["membership_id"],
                accelerator_action=None,
                request_id=None,
                user=resident,
                db=db,
            )
        assert incomplete_context.value.status_code == 422

        second_action = AcceleratorProgramAction(
            stage_id=stage.id,
            action_type="roadmap",
            title="Повторный анализ",
            position=2,
        )
        db.add(second_action)
        await db.flush()
        db.add(AcceleratorArtifact(
            action_id=second_action.id,
            membership_id=accepted["membership_id"],
            project_id=accepted["project_id"],
            artifact_type="roadmap",
            status="started",
            title=second_action.title,
            visibility={},
        ))
        await db.commit()
        await db.refresh(second_action)
        with pytest.raises(HTTPException) as exhausted:
            await analyze_roadmap_overall(
                project_id=accepted["project_id"],
                accelerator_membership=accepted["membership_id"],
                accelerator_action=second_action.id,
                request_id=None,
                user=resident,
                db=db,
            )
        assert exhausted.value.status_code == 402

        with pytest.raises(HTTPException) as protected_project:
            await delete_project(accepted["project_id"], resident, db)
        assert protected_project.value.status_code == 409
        assert "Архивируйте" in protected_project.value.detail
