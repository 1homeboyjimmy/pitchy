"""Парсер каталога unicornroad.ru (мероприятия / акселераторы / конкурсы /
питчи / инвесторы).

Сайт сделан на Tilda; листинги — Tilda Feed, который отдаёт чистый JSON по
адресу feeds.tildacdn.com/api/getfeed/?feeduid=<uid>. Поэтому НЕ нужен ни
headless-браузер, ни LLM-извлечение: берём структурированные данные напрямую.

Для мероприятий/питчей дополнительно тянем детальный пост (getpost) — там в
теле есть «Место проведения: <точный адрес>», полная дата и расширенное
описание. getpost делаем только для НОВЫХ постов (дедуп по url до запроса),
параллельно с ограничением одновременных соединений.

Unicorn Road is a curated, structured feed, so imported programs are published
immediately. Free-form sources discovered by grants_autodiscover still go
through the moderation queue.
"""

from __future__ import annotations

import asyncio
import html as _html
import logging
import re
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse

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
_SOURCE_CONCURRENCY = 3


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


def _event_format(parts: str | None, location: str | None) -> str | None:
    value = f"{parts or ''} {location or ''}".lower()
    online = any(x in value for x in ("онлайн", "online", "вебинар"))
    offline = any(x in value for x in ("офлайн", "offline", "очно", "москва", "санкт-петербург"))
    if online and offline:
        return "hybrid"
    if online:
        return "online"
    if offline or location:
        return "offline"
    return None


def _external_links(raw_html: str | None, discovery_url: str | None) -> list[tuple[str, str, str]]:
    """External links from the post body, preserving the visible label."""
    if not raw_html:
        return []
    from bs4 import BeautifulSoup

    base = discovery_url or "https://unicornroad.ru/"
    out: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for anchor in BeautifulSoup(raw_html, "html.parser").find_all("a", href=True):
        href = urljoin(base, (anchor.get("href") or "").strip())
        parsed = urlparse(href)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            continue
        host = (parsed.hostname or "").lower()
        if host == "unicornroad.ru" or host.endswith(".unicornroad.ru"):
            continue
        clean = href.split("#", 1)[0]
        if clean in seen:
            continue
        seen.add(clean)
        label = anchor.get_text(" ", strip=True)
        previous = anchor.previous_sibling
        nearby = previous.get_text(" ", strip=True) if hasattr(previous, "get_text") else str(previous or "")
        out.append((label, clean, f"{nearby[-120:]} {label}".strip()))
    return out


def _section_name(line: str) -> str | None:
    value = line.strip().lower().rstrip(":")
    if value in {"ключевые тезисы", "тезисы", "программа", "в программе", "темы", "о чем поговорим"}:
        return "agenda"
    if value in {"спикер", "спикеры", "эксперт", "эксперты"}:
        return "speakers"
    if value in {"условия участия", "участие", "стоимость", "для кого"}:
        return "participation"
    return None


def _split_speaker(value: str) -> dict[str, str | None]:
    chunks = re.split(r"\s+[—–-]\s+", value.strip(), maxsplit=1)
    name = chunks[0].strip()
    rest = chunks[1].strip() if len(chunks) > 1 else None
    return {"name": name, "role": rest, "organization": None, "bio": None}


def _enrich_from_post(post_full: dict, parts: str | None) -> dict:
    """Parse a Tilda post without flattening useful event structure."""
    raw_html = post_full.get("text") or ""
    lines = _text_to_lines(raw_html)
    location = None
    body: list[str] = []
    agenda: list[str] = []
    speaker_lines: list[str] = []
    participation: list[str] = []
    section = None

    for line in lines:
        low = line.lower()
        if low.startswith("место проведения") and ":" in line:
            location = line.split(":", 1)[1].strip() or None
            continue
        if low.startswith("дата:"):
            continue
        found_section = _section_name(line)
        if found_section:
            section = found_section
            continue
        if low.startswith(("регистрация по ", "зарегистрироваться", "регистрация:")):
            section = None
            continue
        cleaned = re.sub(r"^[\-–—•·]\s*", "", line).strip()
        if section == "agenda":
            agenda.append(cleaned)
        elif section == "speakers":
            speaker_lines.append(cleaned)
        elif section == "participation":
            participation.append(cleaned)
        else:
            body.append(line)

    if not location:
        location = _location_from_parts(parts)
    links = _external_links(raw_html, post_full.get("url"))
    registration_url = next(
        (href for _label, href, context in links if re.search(r"регист|участ|подать|заяв", context, re.I)),
        None,
    )
    # The primary action is conventionally the last outbound link in Unicorn
    # Road posts. A detected registration link is even stronger evidence.
    source_url = registration_url or (links[-1][1] if links else None)
    if not registration_url and len(links) == 1:
        registration_url = links[0][1]

    details = {
        "agenda": agenda,
        "speakers": [_split_speaker(x) for x in speaker_lines if x],
        "participation_terms": "\n".join(participation).strip() or None,
    }
    return {
        "location": location,
        "description": "\n\n".join(body).strip()[:12000] or None,
        "event_format": _event_format(parts, location),
        "source_url": source_url,
        "registration_url": registration_url,
        "event_details": details,
        "aggregator_text": "\n".join(lines),
    }


