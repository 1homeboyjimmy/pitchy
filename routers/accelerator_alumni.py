"""Cohort closure and resident-controlled alumni API."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_alumni_service import (
    alumni_checkins_payload,
    cohort_alumni_payload,
    closure_payload,
    complete_closure,
    get_alumni_profile_payload,
    get_cohort,
    opt_out_alumni_profile,
    prepare_closure,
    resident_snapshot_payload,
    upsert_alumni_checkin,
    upsert_alumni_profile,
    upsert_closure_decision,
)
from accelerator_notification_service import process_notification_event
from accelerator_service import require_cohort_manager
from auth import get_async_current_user
from db_async import get_async_db
from models import User
from schemas.accelerator_alumni import (
    AlumniCheckinUpsert,
    AlumniProfileUpdate,
    CohortClosureComplete,
    ClosureDecisionUpdate,
)


router = APIRouter(prefix="/api/accelerators", tags=["accelerator-closure-alumni"])


def _checkin_dict(row) -> dict:
    return {
        "id": row.id,
        "period_date": row.period_date,
        "summary": row.summary,
        "metrics": row.metrics or {},
        "updated_at": row.updated_at,
    }


@router.get("/cohorts/{cohort_id}/closure")
async def get_cohort_closure(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort(db, cohort_id)
    return await closure_payload(db, cohort=cohort, user=user)


@router.post("/cohorts/{cohort_id}/closure/prepare")
async def post_prepare_cohort_closure(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort(db, cohort_id)
    await require_cohort_manager(db, user, cohort)
    await prepare_closure(db, cohort=cohort, user=user)
    await db.commit()
    return await closure_payload(db, cohort=cohort, user=user)


@router.put("/cohorts/{cohort_id}/closure/decisions/{membership_id}")
async def put_cohort_closure_decision(
    cohort_id: int,
    membership_id: int,
    payload: ClosureDecisionUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort(db, cohort_id)
    await upsert_closure_decision(
        db,
        cohort=cohort,
        membership_id=membership_id,
        payload=payload,
        user=user,
    )
    await db.commit()
    return await closure_payload(db, cohort=cohort, user=user)


@router.post("/cohorts/{cohort_id}/closure/complete")
async def post_complete_cohort_closure(
    cohort_id: int,
    payload: CohortClosureComplete,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await get_cohort(db, cohort_id)
    _, notification_ids = await complete_closure(
        db, cohort=cohort, user=user, summary=payload.summary
    )
    await db.commit()
    for notification_id in dict.fromkeys(notification_ids):
        background_tasks.add_task(process_notification_event, notification_id)
    return await closure_payload(db, cohort=cohort, user=user)


@router.get("/memberships/{membership_id}/closure-snapshot")
async def get_membership_closure_snapshot(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await resident_snapshot_payload(db, membership_id=membership_id, user=user)


@router.get("/memberships/{membership_id}/alumni-profile")
async def get_membership_alumni_profile(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await get_alumni_profile_payload(db, membership_id=membership_id, user=user)


@router.put("/memberships/{membership_id}/alumni-profile")
async def put_membership_alumni_profile(
    membership_id: int,
    payload: AlumniProfileUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    await upsert_alumni_profile(
        db, membership_id=membership_id, payload=payload, user=user
    )
    await db.commit()
    return await get_alumni_profile_payload(db, membership_id=membership_id, user=user)


@router.delete(
    "/memberships/{membership_id}/alumni-profile",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_membership_alumni_profile(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    await opt_out_alumni_profile(db, membership_id=membership_id, user=user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/cohorts/{cohort_id}/alumni")
async def get_cohort_alumni(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await cohort_alumni_payload(db, cohort_id=cohort_id, user=user)


@router.get("/memberships/{membership_id}/alumni-checkins")
async def get_membership_alumni_checkins(
    membership_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await alumni_checkins_payload(db, membership_id=membership_id, user=user)


@router.put("/memberships/{membership_id}/alumni-checkins")
async def put_membership_alumni_checkin(
    membership_id: int,
    payload: AlumniCheckinUpsert,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    checkin = await upsert_alumni_checkin(
        db, membership_id=membership_id, payload=payload, user=user
    )
    await db.commit()
    return _checkin_dict(checkin)
