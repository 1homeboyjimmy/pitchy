"""Авто-обнаружение грантов: фоновый обходчик официальных источников (#20).

Админ добавляет источники (GrantSource) в админке. Раз в сутки фоновый
цикл обходит включённые источники, извлекает программы LLM-парсером
(grants_service.extract_grant_from_url) и кладёт найденное в очередь
модерации (Grant.moderation='pending'). Админ проверяет очередь и
одобряет/отклоняет — только одобренные попадают в публичный каталог.

Принципы:
- Дедуп по Grant.url: повторные проходы не плодят дубли и уважают прошлые
  решения админа (в т.ч. 'rejected' — отклонённое не возвращается).
- Финальный фильтр качества — это LLM-парсер (отбрасывает не-гранты) плюс
  ручная модерация. Эвристики обхода ссылок намеренно простые.
- Никаких новых зависимостей: цикл на asyncio, как run_subscription_notices_loop.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from urllib.parse import urljoin, urlparse

logger = logging.getLogger("app.grants_autodiscover")

LOOP_INTERVAL_SECONDS = max(
    3600, int(os.getenv("GRANT_CATALOG_REFRESH_SECONDS", str(24 * 60 * 60)))
)
STARTUP_DELAY_SECONDS = max(
    0, int(os.getenv("GRANT_MAINTENANCE_STARTUP_DELAY_SECONDS", "120"))
)
DEADLINE_CHECK_INTERVAL_SECONDS = max(
    60, int(os.getenv("GRANT_DEADLINE_CHECK_SECONDS", str(60 * 60)))
)
FETCH_DELAY_SECONDS = 1.5              # вежливая пауза между страницами
GLOBAL_MAX_ITEMS = 30                  # жёсткий потолок программ за проход

_SKIP_EXT = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
    ".zip", ".rar", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".mp4",
)


async def _discover_links(listing_url: str, limit: int) -> list[str]:
    """Собирает кандидатные ссылки на страницы программ со страницы-списка.

    Берём ссылки того же домена (или поддомена), отбрасываем якоря,
    служебные схемы и файлы, дедупим, ограничиваем количеством. Решение
    «грант это или нет» отдаём LLM-парсеру и модерации, не угадываем тут."""
    import httpx
    from bs4 import BeautifulSoup

    headers = {"User-Agent": "Mozilla/5.0 (compatible; PitchyGrantsBot/1.0)"}
    timeout = httpx.Timeout(25.0, connect=10.0, read=20.0)
    target = listing_url if "://" in listing_url else f"https://{listing_url}"
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as c:
        r = await c.get(target)
        r.raise_for_status()
        html = r.text
        final_url = str(r.url)

    base_host = urlparse(final_url).netloc.lower()
    soup = BeautifulSoup(html, "html.parser")
    seen: set[str] = set()
    out: list[str] = []
    target_norm = target.rstrip("/")
    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absu = urljoin(final_url, href)
        pu = urlparse(absu)
        if pu.scheme not in ("http", "https"):
            continue
        host = pu.netloc.lower()
        same_domain = (
            host == base_host
            or host.endswith("." + base_host)
            or base_host.endswith("." + host)
        )
        if not same_domain:
            continue
        clean = absu.split("#")[0]
        if clean.lower().endswith(_SKIP_EXT):
            continue
        if clean.rstrip("/") == target_norm:
            continue
        if clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
        if len(out) >= limit:
            break
    return out


async def crawl_source(source, db) -> dict:
    """Обходит один источник и добавляет новые программы в очередь модерации.

    Возвращает {"new", "skipped", "errors"}. Дедуп по Grant.url. Коммитит
    добавленные гранты в переданную сессию (last_status пишет вызывающий)."""
    from sqlalchemy import select
    from models import Grant
    from schemas import GrantCreateRequest
    import grants_service

    limit = min(int(getattr(source, "max_items", 6) or 6), GLOBAL_MAX_ITEMS)
    kind = (getattr(source, "kind", "listing") or "listing").lower()

    if kind == "page":
        urls = [source.url]
    else:
        try:
            urls = await _discover_links(source.url, limit)
        except Exception as e:  # noqa: BLE001
            return {"new": 0, "skipped": 0, "errors": [f"список не открылся: {e}"]}

    new = 0
    skipped = 0
    errors: list[str] = []
    for u in urls[:limit]:
        # Дедуп: грант с таким url уже есть (в любом статусе модерации) —
        # пропускаем, чтобы не плодить дубли и уважать прошлые решения админа.
        exists = await db.execute(select(Grant.id).where(Grant.url == u))
        if exists.scalar_one_or_none() is not None:
            skipped += 1
            continue
        try:
            draft = await grants_service.extract_grant_from_url(u)
        except ValueError:
            skipped += 1  # страница не похожа на грант — это нормально
            continue
        except Exception as e:  # noqa: BLE001
            errors.append(f"{u}: {e}")
            continue
        try:
            payload = GrantCreateRequest(**draft)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{u}: черновик невалиден: {e}")
            continue
        data = payload.model_dump()
        if not data.get("logo_url"):
            data["logo_url"] = grants_service.derive_logo_url(data.get("url"))
        grant = Grant(**data, source="parsed", source_id=source.id, moderation="pending")
        db.add(grant)
        new += 1
        await asyncio.sleep(FETCH_DELAY_SECONDS)

    if new:
        await db.commit()
    return {"new": new, "skipped": skipped, "errors": errors}


def _format_status(result: dict) -> str:
    errs = result.get("errors") or []
    s = f"+{result.get('new', 0)} новых, {result.get('skipped', 0)} пропущено"
    if errs:
        s += f", ошибок: {len(errs)} ({errs[0]})"
    return s[:500]


async def crawl_source_by_id(source_id: int) -> dict:
    """Обойти один источник по id в своей сессии (ручной запуск из админки
    и проход цикла). Обновляет last_crawled_at / last_status источника."""
    from db_async import AsyncSessionLocal
    from models import GrantSource
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(GrantSource).where(GrantSource.id == source_id))
        source = res.scalar_one_or_none()
        if source is None:
            return {"new": 0, "skipped": 0, "errors": ["источник не найден"]}
        try:
            result = await crawl_source(source, db)
        except Exception as e:  # noqa: BLE001
            logger.error("autodiscover source %s failed: %s", source_id, e, exc_info=True)
            result = {"new": 0, "skipped": 0, "errors": [str(e)]}
        source.last_crawled_at = datetime.utcnow()
        source.last_status = _format_status(result)
        await db.commit()
        return result


async def run_autodiscovery_once() -> dict:
    """Один проход по всем включённым источникам (каждый — в своей сессии)."""
    from db_async import AsyncSessionLocal
    from models import GrantSource
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(GrantSource.id).where(GrantSource.enabled.is_(True)))
        ids = [row[0] for row in res.all()]

    summary = {"sources": len(ids), "new": 0, "skipped": 0, "errors": 0}
    for sid in ids:
        result = await crawl_source_by_id(sid)
        summary["new"] += result.get("new", 0)
        summary["skipped"] += result.get("skipped", 0)
        summary["errors"] += len(result.get("errors") or [])
    if ids:
        logger.info("autodiscover pass: %s", summary)
    return summary


async def sync_deadlines_once() -> dict:
    """Close expired grants and activate programs whose opening date arrived."""
    from db_async import AsyncSessionLocal
    import grants_service

    async with AsyncSessionLocal() as db:
        result = await grants_service.sync_grant_deadline_statuses(db)
    if result["changed"]:
        logger.info("grant deadline sync: %s", result)
    return result


async def refresh_trusted_catalog_once() -> dict:
    """Refresh deterministic trusted feeds that do not require moderation."""
    import unicornroad_parser

    result = await unicornroad_parser.crawl_unicornroad(
        max_per_section=100,
        force_refresh=False,
        active_only=True,
    )
    logger.info("trusted grant catalog refresh: %s", result)
    return result


async def run_autodiscovery_loop() -> None:
    """Hourly deadline checks plus a daily refresh of all grant sources."""
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    refresh_every_checks = max(1, LOOP_INTERVAL_SECONDS // DEADLINE_CHECK_INTERVAL_SECONDS)
    checks_since_refresh = refresh_every_checks
    while True:
        try:
            await sync_deadlines_once()
        except Exception as e:  # noqa: BLE001
            logger.error("grant deadline sync error: %s: %s", type(e).__name__, e, exc_info=True)

        if checks_since_refresh >= refresh_every_checks:
            try:
                await refresh_trusted_catalog_once()
            except Exception as e:  # noqa: BLE001
                logger.error("trusted grant refresh error: %s: %s", type(e).__name__, e, exc_info=True)
            try:
                await run_autodiscovery_once()
            except Exception as e:  # noqa: BLE001
                logger.error("autodiscover loop error: %s: %s", type(e).__name__, e, exc_info=True)
            checks_since_refresh = 0

        checks_since_refresh += 1
        await asyncio.sleep(DEADLINE_CHECK_INTERVAL_SECONDS)
