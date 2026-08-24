from __future__ import annotations

from datetime import date
import uuid

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select

from db_async import AsyncSessionLocal
from models import (
    AcceleratorAlumniCheckin,
    AcceleratorAlumniProfile,
    AcceleratorCohort,
    AcceleratorMembership,
    AcceleratorNotificationOutbox,
    AcceleratorResidentSnapshot,
    User,
)
from routers.accelerator_alumni import (
    delete_membership_alumni_profile,
    get_cohort_alumni,
    get_cohort_closure,
    get_membership_alumni_checkins,
    get_membership_alumni_profile,
    get_membership_closure_snapshot,
    post_complete_cohort_closure,
    post_prepare_cohort_closure,
    put_cohort_closure_decision,
    put_membership_alumni_checkin,
    put_membership_alumni_profile,
)
from routers.accelerators import (
    accept_application,
    assign_organizer,
    create_accelerator,
    create_cohort,
    enroll_application,
    submit_application,
    update_cohort_status,
    update_program_config,
)
from schemas.accelerator_alumni import (
    AlumniCheckinUpsert,
    AlumniProfileUpdate,
    CohortClosureComplete,
    ClosureDecisionUpdate,
)
from schemas.accelerators import (
    AcceleratorCreate,
    ApplicationCreate,
    ApplicationReview,
    CohortCreate,
    OrganizerAssign,
    ProgramConfigUpdate,
    StatusUpdate,
)


async def _context(db, suffix: str):
    admin = User(email=f"alumni-admin-{suffix}@example.test", name="Alumni admin", is_admin=True)
    organizer = User(email=f"alumni-organizer-{suffix}@example.test", name="Alumni organizer")
    first = User(email=f"alumni-first-{suffix}@example.test", name="First founder")
    second = User(email=f"alumni-second-{suffix}@example.test", name="Second founder")
    outsider = User(email=f"alumni-outsider-{suffix}@example.test", name="Outsider")
    db.add_all([admin, organizer, first, second, outsider])
    await db.commit()
    accelerator = await create_accelerator(
        AcceleratorCreate(name=f"Alumni accelerator {suffix}"), admin, db
    )
    await assign_organizer(
        accelerator["id"], OrganizerAssign(user_id=organizer.id), admin, db
    )
    cohort = await create_cohort(
        accelerator["id"], CohortCreate(name=f"Alumni cohort {suffix}"), organizer, db
    )
    await update_program_config(
        cohort["id"],
        ProgramConfigUpdate(version=1, modules={"alumni": True}),
        organizer,
        db,
    )
    await update_cohort_status(
        cohort["id"], StatusUpdate(status="accepting"), organizer, db
    )
    memberships = []
    for person in (first, second):
        application = await submit_application(
            cohort["id"],
            ApplicationCreate(
                form_payload={"project_name": f"Project {person.name}"},
                application_type="project",
                accept_privacy=True,
                accept_program_rules=True,
            ),
            person,
            db,
        )
        accepted = await accept_application(
            application["id"], ApplicationReview(), BackgroundTasks(), organizer, db
        )
        await enroll_application(application["id"], organizer, db)
        memberships.append(accepted["membership_id"])
    await update_cohort_status(cohort["id"], StatusUpdate(status="active"), organizer, db)
    return admin, organizer, first, second, outsider, accelerator, cohort, memberships