def _merge_source_details(base: dict, source: dict) -> dict:
    """Fill gaps from the canonical page; deterministic Tilda facts win."""
    if not isinstance(source, dict):
        return base
    for key in ("location", "event_format", "description"):
        if not base.get(key) and isinstance(source.get(key), str):
            base[key] = source[key].strip() or None
    if not base.get("registration_url"):
        candidate = source.get("registration_url")
        if isinstance(candidate, str) and candidate.lower().startswith(("http://", "https://")):
            base["registration_url"] = candidate.strip()

    details = base.setdefault("event_details", {})
    if not details.get("agenda") and isinstance(source.get("agenda"), list):
        details["agenda"] = [
            str(item).strip() for item in source["agenda"]
            if isinstance(item, (str, int, float)) and str(item).strip()
        ][:30]
    if not details.get("speakers") and isinstance(source.get("speakers"), list):
        details["speakers"] = [
            {
                "name": str(item.get("name") or "").strip(),
                "role": str(item.get("role") or "").strip() or None,
                "organization": str(item.get("organization") or "").strip() or None,
                "bio": str(item.get("bio") or "").strip() or None,
            }
            for item in source["speakers"]
            if isinstance(item, dict) and str(item.get("name") or "").strip()
        ][:20]
    if not details.get("participation_terms") and isinstance(source.get("participation_terms"), str):
        details["participation_terms"] = source["participation_terms"].strip() or None
    if not base.get("organization") and isinstance(source.get("organization"), str):
        base["organization"] = source["organization"].strip()[:300] or None
    return base


async def _enrich_from_source(data: dict) -> dict:
    """Use the canonical source only when the aggregator left meaningful gaps."""
    source_url = data.get("source_url")
    details = data.get("event_details") or {}
    if not source_url or (
        details.get("agenda") and details.get("speakers")
        and details.get("participation_terms") and data.get("description")
    ):
        return data
    try:
        source_text = await grants_service.fetch_page_text(source_url, max_chars=18000, include_links=True)
        if not source_text.strip():
            return data
        from slm_dispatcher import slm_dispatcher
        extracted = await slm_dispatcher.extract_event_details(source_text, data.get("aggregator_text") or "")
        return _merge_source_details(data, extracted)
    except Exception as e:  # noqa: BLE001
        logger.info("unicornroad source enrichment skipped (%s): %s", source_url, e)
        return data


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


async def _enrich_posts(feeduid: str, posts: list[dict]) -> dict[str, dict]:
    """Fetch detailed Tilda posts, then fill gaps from canonical sources."""
    sem = asyncio.Semaphore(_GETPOST_CONCURRENCY)
    source_sem = asyncio.Semaphore(_SOURCE_CONCURRENCY)
    out: dict[str, dict] = {}
    timeout = httpx.Timeout(25.0, connect=10.0, read=20.0)

    async with httpx.AsyncClient(timeout=timeout, headers=_HEADERS) as client:
        async def work(post: dict):
            uid = post.get("uid")
            if not uid:
                return
            async with sem:
                full = await _fetch_post(client, feeduid, uid)
            data = _enrich_from_post(full, post.get("parts"))
            async with source_sem:
                data = await _enrich_from_source(data)
            data.pop("aggregator_text", None)
            out[uid] = data

        await asyncio.gather(*[work(p) for p in posts], return_exceptions=True)
    return out


