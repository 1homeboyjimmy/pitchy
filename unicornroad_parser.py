"""Парсер каталога unicornroad.ru (мероприятия / акселераторы / конкурсы /
питчи / инвесторы).

Сайт сделан на Tilda; листинги — Tilda Feed, который отдаёт чистый JSON по
адресу feeds.tildacdn.com/api/getfeed/?feeduid=<uid>. Поэтому НЕ нужен ни
headless-браузер, ни LLM-извлечение: берём структурированные данные напрямую.

Для мероприятий/питчей дополнительно тянем детальный пост (getpost) — там в
теле есть «Место проведения: <точный адрес>», полная дата и расширенное
описание. getpost делаем только для НОВЫХ постов (дедуп по url до запроса),
параллельно с ограничением одновременных соединений.

Импортируем программы как Grant с category/location и moderation='pending'
(в очередь модерации, дедуп по url).
"""

from __future__ import annotations

import asyncio
import html as _html
import logging
import re
from datetime import datetime

import httpx

from db_async import AsyncSessionLocal
from models import Grant
from schemas import GrantCreateRequest
from sqlalchemy import select

import grants_service

logger = logging.getLogger("app")

FEED_API = "https://feeds.tildacdn.com/api/getfeed/"
GETPOST_API = "https://feeds.tildacdn.com/api/getpost/"

# Раздел unicornroad → (feeduid, наша категория Grant.category).
CATEGORY_FEEDS: dict[str, tuple[str, str]] = {
    "event": ("815171717021", "event"),          # Мероприятия
    "accelerator": ("136624724761", "accelerator"),  # Акселераторы, пилоты
    "competition": ("323486553191", "contest"),  # Конкурсы, премии
    "pitch": ("609928344201", "pitch"),          # Питчи, демо-дни
    "fund": ("116970686291", "investor"),        # Активные инвесторы
}

# Для этих разделов тянем детальный пост ради точного адреса/описания.
_ENRICH_SECTIONS = {"event", "pitch"}

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; PitchyBot/1.0)"}
_GETPOST_CONCURRENCY = 8


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except (ValueError, AttributeError):
            continue
    return None


def _location_from_parts(parts: str | None) -> str | None:
    """Город/формат из тега фида: «#Санкт-Петербург,Тема» → «Санкт-Петербург»."""
    if not parts:
        return None
    first = parts.split(",")[0].strip()
    return first[1:].strip() or None if first.startswith("#") else None