@pytest.mark.asyncio
async def test_explicit_cohort_closure_snapshots_and_opt_in_alumni_privacy():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, first, second, outsider, _, cohort, membership_ids = await _context(db, suffix)

        with pytest.raises(HTTPException) as generic_completion:
            await update_cohort_status(
                cohort["id"], StatusUpdate(status="completed"), organizer, db
            )
        assert generic_completion.value.status_code == 409

        preview = await get_cohort_closure(cohort["id"], organizer, db)
        assert preview["closure"] is None
        assert preview["missing_decision_membership_ids"] == membership_ids
        prepared = await post_prepare_cohort_closure(cohort["id"], organizer, db)
        assert prepared["closure"]["status"] == "preparing"

        await put_cohort_closure_decision(
            cohort["id"], membership_ids[0],
            ClosureDecisionUpdate(outcome="completed", reason="Program completed"),
            organizer, db,
        )
        with pytest.raises(HTTPException) as missing_decision:
            await post_complete_cohort_closure(
                cohort["id"], CohortClosureComplete(summary="Results"),
                BackgroundTasks(), organizer, db,
            )
        assert missing_decision.value.status_code == 409
        await put_cohort_closure_decision(
            cohort["id"], membership_ids[1],
            ClosureDecisionUpdate(outcome="withdrawn", reason="Left before graduation"),
            organizer, db,
        )
        completed = await post_complete_cohort_closure(
            cohort["id"], CohortClosureComplete(summary="Cohort results fixed"),
            BackgroundTasks(), organizer, db,
        )
        assert completed["closure"]["status"] == "completed"
        assert completed["missing_decision_membership_ids"] == []
        assert all(row["snapshot_ready"] for row in completed["residents"])
        cohort_row = await db.get(AcceleratorCohort, cohort["id"])
        assert cohort_row.status == "completed"
        membership_rows = list((await db.execute(select(AcceleratorMembership).where(
            AcceleratorMembership.id.in_(membership_ids)
        ).order_by(AcceleratorMembership.id))).scalars().all())
        assert [row.status for row in membership_rows] == ["completed", "withdrawn"]
        assert (await db.execute(select(func.count(AcceleratorResidentSnapshot.id)).where(
            AcceleratorResidentSnapshot.membership_id.in_(membership_ids)
        ))).scalar_one() == 2
        assert (await db.execute(select(func.count(AcceleratorNotificationOutbox.id)).where(
            AcceleratorNotificationOutbox.idempotency_key.like("cohort-completed:%")
        ))).scalar_one() == 2

        own_snapshot = await get_membership_closure_snapshot(membership_ids[0], first, db)
        assert own_snapshot["payload"]["membership"]["outcome"] == "completed"
        assert len(own_snapshot["checksum"]) == 64
        manager_snapshot = await get_membership_closure_snapshot(
            membership_ids[0], organizer, db
        )
        assert manager_snapshot["checksum"] == own_snapshot["checksum"]
        with pytest.raises(HTTPException) as snapshot_outsider:
            await get_membership_closure_snapshot(membership_ids[0], outsider, db)
        assert snapshot_outsider.value.status_code == 403

        with pytest.raises(HTTPException) as no_consent:
            await put_membership_alumni_profile(
                membership_ids[0],
                AlumniProfileUpdate(
                    headline="Founder", achievements=[], expertise=[], interests=[],
                    accept_directory_terms=False,
                ),
                first, db,
            )
        assert no_consent.value.status_code == 422
        with pytest.raises(HTTPException) as unsafe_contact:
            await put_membership_alumni_profile(
                membership_ids[0],
                AlumniProfileUpdate(
                    headline="Founder", achievements=[], expertise=[], interests=[],
                    contact_url="javascript:alert(1)", accept_directory_terms=True,
                ),
                first, db,
            )
        assert unsafe_contact.value.status_code == 422
        profile = await put_membership_alumni_profile(
            membership_ids[0],
            AlumniProfileUpdate(
                headline="SaaS founder",
                bio="Building the next product",
                achievements=["First sales"],
                expertise=["Product"],
                interests=["B2B"],
                contact_url="https://example.test/contact",
                accept_directory_terms=True,
            ),
            first, db,
        )
        assert profile["active"] is True
        directory = await get_cohort_alumni(cohort["id"], first, db)
        assert [row["membership_id"] for row in directory["profiles"]] == [membership_ids[0]]
        assert "email" not in directory["profiles"][0]
        with pytest.raises(HTTPException) as directory_outsider:
            await get_cohort_alumni(cohort["id"], outsider, db)
        assert directory_outsider.value.status_code == 403

        checkin_payload = AlumniCheckinUpsert(
            period_date=date(2026, 8, 1),
            summary="Reached first cohort of customers",
            metrics={"customers": 12, "team_size": 3},
        )
        first_checkin = await put_membership_alumni_checkin(
            membership_ids[0], checkin_payload, first, db
        )
        second_checkin = await put_membership_alumni_checkin(
            membership_ids[0],
            AlumniCheckinUpsert(
                period_date=date(2026, 8, 1),
                summary="Updated customer count",
                metrics={"customers": 15},
            ),
            first, db,
        )
        assert first_checkin["id"] == second_checkin["id"]
        manager_checkins = await get_membership_alumni_checkins(
            membership_ids[0], organizer, db
        )
        assert len(manager_checkins["checkins"]) == 1
        assert manager_checkins["checkins"][0]["metrics"] == {"customers": 15}

        response = await delete_membership_alumni_profile(membership_ids[0], first, db)
        assert response.status_code == 204
        hidden = await get_membership_alumni_profile(membership_ids[0], first, db)
        assert hidden["active"] is False
        assert hidden["bio"] is None
        assert (await db.execute(select(func.count(AcceleratorAlumniCheckin.id)))).scalar_one() == 0
        assert (await get_cohort_alumni(cohort["id"], organizer, db))["profiles"] == []


@pytest.mark.asyncio
async def test_alumni_module_gate_and_withdrawn_resident_cannot_publish():
    suffix = uuid.uuid4().hex[:10]
    async with AsyncSessionLocal() as db:
        _, organizer, _, second, _, _, cohort, membership_ids = await _context(db, suffix)
        await update_program_config(
            cohort["id"],
            ProgramConfigUpdate(version=2, modules={"alumni": False}),
            organizer,
            db,
        )
        with pytest.raises(HTTPException) as module_off:
            await get_membership_alumni_profile(membership_ids[0], second, db)
        assert module_off.value.status_code == 409
