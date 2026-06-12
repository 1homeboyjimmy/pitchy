"""
FastAPI router для грантов (автоподбор + генерация заявок).

REST API:
- GET    /grants                         — каталог (для календаря и блока «сейчас»)
- GET    /grants/match                    — автоподбор под паспорт проекта
- GET    /grants/{id}                     — карточка гранта (+ матч, если задан project_id)
- POST   /grants/{id}/apply               — сгенерировать заявку из паспорта
- POST   /grants/{id}/track               — добавить грант на канбан (без LLM)
- GET    /grants/applications             — мои заявки (/grants/my)
- GET    /grants/applications/{app_id}    — одна заявка
- PATCH  /grants/applications/{app_id}    — правка секций/статуса/стадии канбана
- POST   /grants                          — создать грант (только админ)
- GET    /grants/sources                  — источники авто-парсера (админ)
- POST   /grants/sources                  — добавить источник (админ)
- PATCH  /grants/sources/{id}             — править источник (админ)
- DELETE /grants/sources/{id}             — удалить источник (админ)
- POST   /grants/sources/{id}/crawl       — обойти источник сейчас (админ)
- GET    /grants/moderation               — очередь модерации (админ)
- POST   /grants/{id}/moderate            — одобрить/отклонить грант (админ)

Матчинг живёт в grants_service и читает Project.passport. Скоринг
детерминированный; grant_match_cache зарезервирован под будущее
кэширование (сейчас считаем на лету — корректнее при правках паспорта).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from auth import get_async_current_user
from db_async import get_async_db
from models import User, Project, Grant, GrantApplication, GrantSource
from schemas import (
    GrantResponse,
    GrantMatchResponse,
    GrantCreateRequest,
    GrantExtractRequest,
    GrantApplicationGenerateRequest,
    GrantApplicationResponse,
    GrantApplicationUpdateRequest,
    GrantSourceResponse,
    GrantSourceCreateRequest,
    GrantSourceUpdateRequest,
    GrantModerateRequest,
    GrantTemplateUpdateRequest,
)
import grants_service
import grants_autodiscover
import grant_templates

logger = logging.getLogger("app")

router = APIRouter(prefix="/grants", tags=["Grants"])

# Стадии воронки CRM «Мои гранты» (канбан). Порядок = порядок колонок.
CRM_STAGES = ("interested", "preparing", "submitted", "won", "rejected")

# Типы источников авто-обнаружения грантов.
SOURCE_KINDS = ("listing", "page")

# Категории программ в каталоге (тип Grant.category).
GRANT_CATEGORIES = (
    "grant", "contest", "accelerator", "event", "pitch", "support_measure", "investor",
)


def _require_admin(user: User) -> None:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Только для администратора")


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
    category: str | None = Query(None, description="grant | contest | accelerator | event | pitch | support_measure | investor"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[GrantResponse]:
    """Каталог программ для календаря и блока «сейчас идёт»."""
    # Публичный каталог показывает только одобренные модерацией программы.
    q = select(Grant).where(Grant.moderation == "approved")
    if status:
        q = q.where(Grant.status == status)
    if category:
        if category not in GRANT_CATEGORIES:
            raise HTTPException(status_code=400, detail="Неизвестная категория")
        q = q.where(Grant.category == category)
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

    # Автоподбор работает только по одобренным грантам (немодерированные
    # программы не должны попадать в матч паспорта).
    q = select(Grant).where(Grant.moderation == "approved")
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


# ---------------------------------------------------------------------------
# Авто-обнаружение грантов: источники + очередь модерации (только админ).
# Литеральные пути объявлены ВЫШЕ /{grant_id}, иначе FastAPI попытается
# разобрать "sources"/"moderation" как int grant_id и вернёт 422.
# ---------------------------------------------------------------------------

@router.get("/sources", response_model=list[GrantSourceResponse])
async def list_sources(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[GrantSourceResponse]:
    """Список источников авто-парсера. Только админ."""
    _require_admin(user)
    res = await db.execute(select(GrantSource).order_by(GrantSource.created_at.desc()))
    return [GrantSourceResponse.model_validate(s) for s in res.scalars().all()]


@router.post("/sources", response_model=GrantSourceResponse)
async def create_source(
    payload: GrantSourceCreateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantSourceResponse:
    """Добавить источник для авто-парсера. Только админ."""
    _require_admin(user)
    kind = payload.kind if payload.kind in SOURCE_KINDS else "listing"
    src = GrantSource(
        name=payload.name.strip(),
        url=payload.url.strip(),
        kind=kind,
        max_items=payload.max_items,
    )
    db.add(src)
    await db.commit()
    await db.refresh(src)
    return GrantSourceResponse.model_validate(src)


@router.patch("/sources/{source_id}", response_model=GrantSourceResponse)
async def update_source(
    source_id: int,
    payload: GrantSourceUpdateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantSourceResponse:
    """Правка источника: вкл/выкл, имя, url, тип, лимит. Только админ."""
    _require_admin(user)
    res = await db.execute(select(GrantSource).where(GrantSource.id == source_id))
    src = res.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Источник не найден")
    if payload.name is not None:
        src.name = payload.name.strip()
    if payload.url is not None:
        src.url = payload.url.strip()
    if payload.kind is not None:
        if payload.kind not in SOURCE_KINDS:
            raise HTTPException(status_code=400, detail="Тип источника: listing | page")
        src.kind = payload.kind
    if payload.enabled is not None:
        src.enabled = payload.enabled
    if payload.max_items is not None:
        src.max_items = payload.max_items
    await db.commit()
    await db.refresh(src)
    return GrantSourceResponse.model_validate(src)


@router.delete("/sources/{source_id}")
async def delete_source(
    source_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Удалить источник. Найденные им гранты остаются (source_id → NULL). Только админ."""
    _require_admin(user)
    res = await db.execute(select(GrantSource).where(GrantSource.id == source_id))
    src = res.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Источник не найден")
    await db.delete(src)
    await db.commit()
    return {"ok": True}


