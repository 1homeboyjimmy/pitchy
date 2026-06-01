"""Сервис памяти папки проекта (Спринт 2).

Два уровня памяти, оба скоупятся по project_id:

  • Пассивная — компактный дамп паспорта + релевантные факты подмешиваются
    в системный контекст чата (load_project_context).
  • Активная — после значимого обмена репликами фоновый SLM-проход
    извлекает 1–5 фактов в project_memory и аккуратно дозаполняет паспорт,
    не перезаписывая поля, отредактированные пользователем вручную
    (extract_and_store_facts).
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

import passport as passport_lib
from models import Project, ProjectMemory

logger = logging.getLogger("app")

_WORD_RE = re.compile(r"[\wа-яёА-ЯЁ]{4,}", re.UNICODE)


def _keywords(text: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(text or "")}


async def load_project_context(
    db: AsyncSession,
    project_id: int,
    query: str = "",
    max_facts: int = 8,
) -> str:
    """Собирает пассивный контекст папки для подмешивания в промпт чата.

    Возвращает готовую строку (или ""), включающую дамп паспорта и до
    max_facts релевантных/свежих фактов. Релевантность — лёгкая: факты,
    делящие слова с запросом, идут первыми; остальное добивается свежими.
    """
    res = await db.execute(select(Project).where(Project.id == project_id))
    project = res.scalar_one_or_none()
    if not project:
        return ""

    parts: list[str] = []

    dump = passport_lib.build_passport_prompt(project.passport or {})
    if dump:
        parts.append(dump)

    # Факты: тянем разумный пул свежих, затем ранжируем по пересечению слов.
    fres = await db.execute(
        select(ProjectMemory)
        .where(ProjectMemory.project_id == project_id)
        .order_by(ProjectMemory.created_at.desc())
        .limit(40)
    )
    memories = list(fres.scalars().all())
    if memories:
        q_words = _keywords(query)

        def _score(m: ProjectMemory) -> tuple[int, float]:
            overlap = len(_keywords(m.content) & q_words) if q_words else 0
            return (overlap, float(m.confidence or 0))

        ranked = sorted(memories, key=_score, reverse=True)[:max_facts]
        # Внутри выборки — стабильный порядок по дате создания.
        ranked.sort(key=lambda m: m.created_at)
        fact_lines = [f"- {m.content}" for m in ranked]
        if fact_lines:
            parts.append("ПАМЯТЬ ПО ПРОЕКТУ:\n" + "\n".join(fact_lines))

    return "\n\n".join(parts)


async def extract_and_store_facts(
    project_id: int,
    user_text: str,
    assistant_text: str,
    source_session_id: int | None = None,
) -> None:
    """Фоновая задача: извлечь факты из обмена репликами и сохранить их +
    дозаполнить паспорт. Открывает собственную сессию БД, т.к. запросная к
    моменту вызова уже закрыта."""
    if not user_text or not assistant_text:
        return
    try:
        from slm_dispatcher import slm_dispatcher
        extracted = await slm_dispatcher.extract_project_facts(user_text, assistant_text)
    except Exception as e:  # SLM недоступен — тихо выходим, чат не страдает
        logger.warning(f"project memory extraction (SLM) failed: {e}")
        return

    facts = extracted.get("facts") or []
    passport_updates = extracted.get("passport") or {}
    if not facts and not passport_updates:
        return

    from db_async import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(Project).where(Project.id == project_id))
            project = res.scalar_one_or_none()
            if not project:
                return

            # 1. Сохраняем извлечённые факты.
            for f in facts:
                db.add(ProjectMemory(
                    project_id=project_id,
                    kind=f.get("kind", "fact"),
                    content=f.get("content", "")[:500],
                    confidence=f.get("confidence", 0.5),
                    source_session_id=source_session_id,
                ))

            # 2. Дозаполняем паспорт — только поля, которые НЕ заданы вручную.
            current = project.passport or {}
            safe_updates = {
                path: value
                for path, value in passport_updates.items()
                if passport_lib.can_ai_overwrite(current, path)
            }
            if safe_updates:
                merged = passport_lib.merge_patch(current, safe_updates, source="ai")
                project.passport = merged
                project.readiness_index = passport_lib.compute_readiness(merged)
                flag_modified(project, "passport")

            await db.commit()
            logger.info(
                f"project memory: stored {len(facts)} facts, "
                f"updated {len(safe_updates)} passport fields (project {project_id})"
            )
    except Exception as e:
        logger.error(f"project memory store failed (project {project_id}): {e}")
