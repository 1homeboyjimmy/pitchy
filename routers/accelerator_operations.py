"""Aggregate cohort operations and global-admin runtime controls."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from accelerator_operations_service import (
    cohort_analytics,
    cohort_health,
    list_runtime_overrides,
    runtime_disabled_modules,
    update_runtime_override,
)
from auth import get_async_current_user
from db_async import get_async_db
from models import AcceleratorCohort, User
from schemas.accelerator_operations import RuntimeOverrideUpdate


router = APIRouter(prefix="/api/accelerators", tags=["accelerator-operations"])


async def _cohort(db: AsyncSession, cohort_id: int) -> AcceleratorCohort:
    from fastapi import HTTPException

    row = await db.get(AcceleratorCohort, cohort_id)
    if not row:
        raise HTTPException(status_code=404, detail="Поток не найден")
    return row


@router.get("/cohorts/{cohort_id}/analytics")
async def get_cohort_analytics(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await _cohort(db, cohort_id)
    return await cohort_analytics(db, cohort=cohort, user=user)


@router.get("/cohorts/{cohort_id}/operations-health")
async def get_cohort_operations_health(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await _cohort(db, cohort_id)
    return await cohort_health(db, cohort=cohort, user=user)


@router.get("/cohorts/{cohort_id}/runtime-modules")
async def get_cohort_runtime_modules(
    cohort_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    cohort = await _cohort(db, cohort_id)
    from accelerator_service import require_cohort_reader

    await require_cohort_reader(db, user, cohort)
    return {"disabled_modules": await runtime_disabled_modules(db, cohort=cohort)}


@router.get("/runtime-overrides")
async def get_runtime_overrides(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    return {"overrides": await list_runtime_overrides(db, user=user)}


@router.put("/runtime-overrides")
async def put_runtime_override(
    payload: RuntimeOverrideUpdate,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    await update_runtime_override(db, payload=payload, user=user)
    await db.commit()
    return {"overrides": await list_runtime_overrides(db, user=user)}
