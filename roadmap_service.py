"""Дорожная карта проекта = гид по заполнению паспорта.

Карта НЕ отдельная сущность (старый ProjectTree был оторван от паспорта и
generic). Здесь она вычисляется из Project.passport: чекпоинты соответствуют
секциям паспорта, заполнение узла пишется обратно в паспорт через
PATCH /projects/{id}/passport (source=manual, с защитой ручных полей).

Награда за этап — про РЕЗУЛЬТАТ и готовность (точнее подбор грантов, сильнее
заявка, выше индекс готовности), а НЕ бесплатный доступ к платным функциям.
"""

from __future__ import annotations

import passport as plib

# Чекпоинты карты. Поля: (path, label, type). type — для рендера формы на фронте.
# reward — что улучшается в РЕЗУЛЬТАТЕ (не раздача платного).
CHECKPOINTS: list[dict] = [
    {
        "id": "idea",
        "title": "Идея и проблема",
        "subtitle": "С чего начинается проект",
        "reward": "Чёткая суть проекта — основа всех материалов и заявок",
        "fields": [
            ("core.name", "Название проекта", "text"),
            ("core.problem", "Какую проблему решаете", "textarea"),
            ("core.solution", "Ваше решение", "textarea"),
            ("core.target_audience", "Целевая аудитория", "textarea"),
        ],
    },
    {
        "id": "market",
        "title": "Рынок",
        "subtitle": "Объём и конкуренты",
        "reward": "Точнее подбор грантов под ваш проект",
        "fields": [
            ("core.geo", "География", "text"),
            ("market.size", "Объём рынка (TAM/SAM/SOM)", "textarea"),
            ("market.competitors", "Конкуренты", "list"),
        ],
    },
    {
        "id": "model",
        "title": "Модель и метрики",
        "subtitle": "Как зарабатываете и где находитесь",
        "reward": "Корректная юнит-экономика и точный скоринг идеи",
        "fields": [
            ("core.stage", "Стадия проекта", "text"),
            ("core.business_model", "Бизнес-модель", "text"),
            ("metrics.mrr", "Выручка в месяц (MRR), ₽", "number"),
            ("metrics.users", "Пользователей", "number"),
        ],
    },
    {
        "id": "team",
        "title": "Команда",
        "subtitle": "Кто делает проект",
        "reward": "Сильнее блок «Команда» в грантовых заявках",
        "fields": [
            ("team", "Участники команды", "list"),
        ],
    },
    {
        "id": "legal",
        "title": "Юр. данные",
        "subtitle": "Форма и реквизиты",
        "reward": "Полная готовность подавать заявки на гранты",
        "fields": [
            ("legal.entity_type", "Юр. форма (ООО/ИП/физлицо)", "text"),
        ],
    },
]


def _field_state(passport: dict, path: str, label: str, ftype: str) -> dict:
    value = plib._get_path(passport, path)
    filled = plib._is_filled(value)
    if isinstance(value, list):
        preview = f"{len(value)} шт." if value else None
        out_value = value
    elif isinstance(value, dict):
        preview = None
        out_value = value
    else:
        preview = value if isinstance(value, (str, int, float)) else None
        out_value = value
    return {
        "path": path,
        "label": label,
        "type": ftype,
        "filled": filled,
        "value": out_value,
        "preview": preview,
        "source": plib.field_source(passport, path),
    }


def build_roadmap(passport: dict | None) -> dict:
    """Считает карту из паспорта: чекпоинты со статусами/прогрессом/наградами."""
    passport = passport or {}
    checkpoints: list[dict] = []
    prev_done = True

    for cp in CHECKPOINTS:
        fields = [_field_state(passport, p, l, t) for p, l, t in cp["fields"]]
        filled = sum(1 for f in fields if f["filled"])
        total = len(fields)
        done = total > 0 and filled == total
        # Линейная разблокировка: текущий — первый незавершённый после
        # завершённых; дальше — заблокировано (геймификация прохождения).
        if done:
            status = "done"
        elif prev_done:
            status = "current"
        else:
            status = "locked"
        checkpoints.append({
            "id": cp["id"],
            "title": cp["title"],
            "subtitle": cp["subtitle"],
            "reward": cp["reward"],
            "status": status,
            "filled": filled,
            "total": total,
            "progress": round(filled * 100 / total) if total else 0,
            "fields": fields,
        })
        prev_done = prev_done and done

    next_id = next((c["id"] for c in checkpoints if c["status"] == "current"), None)

    return {
        "readiness": plib.compute_readiness(passport),
        "checkpoints": checkpoints,
        "next": next_id,
        "completed": sum(1 for c in checkpoints if c["status"] == "done"),
        "total": len(checkpoints),
    }