def _post_to_draft(post: dict, category: str, enrichment: dict | None = None) -> dict | None:
    """Пост Tilda Feed → черновик полей GrantCreateRequest. None — мусорный пост."""
    title = (post.get("title") or "").strip()
    url = (post.get("url") or "").strip()
    if not title or not url or not url.lower().startswith("http"):
        return None

    enrichment = enrichment or {}
    description = enrichment.get("description") or (post.get("descr") or "").strip() or None
    location = enrichment.get("location")
    if location is None:
        location = _location_from_parts(post.get("parts"))

    requirements: dict[str, str] = {}
    directlink = (post.get("directlink") or "").strip()
    if directlink.lower().startswith("http"):
        requirements["Первоисточник"] = directlink
    source_url = enrichment.get("source_url") or (directlink if directlink.lower().startswith("http") else None)

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
        "source_url": source_url,
        "registration_url": enrichment.get("registration_url"),
        "organization": enrichment.get("organization"),
        "logo_url": logo_url,
        "deadline": deadline,
        "status": grants_service._status_from_dates(None, deadline),
        "category": category,
        "geo": "RF",
        "location": location,
        "event_format": enrichment.get("event_format"),
        "event_details": enrichment.get("event_details") or None,
        "requirements": requirements or None,
    }


async def crawl_unicornroad(
    sections: list[str] | None = None,
    max_per_section: int = 40,
    force_refresh: bool = False,
    active_only: bool = False,
) -> dict:
    """Импортирует программы с unicornroad прямо в публичный каталог.

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
            new = updated = skipped = errors = 0
            try:
                posts = await _fetch_feed(feeduid, max_per_section)
            except Exception as e:  # noqa: BLE001
                result[section] = {"error": f"фид не открылся: {e}"}
                continue
            if active_only and section in _ENRICH_SECTIONS:
                # Tilda keeps a deep archive in the same feed. Manual refresh
                # is meant for what users can still attend, not 1000+ expired
                # events. A one-day grace window avoids timezone edge cases.
                cutoff = datetime.utcnow() - timedelta(days=1)
                posts = [p for p in posts if (_parse_date(p.get("date")) or datetime.min) >= cutoff]

            # Existing Unicorn Road rows created by older parser versions are
            # refreshed once so rich fields and canonical links are backfilled.
            fresh: list[dict] = []
            existing_by_url: dict[str, Grant] = {}
            for post in posts:
                url = (post.get("url") or "").strip()
                if not url or not url.lower().startswith("http"):
                    skipped += 1
                    continue
                exists = await db.execute(select(Grant).where(Grant.url == url))
                grant = exists.scalar_one_or_none()
                if grant is not None:
                    needs_refresh = (
                        getattr(grant, "source", None) == "unicornroad"
                        and section in _ENRICH_SECTIONS
                        and (force_refresh or not grant.source_url or not grant.event_details)
                    )
                    if not needs_refresh:
                        skipped += 1
                        continue
                    existing_by_url[url] = grant
                fresh.append(post)

            # Обогащение (точный адрес + описание) — только для нужных разделов.
            enriched: dict[str, dict] = {}
            if section in _ENRICH_SECTIONS and fresh:
                try:
                    enriched = await _enrich_posts(feeduid, fresh)
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"unicornroad enrich failed ({section}): {e}")

            for post in fresh:
                draft = _post_to_draft(post, category, enriched.get(post.get("uid", "")))
                if not draft:
                    skipped += 1
                    continue
                try:
                    payload = GrantCreateRequest(**draft)
                except Exception as e:  # noqa: BLE001
                    errors += 1
                    logger.warning(f"unicornroad draft invalid ({draft.get('url')}): {e}")
                    continue
                data = payload.model_dump()
                existing = existing_by_url.get(draft["url"])
                if existing is not None:
                    # Only parser-owned content is refreshed. Moderation and
                    # user-facing workflow state remain untouched.
                    for field in (
                        "organization", "description", "source_url", "registration_url",
                        "deadline", "status", "category", "geo", "location", "event_format",
                        "event_details", "requirements", "logo_url",
                    ):
                        value = data.get(field)
                        if value not in (None, "", [], {}):
                            setattr(existing, field, value)
                    updated += 1
                else:
                    db.add(Grant(**data, source="unicornroad", moderation="approved"))
                    new += 1

            if new or updated:
                await db.commit()
            result[section] = {
                "new": new, "updated": updated, "skipped": skipped,
                "errors": errors, "category": category,
            }

    return result
