from __future__ import annotations

from datetime import datetime, timedelta
import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from accelerator_operations_service import active_runtime_override
from db_async import AsyncSessionLocal
from models import (
    AcceleratorAuditLog,
    AcceleratorCohort,
    AcceleratorModuleRuntimeOverride,
    User,
)
from routers.accelerator_operations import (
    get_cohort_analytics,
    get_cohort_operations_health,
    get_cohort_runtime_modules,
    get_runtime_overrides,
    put_runtime_override,
)
from routers.accelerators import (
    assign_organizer,
    create_accelerator,
    create_cohort,
    require_homework_module,
    require_matchmaking_module,
    update_program_config,
)
from schemas.accelerator_operations import RuntimeOverrideUpdate
from schemas.accelerators import (
    AcceleratorCreate,
    CohortCreate,
    OrganizerAssign,
    ProgramConfigUpdate,
)


async def _context(db, suffix: str):
    admin = User(email=f"ops-admin-{suffix}@example.test", name="Ops admin", is_admin=True)
    organizer = User(email=f"ops-organizer-{suffix}@example.test", name="Ops organizer")
    outsider = User(email=f"ops-outsider-{suffix}@example.test", name="Ops outsider")
    db.add_all([admin, organizer, outsider])
    await db.commit()
    accelerator = await create_accelerator(
        AcceleratorCreate(name=f"Ops accelerator {suffix}"), admin, db
    )
    await assign_organizer(
        accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
    )
    first = await create_cohort(
        accelerator["id"], CohortCreate(name=f"Ops cohort {suffix}"), organizer, db
    )
    second = await create_cohort(
        accelerator["id"], CohortCreate(name=f"Other cohort {suffix}"), organizer, db
    )
    for cohort in (first, second):
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=1, modules={"homework": True, "matchmaking": True}),
            organizer,
            db,
        )
    return admin, organizer, outsider, accelerator, first, second


@pytest.mark.asyncio
async def test_aggregate_operations_and_runtime_module_controls():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        admin, organizer, outsider, accelerator, first, second = await _context(db, suffix)

        analytics = await get_cohort_analytics(first["id"], organizer, db)
        health = await get_cohort_operations_health(first["id"], organizer, db)
        assert analytics["cohort_id"] == first["id"]
        assert analytics["applications"] == {}
        assert health["status"] in {"healthy", "warning", "error"}
        serialized = json.dumps({"analytics": analytics, "health": health}, default=str)
        assert organizer.email not in serialized
        assert outsider.email not in serialized

        with pytest.raises(HTTPException) as hidden:
            await get_cohort_analytics(first["id"], outsider, db)
        assert hidden.value.status_code == 403
        with pytest.raises(HTTPException) as organizer_control:
            await put_runtime_override(
                RuntimeOverrideUpdate(
                    scope_type="cohort", scope_id=first["id"], module_key="homework",
                    disabled=True, reason="Maintenance",
                ),
                organizer,
                db,
            )
        assert organizer_control.value.status_code == 403

        result = await put_runtime_override(
            RuntimeOverrideUpdate(
                scope_type="cohort", scope_id=first["id"], module_key="homework",
                disabled=True, reason="Temporary maintenance",
                expires_at=datetime.utcnow() + timedelta(hours=2),
            ),
            admin,
            db,
        )
        assert len(result["overrides"]) == 1
        disabled = await get_cohort_runtime_modules(first["id"], organizer, db)
        assert disabled["disabled_modules"]["homework"]["scope_type"] == "cohort"
        first_row = await db.get(AcceleratorCohort, first["id"])
        second_row = await db.get(AcceleratorCohort, second["id"])
        with pytest.raises(HTTPException) as stopped:
            await require_homework_module(db, first_row)
        assert stopped.value.status_code == 503
        assert await require_homework_module(db, second_row)

        db.add(AcceleratorModuleRuntimeOverride(
            scope_type="cohort",
            scope_key=f"cohort:{first['id']}",
            accelerator_id=accelerator["id"],
            cohort_id=first["id"],
            module_key="project_audit",
            reason="Already expired",
            expires_at=datetime.utcnow() - timedelta(minutes=1),
            updated_by_user_id=admin.id,
        ))
        await db.commit()
        assert await active_runtime_override(
            db, module_key="project_audit", cohort=first_row
        ) is None

        await put_runtime_override(
            RuntimeOverrideUpdate(
                scope_type="global", module_key="matchmaking", disabled=True,
                reason="Platform maintenance",
            ),
            admin,
            db,
        )
        with pytest.raises(HTTPException) as global_stop:
            await require_matchmaking_module(db, second_row)
        assert global_stop.value.status_code == 503

        await put_runtime_override(
            RuntimeOverrideUpdate(
                scope_type="global", module_key="matchmaking", disabled=False,
                reason="Service restored",
            ),
            admin,
            db,
        )
        await put_runtime_override(
            RuntimeOverrideUpdate(
                scope_type="cohort", scope_id=first["id"], module_key="homework",
                disabled=False, reason="Maintenance finished",
            ),
            admin,
            db,
        )
        assert await require_matchmaking_module(db, second_row)
        assert await require_homework_module(db, first_row)
        overrides = await get_runtime_overrides(admin, db)
        assert all(row["module_key"] not in {"homework", "matchmaking"} for row in overrides["overrides"])
        audit_actions = set((await db.execute(select(AcceleratorAuditLog.action).where(
            AcceleratorAuditLog.accelerator_id == accelerator["id"],
            AcceleratorAuditLog.action.in_(("runtime.module_disabled", "runtime.module_enabled")),
        ))).scalars().all())
        assert audit_actions == {"runtime.module_disabled", "runtime.module_enabled"}