@router.post("/sources/{source_id}/crawl")
async def crawl_source_now(
    source_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Запустить обход источника прямо сейчас (в фоне). Только админ.

    Возвращает сразу: парсинг идёт фоном (asyncio.create_task), чтобы не
    держать HTTP-запрос на десятках LLM-вызовов. Результат — в last_status."""
    _require_admin(user)
    res = await db.execute(select(GrantSource).where(GrantSource.id == source_id))
    src = res.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Источник не найден")
    asyncio.create_task(grants_autodiscover.crawl_source_by_id(source_id))
    return {"status": "started", "detail": "Обход запущен в фоне. Обновите список через минуту."}


@router.get("/moderation", response_model=list[GrantResponse])
async def moderation_queue(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[GrantResponse]:
    """Очередь модерации: гранты, найденные краулером (pending). Только админ."""
    _require_admin(user)
    res = await db.execute(
        select(Grant)
        .where(Grant.moderation == "pending")
        .order_by(Grant.created_at.desc())
        .limit(200)
    )
    return [GrantResponse.model_validate(g) for g in res.scalars().all()]


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
    if payload.stage is not None:
        if payload.stage not in CRM_STAGES:
            raise HTTPException(status_code=400, detail="Недопустимая стадия")
        app.stage = payload.stage
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
    # Непубличные (pending/rejected) видны только админу — прямой переход по
    # id не должен раскрывать немодерированные программы обычным пользователям.
    if grant.moderation != "approved" and not user.is_admin:
        raise HTTPException(status_code=404, detail="Грант не найден")
    resp = GrantResponse.model_validate(grant)
    resp.has_template = grant_templates.has_real_template(grant)
    return resp


@router.post("/{grant_id}/apply", response_model=GrantApplicationResponse)
async def generate_application(
    grant_id: int,
    payload: GrantApplicationGenerateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantApplicationResponse:
    """Генерирует унифицированную заявку из паспорта проекта под грант.

    Upsert по (user, project, grant): если карточка уже есть на канбане
    (например, добавлена как «Интересует»), наполняем её содержимым вместо
    создания дубля и подвигаем стадию interested → preparing."""
    res = await db.execute(select(Grant).where(Grant.id == grant_id))
    grant = res.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Грант не найден")
    # Генерацию включаем только для грантов с реальным шаблоном фонда.
    if not grant_templates.has_real_template(grant):
        raise HTTPException(
            status_code=400,
            detail="Для этой программы пока нет шаблона заявки — генерация недоступна.",
        )

    project = await _get_owned_project(payload.project_id, user, db)

    score, _hard_pass, _reasons = grants_service.match_grant(project.passport or {}, grant)
    result = await grants_service.generate_application(
        project.passport or {}, grant, extra_context=payload.extra_context or ""
    )

    existing = await db.execute(
        select(GrantApplication).where(
            GrantApplication.user_id == user.id,
            GrantApplication.project_id == project.id,
            GrantApplication.grant_id == grant.id,
        )
    )
    app = existing.scalar_one_or_none()
    if app is None:
        app = GrantApplication(
            user_id=user.id,
            project_id=project.id,
            grant_id=grant.id,
            stage="preparing",
        )
        db.add(app)
    elif app.stage == "interested":
        app.stage = "preparing"
    app.status = "generated"
    app.content = {
        "template_key": result.get("template_key"),
        "template_title": result.get("template_title"),
        "sections": result["sections"],
        "section_meta": result.get("section_meta", []),
        "static": result.get("static", {}),
        "user_input": result.get("user_input", []),
        "gaps": result["gaps"],
    }
    app.match_score = score
    flag_modified(app, "content")
    await db.commit()
    await db.refresh(app)
    return GrantApplicationResponse.model_validate(app)


@router.post("/{grant_id}/track", response_model=GrantApplicationResponse)
async def track_grant(
    grant_id: int,
    payload: GrantApplicationGenerateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantApplicationResponse:
    """Добавить грант на канбан «Мои гранты» без генерации заявки (без LLM).

    Создаёт карточку в стадии «Интересует». Идемпотентно по (user, project,
    grant): повторный вызов возвращает существующую карточку, не плодя дубли —
    чтобы кнопка «В мои гранты» была безопасна при повторных кликах."""
    res = await db.execute(select(Grant).where(Grant.id == grant_id))
    grant = res.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Грант не найден")

    project = await _get_owned_project(payload.project_id, user, db)

    existing = await db.execute(
        select(GrantApplication).where(
            GrantApplication.user_id == user.id,
            GrantApplication.project_id == project.id,
            GrantApplication.grant_id == grant.id,
        )
    )
    app = existing.scalar_one_or_none()
    if app is not None:
        return GrantApplicationResponse.model_validate(app)

    score, _hard_pass, _reasons = grants_service.match_grant(project.passport or {}, grant)
    app = GrantApplication(
        user_id=user.id,
        project_id=project.id,
        grant_id=grant.id,
        status="draft",
        stage="interested",
        content={},
        match_score=score,
    )
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return GrantApplicationResponse.model_validate(app)


@router.post("/{grant_id}/moderate", response_model=GrantResponse)
async def moderate_grant(
    grant_id: int,
    payload: GrantModerateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantResponse:
    """Одобрить/отклонить найденный краулером грант. Только админ.

    approve → moderation='approved' (попадает в каталог и матч);
    reject  → moderation='rejected' (скрыт; дедуп по url не вернёт его снова)."""
    _require_admin(user)
    res = await db.execute(select(Grant).where(Grant.id == grant_id))
    grant = res.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Грант не найден")
    action = (payload.action or "").strip().lower()
    if action == "approve":
        grant.moderation = "approved"
    elif action == "reject":
        grant.moderation = "rejected"
    else:
        raise HTTPException(status_code=400, detail="Действие: approve | reject")
    await db.commit()
    await db.refresh(grant)
    return GrantResponse.model_validate(grant)


@router.get("/{grant_id}/template")
async def get_grant_template(
    grant_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Эффективный шаблон заявки для гранта (override из БД или дефолт из кода).

    Поле `source`: custom — задан админом в БД; default — выбран по названию/орг."""
    res = await db.execute(select(Grant).where(Grant.id == grant_id))
    grant = res.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Грант не найден")
    if grant.moderation != "approved" and not user.is_admin:
        raise HTTPException(status_code=404, detail="Грант не найден")
    template = grant_templates.select_application_template(grant)
    source = "custom" if grant.application_template else "default"
    return {"source": source, "template": template}


@router.patch("/{grant_id}/template", response_model=GrantResponse)
async def update_grant_template(
    grant_id: int,
    payload: GrantTemplateUpdateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> GrantResponse:
    """Задать/сбросить шаблон заявки гранта. Только админ.

    template=None → сброс к дефолту из кода. Иначе сохраняем override в БД."""
    _require_admin(user)
    res = await db.execute(select(Grant).where(Grant.id == grant_id))
    grant = res.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Грант не найден")
    if payload.template is not None and not payload.template.get("groups"):
        raise HTTPException(status_code=400, detail="Шаблон должен содержать groups[]")
    grant.application_template = payload.template
    flag_modified(grant, "application_template")
    await db.commit()
    await db.refresh(grant)
    return GrantResponse.model_validate(grant)


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


@router.post("/extract")
async def extract_grant(
    payload: GrantExtractRequest,
    user: User = Depends(get_async_current_user),
) -> dict:
    """Извлечь черновик гранта по ссылке (LLM-парсер). Только админ.

    Возвращает draft-словарь с полями GrantCreateRequest — НЕ сохраняет.
    Админ правит черновик и сохраняет отдельным POST /grants.
    """
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Только для администратора")
    try:
        draft = await grants_service.extract_grant_from_url(payload.url)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:  # noqa: BLE001
        logger.exception("grant extract failed for %s", payload.url)
        raise HTTPException(status_code=502, detail=f"Не удалось разобрать страницу: {e}")
    return draft
