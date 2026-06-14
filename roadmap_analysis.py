"""ИИ-аналитика дорожной карты — на пайплайне основного чата.

НЕ голая модель: собираем тот же контекст, что и основной чат (паспорт проекта
+ RAG-база знаний + веб-поиск с источниками), и синтезируем тем же glm-5
(call_makura). Действия инициируются в дорожной карте, но «мозг» — общий.

Два режима:
  • analyze_step      — короткий разбор только что заполненного этапа.
  • analyze_overall   — обширная аналитика всего стартапа после прохождения карты
                        (с веб-поиском и источниками).
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

import passport as plib
import rag
from makura_client import call_makura, stream_makura
from search_agent import async_search_with_sources
from db_async import AsyncSessionLocal
from models import Project
import roadmap_service

logger = logging.getLogger("app")

_CP_TITLES = {cp["id"]: cp["title"] for cp in roadmap_service.CHECKPOINTS}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


_OVERALL_SYSTEM = (
    "Ты — старший венчурный аналитик. Дай ОБШИРНУЮ аналитику стартапа по его "
    "паспорту. Разделы: 1) Резюме и сильные стороны; 2) Рынок и тренды (с цифрами "
    "из контекста); 3) Конкуренты и позиционирование; 4) Бизнес-модель и юнит-"
    "экономика; 5) Ключевые риски и слепые зоны; 6) Готовность к грантам и "
    "инвестициям; 7) 3–5 приоритетных шагов. Опирайся на контекст (база знаний + "
    "веб), помечай рыночные цифры; если данных нет — скажи честно, не выдумывай. "
    "Структурируй по разделам, по делу."
)


async def _rag_context(query: str) -> str:
    try:
        chunks = await rag.aget_relevant_chunks(query, top_k=6)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"roadmap analysis RAG failed: {e}")
        return ""
    parts = []
    for c in chunks or []:
        t = c.get("text", "") if isinstance(c, dict) else str(c)
        if t:
            parts.append(t)
    return ("\n---\n".join(parts))[:4000]


async def _web_context(query: str, deep: bool = False) -> tuple[str, list[dict]]:
    try:
        sources, ctx = await async_search_with_sources(query, use_deep_search=deep)
        return (ctx or "")[:5000], (sources or [])
    except Exception as e:  # noqa: BLE001
        logger.warning(f"roadmap analysis web search failed: {e}")
        return "", []


async def analyze_step(passport: dict | None, checkpoint_id: str) -> dict:
    """Короткий разбор заполненного этапа: паспорт + RAG (без веба — быстро)."""
    passport = passport or {}
    brief = plib.build_passport_prompt(passport, max_chars=2500)
    title = _CP_TITLES.get(checkpoint_id, checkpoint_id)

    name = (passport.get("core") or {}).get("name") or "проект"
    rag_ctx = await _rag_context(f"{title} {name} стартап анализ")

    system_prompt = (
        "Ты — венчурный аналитик платформы Pitchy. Разбери ОДИН раздел паспорта "
        "стартапа кратко и по делу: 2–3 сильные стороны, 2–3 риска/слепые зоны и "
        "ОДИН конкретный следующий шаг. Опирайся на паспорт и контекст ниже; не "
        "выдумывай факты. Без воды, маркированными пунктами, до 1200 знаков."
    )
    user_prompt = (
        f"ПАСПОРТ ПРОЕКТА:\n{brief}\n\n"
        + (f"КОНТЕКСТ (база знаний):\n{rag_ctx}\n\n" if rag_ctx else "")
        + f"РАЗБЕРИ РАЗДЕЛ: «{title}»."
    )
    raw, _, usage = await call_makura(system_prompt, user_prompt)
    logger.info(f"roadmap step analysis (cp={checkpoint_id}, tokens={usage})")
    return {"checkpoint_id": checkpoint_id, "analysis": (raw or "").strip(), "usage": usage or {}}


async def analyze_overall(passport: dict | None) -> dict:
    """Обширная аналитика стартапа: паспорт + RAG + веб-поиск с источниками."""
    passport = passport or {}
    brief = plib.build_passport_prompt(passport, max_chars=3500)
    core = passport.get("core") or {}
    name = core.get("name") or "стартап"
    problem = core.get("problem") or ""

    query = f"{name} рынок РФ конкуренты тренды {problem}".strip()
    rag_ctx = await _rag_context(query)
    web_ctx, sources = await _web_context(query)

    context = ""
    if rag_ctx:
        context += f"<база_знаний>\n{rag_ctx}\n</база_знаний>\n"
    if web_ctx:
        context += f"<веб_поиск>\n{web_ctx}\n</веб_поиск>\n"

    user_prompt = (
        f"ПАСПОРТ ПРОЕКТА:\n{brief}\n\n"
        + (f"КОНТЕКСТ:\n{context}\n\n" if context else "")
        + "Сформируй полную аналитику стартапа по разделам выше."
    )
    raw, _, usage = await call_makura(_OVERALL_SYSTEM, user_prompt)
    logger.info(f"roadmap overall analysis (tokens={usage}, sources={len(sources)})")
    return {"analysis": (raw or "").strip(), "sources": sources[:8], "usage": usage or {}}


async def stream_overall(passport: dict | None, project_id: int):
    """Стриминг обширной аналитики (SSE) — как у основного чата: паспорт + RAG +
    веб-поиск, синтез стримом glm-5. Решает таймаут шлюза на длинном запросе и
    даёт живую генерацию. Итог сохраняем в passport.assets."""
    passport = passport or {}
    brief = plib.build_passport_prompt(passport, max_chars=3500)
    core = passport.get("core") or {}
    name = core.get("name") or "стартап"

    yield _sse({"type": "status", "text": "Собираю контекст…"})
    query = f"{name} рынок РФ конкуренты {core.get('problem', '')}".strip()
    rag_ctx = await _rag_context(query)
    web_ctx, sources = "", []
    try:
        web_ctx, sources = await asyncio.wait_for(_web_context(query, deep=False), timeout=15)
    except Exception:  # noqa: BLE001
        pass

    context = ""
    if rag_ctx:
        context += f"<база_знаний>\n{rag_ctx}\n</база_знаний>\n"
    if web_ctx:
        context += f"<веб_поиск>\n{web_ctx}\n</веб_поиск>\n"

    yield _sse({"type": "status", "text": "Анализирую…"})
    user_prompt = (
        f"ПАСПОРТ ПРОЕКТА:\n{brief}\n\n"
        + (f"КОНТЕКСТ:\n{context}\n\n" if context else "")
        + "Сформируй полную аналитику стартапа по разделам выше."
    )

    full = ""
    try:
        async for chunk in stream_makura(system_prompt=_OVERALL_SYSTEM, user_message=user_prompt):
            # stream_makura отдаёт строки-контент + dict-сентинелы
            # (__thinking__/__usage__) — берём только текстовый контент.
            if isinstance(chunk, str) and chunk:
                full += chunk
                yield _sse({"type": "chunk", "content": chunk})
    except Exception as e:  # noqa: BLE001
        logger.error(f"roadmap overall stream failed: {e}")
        yield _sse({"type": "error", "text": "Ошибка генерации аналитики"})

    yield _sse({"type": "sources", "sources": sources[:8]})
    yield _sse({"type": "done"})

    # Сохраняем итог в паспорт (своя сессия — стрим уже завершился).
    if full.strip():
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Project).where(Project.id == project_id))
                proj = res.scalar_one_or_none()
                if proj:
                    pp = dict(proj.passport or {})
                    assets = dict(pp.get("assets") or {})
                    assets["roadmap_analysis"] = {
                        "text": full.strip(),
                        "sources": sources[:8],
                        "generated_at": datetime.utcnow().isoformat(),
                    }
                    pp["assets"] = assets
                    proj.passport = pp
                    flag_modified(proj, "passport")
                    await db.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"persist overall analysis failed: {e}")
