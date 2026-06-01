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

import json
import logging
import re

logger = logging.getLogger("app")

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


async def generate_application(passport: dict | None, grant, extra_context: str = "") -> dict:
    """Генерирует секции заявки из паспорта. Возвращает
    {"sections": {key: text}, "gaps": [...], "model": str}.

    Пробелы паспорта НЕ выдумываются: в соответствующих секциях LLM
    инструктируется явно пометить «[нужно дозаполнить: ...]».
    """
    def gget(field):
        return getattr(grant, field, None) if not isinstance(grant, dict) else grant.get(field)

    brief, gaps = _passport_brief(passport)
    grant_name = gget("name") or "грант"
    grant_org = gget("org") or gget("organization") or ""
    requirements = gget("requirements") or {}

    sections_spec = "\n".join(f"- {key}: {label}" for key, label in _APPLICATION_SECTIONS)

    system_prompt = (
        "Ты — эксперт по грантовым заявкам для российских стартапов. На основе "
        "паспорта проекта составь унифицированную заявку под конкретный грант. "
        "Пиши деловым языком, по делу, без воды. Не выдумывай факты: если данных "
        "в паспорте нет, в тексте секции явно поставь пометку вида "
        "'[нужно дозаполнить: <что именно>]'. Бюджет указывай в рамках суммы "
        "гранта, если она задана.\n"
        "Верни СТРОГО JSON: {\"sections\": {\"summary\": \"...\", \"problem\": \"...\", "
        "\"solution\": \"...\", \"market\": \"...\", \"team\": \"...\", \"budget\": \"...\", "
        "\"impact\": \"...\"}}"
    )
    user_prompt = (
        f"ГРАНТ: {grant_name}" + (f" ({grant_org})" if grant_org else "") + "\n"
        f"СУММА: {gget('amount_min') or '?'}–{gget('amount_max') or '?'} ₽\n"
        f"ТРЕБОВАНИЯ: {json.dumps(requirements, ensure_ascii=False)}\n\n"
        f"ПАСПОРТ ПРОЕКТА:\n{brief}\n\n"
        + (f"ДОПОЛНИТЕЛЬНО:\n{extra_context}\n\n" if extra_context else "")
        + f"СЕКЦИИ ЗАЯВКИ (заполни каждую):\n{sections_spec}"
    )

    sections: dict[str, str] = {}
    model_used = None
    try:
        from makura_client import call_makura
        import os
        model = os.getenv("GRANTS_MODEL") or os.getenv("MAKURA_MODEL")
        raw, _, _usage = await call_makura(system_prompt, user_prompt, model=model)
        model_used = model
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                s, e = raw.find("{"), raw.rfind("}")
                parsed = json.loads(raw[s:e + 1]) if s >= 0 and e > s else {}
            sections = parsed.get("sections") or {}
    except Exception as e:
        logger.error(f"grant application generation failed: {e}")

    # Гарантируем наличие всех ключей (пустые → заглушка-пробел).
    for key, label in _APPLICATION_SECTIONS:
        if not sections.get(key):
            sections[key] = f"[нужно дозаполнить: {label.lower()}]"

    return {"sections": sections, "gaps": gaps, "model": model_used}
