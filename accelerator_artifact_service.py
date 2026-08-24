"""Validation and redaction for accelerator references to canonical Pitchy results."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AcceleratorMembership,
    ChatSession,
    GrantApplication,
    Project,
    ResearchJob,
)


async def validate_artifact_source(
    db: AsyncSession,
    *,
    membership: AcceleratorMembership,
    source_type: str | None,
    source_id: str | None,
    submitted_url: str | None,
) -> dict:
    """Resolve only an artifact that belongs to the resident and membership project."""
    if not membership.project_id:
        raise HTTPException(status_code=409, detail="У резидента нет проекта")
    if not source_type:
        if submitted_url:
            raise HTTPException(status_code=422, detail="Укажите тип источника результата")
        return {"source_type": None, "source_id": None, "url": None}
    if source_type == "external":
        if not submitted_url:
            raise HTTPException(status_code=422, detail="Для внешнего результата укажите ссылку")
        return {"source_type": source_type, "source_id": None, "url": submitted_url}
    try:
        numeric_id = int(source_id or "")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Некорректный ID результата") from exc
    if numeric_id <= 0:
        raise HTTPException(status_code=422, detail="Некорректный ID результата")

    if source_type == "chat_session":
        row = await db.get(ChatSession, numeric_id)
        if not row or row.user_id != membership.user_id or row.project_id != membership.project_id:
            raise HTTPException(status_code=404, detail="Чат проекта не найден")
        return {
            "source_type": source_type,
            "source_id": str(row.id),
            "url": f"/dashboard?tab=chat&session={row.id}",
            "title": row.title,
        }

    if source_type == "research_job":
        row = await db.get(ResearchJob, numeric_id)
        session = await db.get(ChatSession, row.session_id) if row and row.session_id else None
        if (
            not row or row.user_id != membership.user_id or not session
            or session.project_id != membership.project_id
        ):
            raise HTTPException(status_code=404, detail="Исследование проекта не найдено")
        return {
            "source_type": source_type,
            "source_id": str(row.id),
            "url": f"/dashboard?tab=chat&session={session.id}",
            "title": session.title,
            "status": "ready" if row.status == "completed" else "failed" if row.status == "failed" else "started",
        }

    if source_type == "roadmap":
        project = await db.get(Project, numeric_id)
        if not project or project.id != membership.project_id or project.user_id != membership.user_id:
            raise HTTPException(status_code=404, detail="Дорожная карта проекта не найдена")
        import roadmap_service

        roadmap = roadmap_service.build_roadmap(project.passport or {})
        return {
            "source_type": source_type,
            "source_id": str(project.id),
            "url": f"/dashboard?tab=tree&project={project.id}",
            "title": f"Дорожная карта — {project.name}",
            "summary": f"Заполнено {roadmap['progress']}% дорожной карты",
            "status": "ready" if roadmap["progress"] == 100 else "started",
        }

    if source_type == "grant_application":
        row = await db.get(GrantApplication, numeric_id)
        if not row or row.user_id != membership.user_id or row.project_id != membership.project_id:
            raise HTTPException(status_code=404, detail="Грантовая заявка проекта не найдена")
        return {
            "source_type": source_type,
            "source_id": str(row.id),
            "url": f"/grants/{row.grant_id}?project={row.project_id}",
            "title": "Грантовая заявка",
            "status": "ready" if row.status in ("generated", "submitted") else "started",
        }

    raise HTTPException(status_code=422, detail="Неподдерживаемый тип результата")


def artifact_visibility(*, organizer: bool, tracker: bool) -> dict[str, bool]:
    return {"organizer": organizer, "tracker": tracker}


def can_view_artifact_details(visibility: dict | None, access_role: str) -> bool:
    visibility = visibility or {}
    if access_role == "resident":
        return True
    if access_role in ("global_admin", "organizer"):
        return bool(visibility.get("organizer"))
    if access_role == "tracker":
        return bool(visibility.get("tracker"))
    return False