def _text_to_lines(text: str | None) -> list[str]:
    """HTML тела поста → список непустых текстовых строк."""
    if not text:
        return []
    t = re.sub(r"</(p|div|h[1-6]|li)>", "\n", text, flags=re.I)
    t = re.sub(r"<br[^>]*>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = _html.unescape(t)
    lines = []
    for line in t.split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            lines.append(line)
    return lines


def _enrich_from_post(post_full: dict, parts: str | None) -> tuple[str | None, str | None]:
    """Из детального поста достаём (точная локация, расширенное описание)."""
    lines = _text_to_lines(post_full.get("text"))
    location = None
    body: list[str] = []
    for line in lines:
        low = line.lower()
        if low.startswith("место проведения") and ":" in line:
            location = line.split(":", 1)[1].strip() or None
            continue
        if low.startswith("дата:"):
            continue
        body.append(line)
    if not location:
        location = _location_from_parts(parts)
    description = "\n".join(body).strip()[:3000] or None
    return location, description


async def _fetch_feed(feeduid: str, max_posts: int) -> list[dict]:
    """Тянет посты фида с пагинацией через nextslice до max_posts."""
    posts: list[dict] = []
    params = {"feeduid": feeduid}
    timeout = httpx.Timeout(25.0, connect=10.0, read=20.0)
    async with httpx.AsyncClient(timeout=timeout, headers=_HEADERS) as c:
        while len(posts) < max_posts:
            r = await c.get(FEED_API, params=params)
            r.raise_for_status()
            data = r.json()
            batch = data.get("posts") or []
            if not batch:
                break
            posts.extend(batch)
            nextslice = data.get("nextslice")
            if not nextslice:
                break
            params = {"feeduid": feeduid, "slice": str(nextslice)}
    return posts[:max_posts]


async def _fetch_post(client: httpx.AsyncClient, feeduid: str, postuid: str) -> dict:
    try:
        r = await client.get(GETPOST_API, params={"feeduid": feeduid, "postuid": postuid})
        r.raise_for_status()
        return (r.json() or {}).get("post") or {}
    except Exception:  # noqa: BLE001
        return {}


async def _enrich_posts(feeduid: str, posts: list[dict]) -> dict[str, tuple[str | None, str | None]]:
    """Параллельно тянет детальные посты и извлекает (локация, описание) по uid."""
    sem = asyncio.Semaphore(_GETPOST_CONCURRENCY)
    out: dict[str, tuple[str | None, str | None]] = {}
    timeout = httpx.Timeout(25.0, connect=10.0, read=20.0)

    async with httpx.AsyncClient(timeout=timeout, headers=_HEADERS) as client:
        async def work(post: dict):
            uid = post.get("uid")
            if not uid:
                return
            async with sem:
                full = await _fetch_post(client, feeduid, uid)
            out[uid] = _enrich_from_post(full, post.get("parts"))

        await asyncio.gather(*[work(p) for p in posts], return_exceptions=True)
    return out


def _post_to_draft(post: dict, category: str, location: str | None, description: str | None) -> dict | None:
    """Пост Tilda Feed → черновик полей GrantCreateRequest. None — мусорный пост."""
    title = (post.get("title") or "").strip()
    url = (post.get("url") or "").strip()
    if not title or not url or not url.lower().startswith("http"):
        return None

    description = description or (post.get("descr") or "").strip() or None
    if location is None:
        location = _location_from_parts(post.get("parts"))

    requirements: dict[str, str] = {}
    directlink = (post.get("directlink") or "").strip()
    if directlink.lower().startswith("http"):
        requirements["Первоисточник"] = directlink

    # Инвесторы/фонды — постоянные программы без «даты подачи»; дата в фиде там
    # заглушка, поэтому дедлайн не ставим, чтобы их не скрывало автоскрытие.
    deadline = None if category == "investor" else _parse_date(post.get("date"))

    # Лого: известный фонд в названии → официальный ассет; иначе обложка (если
    # есть) или None (фронт покажет цветную монограмму по категории).
    image = (post.get("image") or "").strip()
    logo_url = (
        grants_service.official_logo_for(title)
        or (image if image.lower().startswith("http") else None)
    )

    return {
        "name": title[:300],
        "description": description,
        "url": url,
        "logo_url": logo_url,
        "deadline": deadline,
        "category": category,
        "geo": "RF",
        "location": location,
        "requirements": requirements or None,
    }


async def crawl_unicornroad(sections: list[str] | None = None, max_per_section: int = 40) -> dict:
    """Импортирует программы с unicornroad в каталог (moderation='pending').

    sections — ключи CATEGORY_FEEDS (по умолчанию все). Дедуп по url до getpost
    (не тратим запросы на существующие). Для мероприятий/питчей тянем точный
    адрес и описание из детального поста. Возвращает счётчики по разделам."""
    targets = sections or list(CATEGORY_FEEDS.keys())
    result: dict[str, dict] = {}

    async with AsyncSessionLocal() as db:
        for section in targets:
            feed = CATEGORY_FEEDS.get(section)
            if not feed:
                result[section] = {"error": "неизвестный раздел"}
                continue
            feeduid, category = feed
            new = skipped = errors = 0
            try:
                posts = await _fetch_feed(feeduid, max_per_section)
            except Exception as e:  # noqa: BLE001
                result[section] = {"error": f"фид не открылся: {e}"}
                continue

            # Сначала отсекаем уже существующие (дедуп по url) — чтобы getpost
            # делать только для новых постов.
            fresh: list[dict] = []
            for post in posts:
                url = (post.get("url") or "").strip()
                if not url or not url.lower().startswith("http"):
                    skipped += 1
                    continue
                exists = await db.execute(select(Grant.id).where(Grant.url == url))
                if exists.scalar_one_or_none() is not None:
                    skipped += 1
                    continue
                fresh.append(post)

            # Обогащение (точный адрес + описание) — только для нужных разделов.
            enriched: dict[str, tuple[str | None, str | None]] = {}
            if section in _ENRICH_SECTIONS and fresh:
                try:
                    enriched = await _enrich_posts(feeduid, fresh)
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"unicornroad enrich failed ({section}): {e}")

            for post in fresh:
                loc, desc = enriched.get(post.get("uid", ""), (None, None))
                draft = _post_to_draft(post, category, loc, desc)
                if not draft:
                    skipped += 1
                    continue
                try:
                    payload = GrantCreateRequest(**draft)
                except Exception as e:  # noqa: BLE001
                    errors += 1
                    logger.warning(f"unicornroad draft invalid ({draft.get('url')}): {e}")
                    continue
                db.add(Grant(**payload.model_dump(), source="unicornroad", moderation="pending"))
                new += 1

            if new:
                await db.commit()
            result[section] = {"new": new, "skipped": skipped, "errors": errors, "category": category}

    return result
