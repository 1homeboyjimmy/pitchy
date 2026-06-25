"""Гранты как проекция паспорта (Спринт 3).

Два узла:
  • match_grant / match_grants — детерминированный матчинг паспорта проекта
    с грантом: hard-фильтры (гео/стадия/юр.форма) + soft-скоринг (0..100).
  • generate_application — генерация унифицированной заявки из полей
    паспорта через LLM; пустые поля паспорта явно помечаются как пробелы,
    чтобы пользователь видел, что дозаполнить.

Принцип hard-фильтра: грант отсекается ТОЛЬКО при явном конфликте (у
проекта есть значение, и оно не подходит). Неизвестное поле паспорта не
прячет грант — оно идёт мягким штрафом и попадает в reasons.missing,
чтобы подсветить «дозаполни паспорт».
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from urllib.parse import urljoin, urlparse

logger = logging.getLogger("app")


# Официальные логотипы известных организаторов (чёткие ассеты в /public/logos).
# Ключ — подстрока в названии организации (в нижнем регистре).
_OFFICIAL_LOGOS: list[tuple[tuple[str, ...], str]] = [
    (("фонд содействия", "фси", "fasie", "содействия инновациям"), "/logos/fsi.svg"),
    (("фрии", "интернет-инициатив", "frii"), "/logos/frii.svg"),
    (("сколково", "skolkovo"), "/logos/skolkovo.svg"),
    (("рфрит", "развития информационных технологий"), "/logos/rfrit.png"),
]


def official_logo_for(organization: str | None) -> str | None:
    """Официальный логотип организатора по названию (для известных фондов).

    Возвращает путь к локальному ассету или None, если организатор неизвестен —
    тогда вызывающий код берёт favicon сайта (derive_logo_url)."""
    if not organization:
        return None
    org = organization.strip().lower()
    for keys, path in _OFFICIAL_LOGOS:
        if any(k in org for k in keys):
            return path
    return None


def resolve_logo(organization: str | None, url: str | None, explicit: str | None = None) -> str | None:
    """Единая логика выбора логотипа: явный → официальный по организатору →
    favicon сайта программы."""
    if explicit:
        return explicit
    return official_logo_for(organization) or derive_logo_url(url)


def derive_logo_url(url: str | None) -> str | None:
    """Логотип организации-грантодателя по домену её сайта.

    Используется парсером и ручным созданием гранта: если явный логотип не
    задан, берём favicon домена через Google S2 — это работает для любого
    источника без ручной выгрузки картинок. Явный logo_url всегда в приоритете.
    """
    if not url:
        return None
    try:
        host = urlparse(url if "://" in url else f"https://{url}").hostname
        if not host:
            return None
        host = host.lstrip(".")
        # Кириллические (IDN) домены кодируем в punycode — иначе favicon-сервис
        # по ним не находит иконку.
        try:
            host = host.encode("idna").decode("ascii")
        except Exception:
            pass
        return f"https://www.google.com/s2/favicons?domain={host}&sz=128"
    except Exception:
        return None


# ── Извлечение гранта из ссылки (админ-парсер) ──────────────────────────────
# Словари нормированы под матчинг (см. match_grant): значения сравниваются в
# нижнем регистре, поэтому LLM просим выбирать строго из этих наборов.
_ALLOWED_STAGES = ["pre-seed", "seed", "growth", "scale"]
_ALLOWED_SECTORS = [
    "it", "ai", "biotech", "medtech", "hardware", "energy", "agro",
    "fintech", "edtech", "creative", "media", "education", "ecommerce", "industry",
]
_ALLOWED_ENTITIES = ["ООО", "ИП", "самозанятый", "физлицо", "НКО"]


async def fetch_page_text(url: str, max_chars: int = 14000, include_links: bool = False) -> str:
    """Скачивает страницу и вытаскивает читаемый текст (title + meta + body)."""
    import httpx
    from bs4 import BeautifulSoup

    headers = {"User-Agent": "Mozilla/5.0 (compatible; PitchyGrantsBot/1.0)"}
    timeout = httpx.Timeout(25.0, connect=10.0, read=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as c:
        r = await c.get(url if "://" in url else f"https://{url}")
        r.raise_for_status()
        html = r.text

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "header", "footer", "nav", "form"]):
        tag.decompose()

    if include_links:
        # Preserve actionable URLs for structured extractors. get_text() alone
        # turns “Регистрация по ссылке” into plain text and loses the href.
        for anchor in soup.find_all("a", href=True):
            href = urljoin(str(r.url), (anchor.get("href") or "").strip())
            if href.lower().startswith(("http://", "https://")):
                label = anchor.get_text(" ", strip=True) or "Ссылка"
                anchor.replace_with(f"{label} [{href}]")

    parts: list[str] = []
    if soup.title and soup.title.string:
        parts.append(soup.title.string.strip())
    md = soup.find("meta", attrs={"name": "description"})
    if md and md.get("content"):
        parts.append(md["content"].strip())
    parts.append(soup.get_text("\n", strip=True))

    full = re.sub(r"\n{3,}", "\n\n", "\n".join(p for p in parts if p))
    return full[:max_chars]


def _parse_iso_date(s):
    from datetime import datetime
    if not s or not isinstance(s, str):
        return None
    s = s.strip()[:10]
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None


def _status_from_dates(opens_at, deadline) -> str:
    from datetime import datetime
    now = datetime.utcnow()
    if deadline and deadline < now:
        return "closed"
    if opens_at and opens_at > now:
        return "upcoming"
    return "open"


def _coerce_list(values, allowed: list[str] | None = None) -> list[str]:
    if isinstance(values, str):
        values = [values]
    out: list[str] = []
    allowed_low = {a.lower(): a for a in (allowed or [])}
    for v in values or []:
        v = str(v).strip()
        if not v:
            continue
        if allowed_low:
            canon = allowed_low.get(v.lower())
            if canon:
                out.append(canon)
        else:
            out.append(v)
    # без дублей, сохраняя порядок
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def _normalize_extracted(data: dict, url: str) -> dict:
    """Приводит сырой ответ LLM к черновику гранта (поля GrantCreateRequest)."""
    def num(v):
        try:
            return float(v) if v not in (None, "", "?") else None
        except Exception:
            return None

    opens_at = _parse_iso_date(data.get("opens_at"))
    deadline = _parse_iso_date(data.get("deadline"))
    status = (data.get("status") or "").strip().lower()
    if status not in ("open", "upcoming", "closed"):
        status = _status_from_dates(opens_at, deadline)

    geo = (data.get("geo") or "").strip() or "RF"

    return {
        "name": (data.get("name") or "").strip()[:300],
        "organization": (data.get("organization") or "").strip()[:300] or None,
        "description": (data.get("description") or "").strip() or None,
        "url": url,
        "logo_url": derive_logo_url(url),
        "amount_min": num(data.get("amount_min")),
        "amount_max": num(data.get("amount_max")),
        "geo": geo,
        "stages": _coerce_list(data.get("stages"), _ALLOWED_STAGES),
        "sectors": _coerce_list(data.get("sectors"), _ALLOWED_SECTORS),
        "entity_types": _coerce_list(data.get("entity_types"), _ALLOWED_ENTITIES),
        "requirements": data.get("requirements") if isinstance(data.get("requirements"), dict) else None,
        "opens_at": opens_at.isoformat() if opens_at else None,
        "deadline": deadline.isoformat() if deadline else None,
        "status": status,
    }


async def extract_grant_from_url(url: str) -> dict:
    """Скачивает страницу гранта и извлекает поля через LLM. Возвращает
    черновик (НЕ сохраняет) — админ проверяет и правит перед сохранением."""
    from datetime import datetime
    text = await fetch_page_text(url)
    if not text.strip():
        raise ValueError("Не удалось прочитать содержимое страницы")

    today = datetime.utcnow().strftime("%Y-%m-%d")
    system_prompt = (
        "Ты — аналитик грантовых программ для российских стартапов. По тексту "
        "страницы извлеки структурированные данные о грантовой/акселерационной "
        "программе. Не выдумывай: если поля нет на странице — ставь null (или []). "
        "Описание (description) делай максимально полным и точным: суть программы, "
        "кому подходит, условия, что финансируется, как подать.\n"
        "Даты возвращай в формате YYYY-MM-DD. Суммы — числом в рублях без пробелов "
        "и символов (если в тексте «млн» — переведи в рубли).\n"
        f"stages выбирай ТОЛЬКО из: {_ALLOWED_STAGES}.\n"
        f"sectors (направления) выбирай ТОЛЬКО из: {_ALLOWED_SECTORS}.\n"
        f"entity_types (кому подходит) выбирай ТОЛЬКО из: {_ALLOWED_ENTITIES}.\n"
        "geo: 'RF' для всей России или код/название региона.\n"
        "Верни СТРОГО JSON с ключами: name, organization, description, amount_min, "
        "amount_max, geo, stages (массив), sectors (массив), entity_types (массив), "
        "opens_at, deadline, requirements (объект ключ→значение доп. условий), status "
        "(open/upcoming/closed). Без markdown, только JSON."
    )
    user_prompt = f"URL: {url}\nСЕГОДНЯ: {today}\n\nТЕКСТ СТРАНИЦЫ:\n{text}"

    from makura_client import call_makura
    import os
    model = os.getenv("GRANTS_MODEL") or os.getenv("MAKURA_MODEL")
    raw, _, _usage = await call_makura(system_prompt, user_prompt, model=model)

    parsed: dict = {}
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            s, e = raw.find("{"), raw.rfind("}")
            parsed = json.loads(raw[s:e + 1]) if s >= 0 and e > s else {}
    if not isinstance(parsed, dict) or not (parsed.get("name") or "").strip():
        raise ValueError("Не удалось извлечь данные гранта со страницы")

    return _normalize_extracted(parsed, url)

# Веса soft-критериев. Сумма применимых весов нормируется к 100.
_WEIGHTS = {
    "stage": 30,
    "sector": 30,
    "geo": 20,
    "entity": 20,
}

_WORD_RE = re.compile(r"[\wа-яёА-ЯЁ]{3,}", re.UNICODE)


def _norm(v) -> str:
    return str(v or "").strip().lower()


def _passport_signals(passport: dict | None) -> dict:
    """Достаёт из паспорта поля, по которым матчим грант."""
    passport = passport or {}
    core = passport.get("core") or {}
    legal = passport.get("legal") or {}
    # Текст для определения сектора: бизнес-модель + решение + проблема.
    sector_text = " ".join(
        _norm(core.get(k)) for k in ("business_model", "solution", "problem", "name")
    )
    explicit_sectors = core.get("sectors") or core.get("sector") or []
    if isinstance(explicit_sectors, str):
        explicit_sectors = [explicit_sectors]
    return {
        "geo": _norm(core.get("geo")),
        "stage": _norm(core.get("stage")),
        "entity_type": _norm(legal.get("entity_type")),
        "sector_text": sector_text,
        "explicit_sectors": [_norm(s) for s in explicit_sectors],
    }


def _list_norm(values) -> list[str]:
    return [_norm(v) for v in (values or []) if _norm(v)]


def match_grant(passport: dict | None, grant) -> tuple[int, bool, dict]:
    """Сопоставляет паспорт с одним грантом.

    grant — ORM-объект Grant или dict с полями geo/stages/sectors/entity_types.
    Возвращает (score 0..100, hard_pass, reasons).
    """
    sig = _passport_signals(passport)

    def gget(field):
        return getattr(grant, field, None) if not isinstance(grant, dict) else grant.get(field)

    g_geo = _norm(gget("geo"))
    g_stages = _list_norm(gget("stages"))
    g_sectors = _list_norm(gget("sectors"))
    g_entities = _list_norm(gget("entity_types"))

    matched: list[str] = []
    missing: list[str] = []
    conflict = False

    applicable_weight = 0
    got_weight = 0

    # ── Стадия ──
    if g_stages:
        applicable_weight += _WEIGHTS["stage"]
        if not sig["stage"]:
            missing.append("стадия проекта")
        elif sig["stage"] in g_stages:
            got_weight += _WEIGHTS["stage"]
            matched.append(f"стадия: {sig['stage']}")
        else:
            conflict = True  # стадия задана и не подходит

    # ── Юр. форма ──
    if g_entities:
        applicable_weight += _WEIGHTS["entity"]
        if not sig["entity_type"]:
            missing.append("юр. форма")
        elif sig["entity_type"] in g_entities:
            got_weight += _WEIGHTS["entity"]
            matched.append(f"юр. форма: {sig['entity_type']}")
        else:
            conflict = True

    # ── Гео ── (RF/пусто = без ограничений)
    if g_geo and g_geo != "rf":
        applicable_weight += _WEIGHTS["geo"]
        if not sig["geo"]:
            missing.append("география")
        elif sig["geo"] == g_geo or sig["geo"] == "rf":
            got_weight += _WEIGHTS["geo"]
            matched.append(f"гео: {sig['geo']}")
        else:
            conflict = True

    # ── Сектор ── (мягкий: пересечение явных секторов или вхождение слов)
    if g_sectors:
        applicable_weight += _WEIGHTS["sector"]
        hit = None
        for s in g_sectors:
            if s in sig["explicit_sectors"] or s in sig["sector_text"]:
                hit = s
                break
        if hit:
            got_weight += _WEIGHTS["sector"]
            matched.append(f"сектор: {hit}")
        elif not sig["sector_text"] and not sig["explicit_sectors"]:
            missing.append("сектор/направление")
        # иначе сектор просто не совпал — не конфликт, грант остаётся ниже в списке

    # Скоринг: доля полученного веса от применимого. Если у гранта вообще
    # нет ограничений (applicable_weight=0) — это «открытый» грант, базовый
    # балл 50, чтобы не уходил в самый низ.
    if applicable_weight == 0:
        score = 50
    else:
        score = round(got_weight * 100 / applicable_weight)

    hard_pass = not conflict
    reasons = {"matched": matched, "missing": missing, "conflict": conflict}
    return score, hard_pass, reasons


def match_grants(passport: dict | None, grants: list) -> list[dict]:
    """Матчит паспорт со списком грантов. Возвращает отсортированный список
    словарей {grant, score, hard_pass, reasons}. Прошедшие hard-фильтр идут
    первыми, внутри — по убыванию score."""
    out = []
    for g in grants:
        score, hard_pass, reasons = match_grant(passport, g)
        out.append({"grant": g, "score": score, "hard_pass": hard_pass, "reasons": reasons})
    out.sort(key=lambda x: (x["hard_pass"], x["score"]), reverse=True)
    return out


# ——— Генерация заявки ———

_APPLICATION_SECTIONS = [
    ("summary", "Краткое описание проекта"),
    ("problem", "Проблема, которую решает проект"),
    ("solution", "Предлагаемое решение"),
    ("market", "Рынок и целевая аудитория"),
    ("team", "Команда"),
    ("budget", "Запрашиваемое финансирование и статьи расходов"),
    ("impact", "Ожидаемый результат и социально-экономический эффект"),
]


def _passport_brief(passport: dict | None) -> tuple[str, list[str]]:
    """Готовит текстовую выжимку паспорта для промпта + список пробелов
    (незаполненных важных полей), которые надо явно отметить в заявке."""
    import passport as passport_lib
    dump = passport_lib.build_passport_prompt(passport, max_chars=3000)
    gaps = passport_lib.missing_sections(passport)
    return dump or "(паспорт почти пустой)", gaps


async def _generate_group(group: dict, *, fund_guidance: str, grant_facts: str,
                          brief: str, extra_context: str, model: str | None) -> tuple[dict, dict]:
    """Один LLM-вызов на группу разделов шаблона. Возвращает (секции, usage)."""
    from makura_client import call_makura

    spec = "\n".join(
        f'- "{s["key"]}" — {s["label"]}: {s.get("hint", "")}'.rstrip()
        for s in group["sections"]
    )
    keys_json = ", ".join(f'"{s["key"]}": "..."' for s in group["sections"])
    system_prompt = (
        fund_guidance
        + f"\n\nСейчас заполни ТОЛЬКО раздел заявки «{group['title']}». "
        "Каждое поле — связный осмысленный текст на основе паспорта проекта, "
        "без воды. Если данных в паспорте нет — пометка '[нужно дозаполнить: <что>]'.\n"
        "Верни СТРОГО JSON без markdown: {\"sections\": {" + keys_json + "}}"
    )
    user_prompt = (
        grant_facts
        + f"ПАСПОРТ ПРОЕКТА:\n{brief}\n\n"
        + (f"ДОПОЛНИТЕЛЬНО ОТ ПОЛЬЗОВАТЕЛЯ:\n{extra_context}\n\n" if extra_context else "")
        + f"ПОЛЯ РАЗДЕЛА «{group['title']}» (заполни каждое):\n{spec}"
    )
    raw, _, usage = await call_makura(system_prompt, user_prompt, model=model)
    out: dict[str, str] = {}
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            s, e = raw.find("{"), raw.rfind("}")
            parsed = json.loads(raw[s:e + 1]) if s >= 0 and e > s else {}
        out = parsed.get("sections") or {}
    return out, (usage or {})


async def generate_application(passport: dict | None, grant, extra_context: str = "") -> dict:
    """Генерирует заявку по шаблону конкретного гранта.

    static — поля из положения (без LLM); содержательные разделы — батчами по
    группам (параллельные LLM-вызовы, чтобы влезать в лимит токенов и не ждать
    последовательно); user_input — то, что заполняет сам заявитель.

    Пробелы паспорта НЕ выдумываются: пустые поля помечаются
    «[нужно дозаполнить: ...]».
    """
    from grant_templates import select_application_template

    def gget(field):
        return getattr(grant, field, None) if not isinstance(grant, dict) else grant.get(field)

    template = select_application_template(grant)
    brief, gaps = _passport_brief(passport)
    grant_name = gget("name") or "грант"
    grant_org = gget("organization") or ""
    requirements = gget("requirements") or {}
    grant_facts = (
        f"ГРАНТ: {grant_name}" + (f" ({grant_org})" if grant_org else "") + "\n"
        f"ТРЕБОВАНИЯ ГРАНТА: {json.dumps(requirements, ensure_ascii=False)}\n\n"
    )

    model = os.getenv("GRANTS_MODEL") or os.getenv("MAKURA_MODEL")
    sections: dict[str, str] = {}
    usage_total = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    try:
        results = await asyncio.gather(*[
            _generate_group(
                g, fund_guidance=template["fund_guidance"], grant_facts=grant_facts,
                brief=brief, extra_context=extra_context, model=model,
            )
            for g in template["groups"]
        ], return_exceptions=True)
        for g, res in zip(template["groups"], results):
            if isinstance(res, Exception):
                logger.error(f"grant gen group '{g['id']}' failed: {res}")
                continue
            part, usage = res
            if isinstance(part, dict):
                sections.update(part)
            for k in usage_total:
                try:
                    usage_total[k] += int(usage.get(k) or 0)
                except Exception:
                    pass
    except Exception as e:  # noqa: BLE001
        logger.error(f"grant application generation failed: {e}")

    # Порядок и подписи разделов для рендера; заглушки для пустых.
    section_meta: list[dict] = []
    for g in template["groups"]:
        for s in g["sections"]:
            if not sections.get(s["key"]):
                sections[s["key"]] = f"[нужно дозаполнить: {s['label'].lower()}]"
            section_meta.append({
                "key": s["key"], "label": s["label"],
                "group_id": g["id"], "group_title": g["title"],
            })

    logger.info(
        f"grant application generated (template={template['key']}, "
        f"model={model}, tokens={usage_total})"
    )

    return {
        "template_key": template["key"],
        "template_title": template["title"],
        "sections": sections,
        "section_meta": section_meta,
        "static": template.get("static", {}),
        "user_input": template.get("user_input", []),
        "gaps": gaps,
        "model": model,
        "usage": usage_total,
    }
