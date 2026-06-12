"""Парсер каталога unicornroad.ru (мероприятия / акселераторы / конкурсы /
питчи / инвесторы).

Сайт сделан на Tilda; листинги — Tilda Feed, который отдаёт чистый JSON по
адресу feeds.tildacdn.com/api/getfeed/?feeduid=<uid>. Поэтому НЕ нужен ни
headless-браузер, ни LLM-извлечение: берём структурированные данные напрямую.

Каждый раздел сайта = отдельный feed (feeduid захардкожены ниже). Импортируем
программы как Grant с category и moderation='pending' (в очередь модерации,
дедуп по url). Описания берём как есть (решение пользователя); дополнительно
сохраняем ссылку на первоисточник, если она указана в посте.
"""

from __future__ import annotations

import logging
from datetime import datetime

import httpx

from db_async import AsyncSessionLocal
from models import Grant
from schemas import GrantCreateRequest
from sqlalchemy import select

logger = logging.getLogger("app")

FEED_API = "https://feeds.tildacdn.com/api/getfeed/"

# Раздел unicornroad → (feeduid, наша категория Grant.category).
CATEGORY_FEEDS: dict[str, tuple[str, str]] = {
    "event": ("815171717021", "event"),          # Мероприятия
    "accelerator": ("136624724761", "accelerator"),  # Акселераторы, пилоты
    "competition": ("323486553191", "contest"),  # Конкурсы, премии
    "pitch": ("609928344201", "pitch"),          # Питчи, демо-дни
    "fund": ("116970686291", "investor"),        # Активные инвесторы
}

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; PitchyBot/1.0)"}


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except (ValueError, AttributeError):
            continue
    return None


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


def _post_to_draft(post: dict, category: str) -> dict | None:
    """Пост Tilda Feed → черновик полей GrantCreateRequest. None — мусорный пост."""
    title = (post.get("title") or "").strip()
    url = (post.get("url") or "").strip()
    if not title or not url or not url.lower().startswith("http"):
        return None

    descr = (post.get("descr") or "").strip()
    text = (post.get("text") or "").strip()
    description = descr or text or None

    requirements: dict[str, str] = {}
    tag = (post.get("parts") or "").strip()
    if tag:
        requirements["Подкатегория"] = tag
    directlink = (post.get("directlink") or "").strip()
    if directlink.lower().startswith("http"):
        requirements["Первоисточник"] = directlink

    # Инвесторы/фонды — постоянные программы без «даты подачи»; дата в фиде
    # там заглушка, поэтому дедлайн не ставим, чтобы их не скрывало автоскрытие.
    deadline = None if category == "investor" else _parse_date(post.get("date"))

    # Обложка поста (CDN Tilda) — визуал карточки. Фронт отличает обложку от
    # белого лого по домену tildacdn и рисует её цветной миниатюрой.
    image = (post.get("image") or "").strip()
    logo_url = image if image.lower().startswith("http") else None

    return {
        "name": title[:300],
        "description": description,
        "url": url,
        "logo_url": logo_url,
        "deadline": deadline,
        "category": category,
        "geo": "RF",
        "requirements": requirements or None,
    }


async def crawl_unicornroad(sections: list[str] | None = None, max_per_section: int = 40) -> dict:
    """Импортирует программы с unicornroad в каталог (moderation='pending').

    sections — список ключей CATEGORY_FEEDS (по умолчанию все). Дедуп по url:
    существующие (в любом статусе) пропускаем, чтобы не плодить дубли и уважать
    прошлые решения модератора. Возвращает счётчики по разделам."""
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

            for post in posts:
                draft = _post_to_draft(post, category)
                if not draft:
                    skipped += 1
                    continue
                exists = await db.execute(select(Grant.id).where(Grant.url == draft["url"]))
                if exists.scalar_one_or_none() is not None:
                    skipped += 1
                    continue
                try:
                    payload = GrantCreateRequest(**draft)
                except Exception as e:  # noqa: BLE001
                    errors += 1
                    logger.warning(f"unicornroad draft invalid ({draft.get('url')}): {e}")
                    continue
                grant = Grant(**payload.model_dump(), source="unicornroad", moderation="pending")
                db.add(grant)
                new += 1

            if new:
                await db.commit()
            result[section] = {"new": new, "skipped": skipped, "errors": errors, "category": category}

    return result
