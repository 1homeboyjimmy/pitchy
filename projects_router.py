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

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_async_current_user
from db_async import get_async_db
from models import (
    AcceleratorArtifact,
    AcceleratorDemoDayProject,
    AcceleratorMembership,
    AcceleratorProgramAction,
    AcceleratorProgramConfig,
    AcceleratorProgramStage,
    AcceleratorProjectAudit,
    AcceleratorTeam,
    User,
    Project,
    ChatSession,
)
from schemas import (
    ProjectCreateRequest,
    ProjectUpdateRequest,
    ProjectResponse,
    ProjectListItemResponse,
    PassportPatchRequest,
    PassportResponse,
    ProjectOnboardRequest,
    ProjectOnboardResponse,
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


async def _validate_accelerator_roadmap_context(
    db: AsyncSession,
    *,
    project: Project,
    user: User,
    membership_id: int | None,
    action_id: int | None,
) -> tuple[AcceleratorMembership, AcceleratorProgramAction] | None:
    """Resolve a contextual roadmap launch without widening project access.

    Context parameters travel through a user-controlled URL, so both must be
    present and must point to the current user's enrolled membership, its
    canonical project and a published roadmap action in the same cohort.
    """
    if membership_id is None and action_id is None:
        return None
    if membership_id is None or action_id is None:
        raise HTTPException(
            status_code=422,
            detail="Контекст акселератора должен содержать membership и action",
        )

    membership = await db.get(AcceleratorMembership, membership_id)
    if (
        not membership
        or membership.user_id != user.id
        or membership.role != "resident"
        or membership.status != "enrolled"
        or membership.project_id != project.id
    ):
        # Do not disclose whether a foreign membership exists.
        raise HTTPException(status_code=404, detail="Контекст дорожной карты не найден")

    row = (await db.execute(
        select(AcceleratorProgramAction, AcceleratorProgramStage)
        .join(
            AcceleratorProgramStage,
            AcceleratorProgramStage.id == AcceleratorProgramAction.stage_id,
        )
        .where(
            AcceleratorProgramAction.id == action_id,
            AcceleratorProgramAction.action_type == "roadmap",
            AcceleratorProgramStage.cohort_id == membership.cohort_id,
            AcceleratorProgramStage.status == "published",
        )
    )).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Контекст дорожной карты не найден")
    action, _stage = row
    artifact = (await db.execute(select(AcceleratorArtifact.id).where(
        AcceleratorArtifact.action_id == action.id,
        AcceleratorArtifact.membership_id == membership.id,
        AcceleratorArtifact.project_id == project.id,
    ))).scalar_one_or_none()
    config = (await db.execute(select(AcceleratorProgramConfig).where(
        AcceleratorProgramConfig.cohort_id == membership.cohort_id,
    ))).scalar_one_or_none()
    if artifact is None or not config or not (config.modules or {}).get("pitchy_artifacts"):
        raise HTTPException(status_code=404, detail="Контекст дорожной карты не найден")
    return membership, action


def _project_response(project: Project) -> ProjectResponse:
    """Возвращает проект с индексом по актуальной схеме паспорта.

    Это не даёт старому сохранённому значению индекса отображаться после
    изменения правил готовности, до первой ручной правки пользователя.
    """
    response = ProjectResponse.model_validate(project)
    response.readiness_index = passport_lib.compute_readiness(project.passport or {})
    return response


@router.post("", response_model=ProjectResponse)
async def create_project(
    payload: ProjectCreateRequest,
    request: Request,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ProjectResponse:
    # A project folder is a basic workspace primitive, not a generated
    # roadmap.  It must remain available on the free tier; only roadmap
    # generation consumes the roadmaps quota.
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

    return _project_response(project)


@router.post("/onboard", response_model=ProjectOnboardResponse)
async def onboard_project(
    payload: ProjectOnboardRequest,
    request: Request,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ProjectOnboardResponse:
    """Онбординг «2 минуты до матча»: из описания идеи создаём папку с
    черновиком паспорта (source=ai) и возвращаем короткий разбор. Дальше
    фронт грузит подбор грантов по project.id.

    Паспорт помечается source=ai — пользователь свободно правит его в
    мастере/модалке, и эти правки уже не перезатираются автоматикой.
    """
    from slm_dispatcher import slm_dispatcher
    idea = (payload.idea or "").strip()
    try:
        draft = await slm_dispatcher.draft_passport_from_idea(idea)
    except Exception as e:  # noqa: BLE001 — SLM недоступен: не валим онбординг
        logger.warning("onboard draft failed: %s", e)
        draft = {}

    flat = draft.get("passport") or {}
    passport = passport_lib.merge_patch({}, flat, source="ai") if flat else {}
    name = (draft.get("name") or "").strip() or "Мой проект"

    project = Project(
        user_id=user.id,
        name=name[:120],
        passport=passport,
        readiness_index=passport_lib.compute_readiness(passport),
        passport_updated_at=datetime.utcnow() if passport else None,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)

    return ProjectOnboardResponse(
        project=_project_response(project),
        summary=draft.get("summary") or "",
    )


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

    import roadmap_service
    out = []
    for p in projects:
        item = ProjectListItemResponse.model_validate(p)
        item.readiness_index = passport_lib.compute_readiness(p.passport or {})
        item.roadmap_progress = roadmap_service.build_roadmap(p.passport or {})["progress"]
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
    return _project_response(project)


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
    return _project_response(project)


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    project = await _get_owned_project(project_id, user, db)
    active_team = (await db.execute(
        select(AcceleratorTeam.id).where(
            AcceleratorTeam.project_id == project.id,
            AcceleratorTeam.status == "active",
        ).limit(1)
    )).scalar_one_or_none()
    if active_team is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Проект является основой активной команды акселератора. "
                "Сначала архивируйте команду."
            ),
        )
    protected_reference = None
    for model in (
        AcceleratorMembership,
        AcceleratorArtifact,
        AcceleratorProjectAudit,
        AcceleratorDemoDayProject,
    ):
        protected_reference = (await db.execute(
            select(model.id).where(model.project_id == project.id).limit(1)
        )).scalar_one_or_none()
        if protected_reference is not None:
            break
    if protected_reference is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Проект участвует в акселераторе и хранит отчётную историю. "
                "Архивируйте его вместо удаления."
            ),
        )
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
        readiness_config=passport_lib.readiness_config(),
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

    # A report generated from an older passport must never survive edits as if
    # it were current. Invalidate the overall report and only the step reports
    # whose fields changed; unrelated step analyses remain available.
    if payload.fields:
        import roadmap_service
        merged = roadmap_service.invalidate_analyses(merged, set(payload.fields))

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
        readiness_config=passport_lib.readiness_config(),
    )


