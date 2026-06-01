"""Паспорт проекта — единая схема полей и операции над ней.

Паспорт хранится в Project.passport (JSONB). Структура:

    {
      "core":    {"name", "problem", "solution", "target_audience",
                  "stage", "business_model", "geo"},
      "market":  {"size", "competitors": [...]},
      "metrics": {"mrr", "users", "cac", "growth"},
      "team":    [...],                 # список участников
      "custdev": {"personas": [...], "interviews_done"},
      "legal":   {"entity_type", "inn", "requisites"},
      "assets":  {"deck_session_id", "roadmap_id"},
      "custom":  {...},                 # свободные пары ключ-значение
      "_meta":   {"core.problem": {"source": "ai", "confidence": 0.8,
                                    "updated_at": "..."}}
    }

`_meta` хранит источник каждого значимого поля: manual | ai | grant.
Правило приоритета: ИИ НЕ перезаписывает manual-поля молча — только
предлагает (см. propose_ai_update). ai-поля обновляются свободно.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

# Ключевые поля для индекса готовности. Вес показывает важность секции:
# core важнее custom. (field_path, weight).
KEY_FIELDS: list[tuple[str, int]] = [
    ("core.name", 3),
    ("core.problem", 3),
    ("core.solution", 3),
    ("core.target_audience", 2),
    ("core.stage", 1),
    ("core.business_model", 2),
    ("core.geo", 1),
    ("market.size", 2),
    ("market.competitors", 1),
    ("metrics.mrr", 1),
    ("metrics.users", 1),
    ("team", 2),
    ("custdev.personas", 1),
    ("legal.entity_type", 1),
]

# Человекочитаемые названия секций для подсказок «не хватает».
SECTION_LABELS: dict[str, str] = {
    "core": "Основное",
    "market": "Рынок",
    "metrics": "Метрики",
    "team": "Команда",
    "custdev": "CustDev",
    "legal": "Юр. данные",
}


def _get_path(passport: dict, path: str) -> Any:
    """Достаёт значение по пути 'section.field' или 'section' (для списков)."""
    parts = path.split(".")
    cur: Any = passport
    for p in parts:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
        if cur is None:
            return None
    return cur


def _is_filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return len(value) > 0
    if isinstance(value, (int, float)):
        return True
    return bool(value)


def compute_readiness(passport: dict | None) -> int:
    """Возвращает 0..100 — взвешенный % заполненных ключевых полей."""
    passport = passport or {}
    total = sum(w for _, w in KEY_FIELDS)
    if total == 0:
        return 0
    got = sum(w for path, w in KEY_FIELDS if _is_filled(_get_path(passport, path)))
    return round(got * 100 / total)


def missing_sections(passport: dict | None) -> list[str]:
    """Список меток секций, где не заполнено ни одно ключевое поле —
    для подсветки «не хватает: метрики, команда»."""
    passport = passport or {}
    by_section: dict[str, bool] = {}
    for path, _ in KEY_FIELDS:
        section = path.split(".")[0]
        filled = _is_filled(_get_path(passport, path))
        by_section[section] = by_section.get(section, False) or filled
    out = []
    for section, has_any in by_section.items():
        if not has_any:
            out.append(SECTION_LABELS.get(section, section))
    return out


def merge_patch(passport: dict | None, fields: dict[str, Any], source: str = "manual") -> dict:
    """Мерджит плоскую карту 'section.field'->value в паспорт.

    Проставляет _meta[path] = {source, updated_at}. При source='manual'
    значение и метка перезаписываются всегда (пользователь главный).
    """
    passport = dict(passport or {})
    meta = dict(passport.get("_meta") or {})

    for path, value in fields.items():
        parts = path.split(".")
        if len(parts) == 1:
            # Списочные/скалярные секции верхнего уровня (team, custom...).
            passport[parts[0]] = value
        else:
            section = parts[0]
            sub = dict(passport.get(section) or {})
            cursor = sub
            for p in parts[1:-1]:
                nxt = dict(cursor.get(p) or {})
                cursor[p] = nxt
                cursor = nxt
            cursor[parts[-1]] = value
            passport[section] = sub
        meta[path] = {"source": source, "updated_at": datetime.utcnow().isoformat()}

    passport["_meta"] = meta
    return passport


def field_source(passport: dict | None, path: str) -> str:
    """Возвращает источник поля: manual | ai | grant | '' (нет метки)."""
    passport = passport or {}
    meta = passport.get("_meta") or {}
    entry = meta.get(path) or {}
    return entry.get("source", "")


def can_ai_overwrite(passport: dict | None, path: str) -> bool:
    """ИИ может молча перезаписать поле, только если оно НЕ manual."""
    return field_source(passport, path) != "manual"


def build_passport_prompt(passport: dict | None, max_chars: int = 1500) -> str:
    """Компактный дамп паспорта для подмешивания в системный промпт чата
    (пассивная память). Пустые поля опускаются."""
    passport = passport or {}
    lines: list[str] = []

    core = passport.get("core") or {}
    core_labels = {
        "name": "Проект", "problem": "Проблема", "solution": "Решение",
        "target_audience": "Аудитория", "stage": "Стадия",
        "business_model": "Бизнес-модель", "geo": "География",
    }
    for k, label in core_labels.items():
        v = core.get(k)
        if _is_filled(v):
            lines.append(f"{label}: {v}")

    market = passport.get("market") or {}
    if _is_filled(market.get("size")):
        lines.append(f"Объём рынка: {market['size']}")
    comp = market.get("competitors") or []
    if comp:
        lines.append("Конкуренты: " + ", ".join(str(c) for c in comp[:5]))

    metrics = passport.get("metrics") or {}
    metric_bits = [f"{k}={v}" for k, v in metrics.items() if _is_filled(v)]
    if metric_bits:
        lines.append("Метрики: " + ", ".join(metric_bits))

    team = passport.get("team") or []
    if team:
        lines.append(f"Команда: {len(team)} чел.")

    legal = passport.get("legal") or {}
    if _is_filled(legal.get("entity_type")):
        lines.append(f"Юр. форма: {legal['entity_type']}")

    if not lines:
        return ""

    dump = "\n".join(lines)
    if len(dump) > max_chars:
        dump = dump[:max_chars] + "…"
    return "ПАСПОРТ ПРОЕКТА (контекст из папки):\n" + dump
