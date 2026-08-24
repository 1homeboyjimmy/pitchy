from __future__ import annotations

import uuid

import pytest
from fastapi import BackgroundTasks, HTTPException

import grants_service
import subscription_service
from db_async import AsyncSessionLocal
from grants_router import generate_application
from models import (
    AcceleratorArtifact,
    AcceleratorProgramAction,
    AcceleratorProgramStage,
    Grant,
    User,
)
from routers.accelerators import (
    accept_application,
    create_accelerator,
    create_cohort,
    enroll_application,
    submit_application,
    update_cohort_status,
    update_program_config,
)
from schemas import GrantApplicationGenerateRequest
from schemas.accelerators import (
    AcceleratorCreate,
    ApplicationCreate,
    ApplicationReview,
    CohortCreate,
    ProgramConfigUpdate,
    StatusUpdate,
)


@pytest.mark.asyncio
async def test_grant_generation_uses_only_a_launched_exact_accelerator_context(monkeypatch):
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-grant-context-{suffix}@example.test", name="Admin", is_admin=True)
        resident = User(email=f"resident-grant-context-{suffix}@example.test", name="Resident")
        db.add_all([admin, resident])
        await db.commit()
        await db.refresh(admin)
        await db.refresh(resident)

        accelerator = await create_accelerator(
            AcceleratorCreate(name="Grant context accelerator"), admin, db
        )
        cohort = await create_cohort(
            accelerator["id"],
            CohortCreate(
                name="Grant context cohort",
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
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=1, modules={"pitchy_artifacts": True}),
            admin,
            db,
        )

        stage = AcceleratorProgramStage(
            cohort_id=cohort["id"],
            title="Грантовая заявка",
            position=1,
            status="published",
            created_by_user_id=admin.id,
            updated_by_user_id=admin.id,
        )
        db.add(stage)
        await db.flush()
        action = AcceleratorProgramAction(
            stage_id=stage.id,
            action_type="grants",
            title="Подготовить заявку",
            position=1,
        )
        db.add(action)
        await db.flush()
        db.add(AcceleratorArtifact(
            action_id=action.id,
            membership_id=accepted["membership_id"],
            project_id=accepted["project_id"],
            artifact_type="grants",
            status="started",
            title=action.title,
            visibility={"organizer": False, "tracker": False},
        ))
        grant = Grant(
            name="Test fund form",
            moderation="approved",
            application_template={
                "key": "test-fund-form",
                "title": "Test fund form",
                "groups": [{"id": "main", "title": "Main", "fields": []}],
            },
        )
        db.add(grant)
        await db.commit()
        await db.refresh(action)
        await db.refresh(grant)

        quota_calls: list[dict] = []

        async def fake_consume_quota(_db, _user, resource, **kwargs):
            quota_calls.append({"resource": resource, **kwargs})
            return True

        async def fake_generate_application(_passport, _grant, *, extra_context):
            return {
                "template_key": "test-fund-form",
                "template_title": "Test fund form",
                "sections": {"summary": "Generated"},
                "section_meta": [],
                "static": {},
                "user_input": [],
                "gaps": [],
            }

        monkeypatch.setattr(subscription_service, "consume_quota", fake_consume_quota)
        monkeypatch.setattr(grants_service, "generate_application", fake_generate_application)
        monkeypatch.setattr(grants_service, "match_grant", lambda _passport, _grant: (80, True, []))

        generated = await generate_application(
            grant.id,
            GrantApplicationGenerateRequest(
                project_id=accepted["project_id"],
                request_id=f"grant-context-{suffix}",
                accelerator_membership_id=accepted["membership_id"],
                accelerator_action_id=action.id,
            ),
            resident,
            db,
        )
        assert generated.status == "generated"
        assert quota_calls == [{
            "resource": "grants",
            "idempotency_key": f"grant:{resident.id}:grant-context-{suffix}",
            "reference_type": "grant_application",
            "reference_id": f"{grant.id}:{accepted['project_id']}",
            "accelerator_membership_id": accepted["membership_id"],
        }]

        unlaunched_action = AcceleratorProgramAction(
            stage_id=stage.id,
            action_type="grants",
            title="Другой грантовый результат",
            position=2,
        )
        db.add(unlaunched_action)
        await db.commit()
        await db.refresh(unlaunched_action)

        with pytest.raises(HTTPException) as missing_artifact:
            await generate_application(
                grant.id,
                GrantApplicationGenerateRequest(
                    project_id=accepted["project_id"],
                    request_id=f"unlaunched-{suffix}",
                    accelerator_membership_id=accepted["membership_id"],
                    accelerator_action_id=unlaunched_action.id,
                ),
                resident,
                db,
            )
        assert missing_artifact.value.status_code == 404
        assert len(quota_calls) == 1

        with pytest.raises(HTTPException) as incomplete_context:
            await generate_application(
                grant.id,
                GrantApplicationGenerateRequest(
                    project_id=accepted["project_id"],
                    request_id=f"incomplete-{suffix}",
                    accelerator_membership_id=accepted["membership_id"],
                ),
                resident,
                db,
            )
        assert incomplete_context.value.status_code == 422
        assert len(quota_calls) == 1
