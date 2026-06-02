"""
FastAPI router для грантов (автоподбор + генерация заявок).

REST API:
- GET    /grants                         — каталог (для календаря и блока «сейчас»)
- GET    /grants/match                    — автоподбор под паспорт проекта
- GET    /grants/{id}                     — карточка гранта (+ матч, если задан project_id)
- POST   /grants/{id}/apply               — сгенерировать заявку из паспорта
- GET    /grants/applications             — мои заявки (/grants/my)
- GET    /grants/applications/{app_id}    — одна заявка
- PATCH  /grants/applications/{app_id}    — правка секций/статуса
- POST   /grants                          — создать грант (только админ)

Матчинг живёт в grants_service и читает Project.passport. Скоринг
детерминированный; grant_match_cache зарезервирован под будущее
кэширование (сейчас считаем на лету — корректнее при правках паспорта).
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_async_current_user
from db_async import get_async_db
from models import User, Project, Grant, GrantApplication
from schemas import (
    GrantResponse,
    GrantMatchResponse,
    GrantCreateRequest,
    GrantApplicationGenerateRequest,
    GrantApplicationResponse,
    GrantApplicationUpdateRequest,
)
import grants_service

logger = logging.getLogger("app")

router = APIRouter(prefix="/grants", tags=["Grants"])


async def _get_owned_project(project_id: int, user: User, db: AsyncSession) -> Project:
    res = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Папка проекта не найдена")
    return project


@router.get("", response_model=list[GrantResponse])
async def list_grants(
    status: str | None = Query(None, description="open | upcoming | closed"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[GrantResponse]:
    """Каталог грантов для календаря и блока «сейчас идёт»."""
    q = select(Grant)
    if status:
        q = q.where(Grant.status == status)
    q = q.order_by(Grant.deadline.is_(None), Grant.deadline.asc()).limit(200)
    res = await db.execute(q)
    grants = res.scalars().all()
    return [GrantResponse.model_validate(g) for g in grants]


@router.get("/match", response_model=list[GrantMatchResponse])
async def match_grants(
    project_id: int = Query(..., description="Папка проекта, под которую подбираем"),
    include_closed: bool = False,
    only_eligible: bool = Query(False, description="Только прошедшие hard-фильтр"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[GrantMatchResponse]:
    """Автоподбор грантов под паспорт проекта."""
    project = await _get_owned_project(project_id, user, db)

    q = select(Grant)
    if not include_closed:
        q = q.where(Grant.status != "closed")
    res = await db.execute(q)
    grants = res.scalars().all()

    ranked = grants_service.match_grants(project.passport or {}, grants)
    out = []
    for item in ranked:
        if only_eligible and not item["hard_pass"]:
            continue
        out.append(GrantMatchResponse(
            grant=GrantResponse.model_validate(item["grant"]),
            score=item["score"],
            hard_pass=item["hard_pass"],
            reasons=item["reasons"],
        ))
    return out


@router.get("/applications", response_model=list[GrantApplicationResponse])
async def list_applications(
    project_id: int | None = Query(None),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[GrantApplicationResponse]:
    """Мои заявки (страница /grants/my)."""
    q = select(GrantApplication).where(GrantApplication.user_id == user.id)
    if project_id is not None:
        q = q.where(GrantApplication.project_id == project_id)
    q = q.order_by(GrantApplication.updated_at.desc()).limit(100)
    res = await db.execute(q)
    apps = res.scalars().all()
    return [GrantApplicationResponse.model_validate(a) for a in apps]


@router.get("/applications/{app_id}", response_model=GrantApplicationResponse)
async def get_application(
    app_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantApplicationResponse:
    res = await db.execute(
        select(GrantApplication).where(
            GrantApplication.id == app_id, GrantApplication.user_id == user.id
        )
    )
    app = res.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return GrantApplicationResponse.model_validate(app)


@router.patch("/applications/{app_id}", response_model=GrantApplicationResponse)
async def update_application(
    app_id: int,
    payload: GrantApplicationUpdateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantApplicationResponse:
    res = await db.execute(
        select(GrantApplication).where(
            GrantApplication.id == app_id, GrantApplication.user_id == user.id
        )
    )
    app = res.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if payload.content is not None:
        app.content = payload.content
        flag_modified(app, "content")
    if payload.status is not None:
        if payload.status not in ("draft", "generated", "submitted"):
            raise HTTPException(status_code=400, detail="Недопустимый статус")
        app.status = payload.status
    await db.commit()
    await db.refresh(app)
    return GrantApplicationResponse.model_validate(app)


@router.get("/{grant_id}", response_model=GrantResponse)
async def get_grant(
    grant_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantResponse:
    res = await db.execute(select(Grant).where(Grant.id == grant_id))
    grant = res.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Грант не найден")
    return GrantResponse.model_validate(grant)


@router.post("/{grant_id}/apply", response_model=GrantApplicationResponse)
async def generate_application(
    grant_id: int,
    payload: GrantApplicationGenerateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantApplicationResponse:
    """Генерирует унифицированную заявку из паспорта проекта под грант."""
    res = await db.execute(select(Grant).where(Grant.id == grant_id))
    grant = res.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Грант не найден")

    project = await _get_owned_project(payload.project_id, user, db)

    score, _hard_pass, _reasons = grants_service.match_grant(project.passport or {}, grant)
    result = await grants_service.generate_application(
        project.passport or {}, grant, extra_context=payload.extra_context or ""
    )

    app = GrantApplication(
        user_id=user.id,
        project_id=project.id,
        grant_id=grant.id,
        status="generated",
        content={"sections": result["sections"], "gaps": result["gaps"]},
        match_score=score,
    )
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return GrantApplicationResponse.model_validate(app)


@router.post("", response_model=GrantResponse)
async def create_grant(
    payload: GrantCreateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantResponse:
    """Создание гранта в каталоге. Только админ (ручное наполнение/парсер)."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Только для администратора")
    data = payload.model_dump()
    # Парсер/админка могут не присылать логотип — выводим его из домена сайта.
    if not data.get("logo_url"):
        data["logo_url"] = grants_service.derive_logo_url(data.get("url"))
    grant = Grant(**data)
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return GrantResponse.model_validate(grant)
