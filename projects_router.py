"""
FastAPI router для папок проекта (паспорт проекта).

REST API:
- POST   /projects                      — создать папку проекта
- GET    /projects                      — список папок пользователя
- GET    /projects/{id}                 — одна папка
- PATCH  /projects/{id}                 — переименовать / архивировать
- DELETE /projects/{id}                 — удалить папку
- GET    /projects/{id}/passport        — паспорт + индекс готовности (для модалки)
- PATCH  /projects/{id}/passport        — частичный апдейт паспорта (source=manual)
- GET    /projects/{id}/sessions        — чаты внутри папки
- POST   /projects/{id}/sessions/{sid}  — привязать чат к папке
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_async_current_user
from db_async import get_async_db
from models import User, Project, ChatSession
from schemas import (
    ProjectCreateRequest,
    ProjectUpdateRequest,
    ProjectResponse,
    ProjectListItemResponse,
    PassportPatchRequest,
    PassportResponse,
    ChatSessionResponse,
)
import passport as passport_lib

logger = logging.getLogger("app")

router = APIRouter(prefix="/projects", tags=["Project Passport"])


async def _get_owned_project(project_id: int, user: User, db: AsyncSession) -> Project:
    res = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Папка проекта не найдена")
    return project


@router.post("", response_model=ProjectResponse)
async def create_project(
    payload: ProjectCreateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ProjectResponse:
    passport = payload.passport or {}
    project = Project(
        user_id=user.id,
        name=payload.name,
        passport=passport,
        readiness_index=passport_lib.compute_readiness(passport),
        passport_updated_at=datetime.utcnow() if passport else None,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    # Опционально привязываем существующий чат к новой папке.
    if payload.attach_session_id is not None:
        res = await db.execute(
            select(ChatSession).where(
                ChatSession.id == payload.attach_session_id,
                ChatSession.user_id == user.id,
            )
        )
        session = res.scalar_one_or_none()
        if session:
            session.project_id = project.id
            await db.commit()

    return ProjectResponse.model_validate(project)


@router.get("", response_model=list[ProjectListItemResponse])
async def list_projects(
    include_archived: bool = False,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[ProjectListItemResponse]:
    q = select(Project).where(Project.user_id == user.id)
    if not include_archived:
        q = q.where(Project.status == "active")
    q = q.order_by(Project.updated_at.desc()).limit(100)
    res = await db.execute(q)
    projects = res.scalars().all()

    # Кол-во чатов в каждой папке одним запросом.
    counts: dict[int, int] = {}
    if projects:
        cres = await db.execute(
            select(ChatSession.project_id, func.count(ChatSession.id))
            .where(ChatSession.project_id.in_([p.id for p in projects]))
            .group_by(ChatSession.project_id)
        )
        counts = {pid: cnt for pid, cnt in cres.all()}

    out = []
    for p in projects:
        item = ProjectListItemResponse.model_validate(p)
        item.session_count = counts.get(p.id, 0)
        out.append(item)
    return out


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ProjectResponse:
    project = await _get_owned_project(project_id, user, db)
    return ProjectResponse.model_validate(project)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    payload: ProjectUpdateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ProjectResponse:
    project = await _get_owned_project(project_id, user, db)
    if payload.name is not None:
        project.name = payload.name
    if payload.status is not None:
        if payload.status not in ("active", "archived"):
            raise HTTPException(status_code=400, detail="Недопустимый статус")
        project.status = payload.status
    await db.commit()
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    project = await _get_owned_project(project_id, user, db)
    await db.delete(project)
    await db.commit()
    return {"status": "deleted"}


@router.get("/{project_id}/passport", response_model=PassportResponse)
async def get_passport(
    project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> PassportResponse:
    project = await _get_owned_project(project_id, user, db)
    passport = project.passport or {}
    return PassportResponse(
        passport=passport,
        readiness_index=passport_lib.compute_readiness(passport),
        missing_sections=passport_lib.missing_sections(passport),
    )


@router.patch("/{project_id}/passport", response_model=PassportResponse)
async def patch_passport(
    project_id: int,
    payload: PassportPatchRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> PassportResponse:
    """Ручное редактирование паспорта из модалки. Все затронутые поля
    помечаются source=manual, поэтому ИИ их потом не перезапишет молча."""
    project = await _get_owned_project(project_id, user, db)
    merged = passport_lib.merge_patch(project.passport or {}, payload.fields, source="manual")
    project.passport = merged
    project.readiness_index = passport_lib.compute_readiness(merged)
    project.passport_updated_at = datetime.utcnow()
    flag_modified(project, "passport")
    await db.commit()
    await db.refresh(project)
    return PassportResponse(
        passport=merged,
        readiness_index=project.readiness_index,
        missing_sections=passport_lib.missing_sections(merged),
    )


@router.get("/{project_id}/sessions", response_model=list[ChatSessionResponse])
async def list_project_sessions(
    project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[ChatSessionResponse]:
    await _get_owned_project(project_id, user, db)
    res = await db.execute(
        select(ChatSession)
        .where(ChatSession.project_id == project_id, ChatSession.user_id == user.id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = res.scalars().all()
    return [ChatSessionResponse.model_validate(s) for s in sessions]


@router.post("/{project_id}/sessions/{session_id}", response_model=ChatSessionResponse)
async def attach_session(
    project_id: int,
    session_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ChatSessionResponse:
    await _get_owned_project(project_id, user, db)
    res = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id, ChatSession.user_id == user.id
        )
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Чат не найден")
    session.project_id = project_id
    await db.commit()
    await db.refresh(session)
    return ChatSessionResponse.model_validate(session)