@router.get("/{project_id}/roadmap")
async def get_roadmap(
    project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Дорожная карта проекта, вычисленная из паспорта: чекпоинты со статусами,
    прогрессом и наградами. Заполнение узлов идёт через PATCH .../passport."""
    import roadmap_service
    project = await _get_owned_project(project_id, user, db)
    return roadmap_service.build_roadmap(project.passport or {})


@router.post("/{project_id}/roadmap/analyze-step")
async def analyze_roadmap_step(
    project_id: int,
    checkpoint_id: str = Query(..., description="id чекпоинта карты"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """ИИ-разбор заполненного этапа (паспорт + RAG, тот же пайплайн, что у чата)."""
    import roadmap_analysis
    project = await _get_owned_project(project_id, user, db)
    return await roadmap_analysis.analyze_step(
        project.passport or {},
        checkpoint_id,
        project_id=project.id,
    )


@router.post("/{project_id}/roadmap/analyze")
async def analyze_roadmap_overall(
    project_id: int,
    accelerator_membership: int | None = Query(default=None, gt=0),
    accelerator_action: int | None = Query(default=None, gt=0),
    request_id: str | None = Query(default=None, min_length=8, max_length=100),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Обширная аналитика стартапа — стримом (SSE), как основной чат: паспорт +
    RAG + веб-поиск. Стриминг решает таймаут шлюза на длинной генерации; итог
    сохраняется в passport.assets внутри стрима."""
    from fastapi.responses import StreamingResponse
    import roadmap_analysis
    project = await _get_owned_project(project_id, user, db)
    passport = project.passport or {}
    valid, validation_message = roadmap_analysis.validate_passport_for_analysis(passport)
    if not valid:
        raise HTTPException(status_code=422, detail=validation_message)

    from routerai_client import is_routerai_configured
    if not is_routerai_configured():
        raise HTTPException(
            status_code=503,
            detail="Основная модель чата временно не настроена. Попробуйте позже.",
        )

    accelerator_context = await _validate_accelerator_roadmap_context(
        db,
        project=project,
        user=user,
        membership_id=accelerator_membership,
        action_id=accelerator_action,
    )
    from subscription_service import consume_quota, require_legacy_access
    if accelerator_context:
        membership, action = accelerator_context
        handled = await consume_quota(
            db,
            user,
            "roadmaps",
            # One program action represents one required result. Retries and
            # reconnects to its SSE stream must not spend a second unit.
            idempotency_key=f"accelerator-roadmap-action:{membership.id}:{action.id}",
            reference_type="accelerator_program_action",
            reference_id=str(action.id),
            metadata={"project_id": project.id, "action_type": action.action_type},
            accelerator_membership_id=membership.id,
        )
    else:
        handled = await consume_quota(
            db,
            user,
            "roadmaps",
            idempotency_key=f"roadmap-analysis:{user.id}:{request_id or datetime.utcnow().isoformat()}",
            reference_type="roadmap_analysis",
            reference_id=str(project.id),
            metadata={"project_id": project.id},
        )
    if not handled:
        require_legacy_access(user, "roadmaps")
    # Streaming starts after the response is returned. Persist the debit before
    # that boundary so disconnects cannot roll it back silently.
    await db.commit()
    return StreamingResponse(
        roadmap_analysis.stream_overall(passport, project.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Encoding": "identity",
        },
    )


@router.get("/{project_id}/roadmap/export.pdf")
async def export_roadmap_pdf(
    project_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """PDF дорожной карты: шапка с индексом готовности, чекпоинты с полями
    паспорта, сохранённая ИИ-аналитика с источниками. Генерируется на лету
    (WeasyPrint), ничего не хранится."""
    import export_service
    import roadmap_export
    import roadmap_service
    from fastapi.responses import Response
    from starlette.concurrency import run_in_threadpool

    if not export_service.pdf_available():
        raise HTTPException(
            status_code=503,
            detail="PDF-экспорт временно недоступен в этой среде.",
        )
    project = await _get_owned_project(project_id, user, db)
    roadmap = roadmap_service.build_roadmap(project.passport or {})
    pdf = await run_in_threadpool(roadmap_export.render_roadmap_pdf, project.name, roadmap)
    filename = export_service.suggest_filename(f"Дорожная карта — {project.name}", "pdf")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": export_service.build_content_disposition(filename),
            "Cache-Control": "no-store",
        },
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
