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
        "subtitle": "Юридическая форма проекта",
        "reward": "Полная готовность подавать заявки на гранты",
        "fields": [
            ("legal.entity_type", "Юр. форма (ООО/ИП/физлицо)", "text"),
        ],
    },
]


def invalidate_analyses(passport: dict, changed_paths: set[str]) -> dict:
    """Drop reports made stale by a passport edit and preserve other assets."""
    if not changed_paths:
        return passport

    updated = dict(passport)
    assets = dict(updated.get("assets") or {})
    assets.pop("roadmap_analysis", None)
    step_analyses = dict(assets.get("roadmap_step_analyses") or {})
    for checkpoint in CHECKPOINTS:
        checkpoint_paths = {path for path, _label, _type in checkpoint["fields"]}
        if changed_paths & checkpoint_paths:
            step_analyses.pop(checkpoint["id"], None)
    if step_analyses:
        assets["roadmap_step_analyses"] = step_analyses
    else:
        assets.pop("roadmap_step_analyses", None)
    if assets:
        updated["assets"] = assets
    else:
        updated.pop("assets", None)
    return updated


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
    assets = passport.get("assets") or {}
    saved_step_analyses = assets.get("roadmap_step_analyses") or {}
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
        saved_step = saved_step_analyses.get(cp["id"]) if isinstance(saved_step_analyses, dict) else None
        step_analysis = None
        if isinstance(saved_step, dict) and saved_step.get("text"):
            step_analysis = {
                "text": saved_step["text"],
                "generated_at": saved_step.get("generated_at"),
            }
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
            "analysis": step_analysis,
        })
        prev_done = prev_done and done

    next_id = next((c["id"] for c in checkpoints if c["status"] == "current"), None)

    # Прогресс ИМЕННО карты (заполнено её полей) — чтобы 5/5 этапов = 100%.
    # Глобальный readiness паспорта считается отдельно (включает поля вне карты,
    # напр. CustDev), поэтому здесь используем покрытие карты.
    total_fields = sum(c["total"] for c in checkpoints)
    filled_fields = sum(c["filled"] for c in checkpoints)
    progress = round(filled_fields * 100 / total_fields) if total_fields else 0

    # Ранее сгенерированная общая аналитика (чтобы фронт показал её сразу, а не
    # предлагал генерировать заново). Лежит в passport.assets.roadmap_analysis.
    saved = assets.get("roadmap_analysis")
    analysis = None
    if isinstance(saved, dict) and saved.get("text"):
        analysis = {
            "text": saved.get("text"),
            "sources": saved.get("sources") or [],
            "generated_at": saved.get("generated_at"),
        }

    return {
        "readiness": plib.compute_readiness(passport),
        "progress": progress,
        "checkpoints": checkpoints,
        "next": next_id,
        "completed": sum(1 for c in checkpoints if c["status"] == "done"),
        "total": len(checkpoints),
        "analysis": analysis,
    }
