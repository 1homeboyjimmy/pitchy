"""Progressive roadmap backed by ``Project.passport``.

The roadmap has one percentage and three maturity stages. Moving to a later
stage activates additional questions without deleting earlier answers or
reports. The percentage always describes completeness for the current stage.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import passport as plib


STAGES: list[dict[str, Any]] = [
    {
        "id": "hypothesis",
        "label": "Гипотеза",
        "title": "Гипотеза и проверка проблемы",
        "description": "Проблема, клиент, подтверждения и ближайший эксперимент",
    },
    {
        "id": "mvp",
        "label": "MVP",
        "title": "MVP и пилоты",
        "description": "Прототип, тесты, пилоты и ценовая гипотеза",
    },
    {
        "id": "sales",
        "label": "Продажи",
        "title": "Продажи и рост",
        "description": "Платящие клиенты, каналы и фактическая экономика",
    },
]
STAGE_INDEX = {stage["id"]: index for index, stage in enumerate(STAGES)}
DEFAULT_STAGE = "hypothesis"


def _field(
    path: str,
    label: str,
    field_type: str = "text",
    *,
    hint: str = "",
    min_stage: str = DEFAULT_STAGE,
    options: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    return {
        "path": path,
        "label": label,
        "type": field_type,
        "hint": hint,
        "min_stage": min_stage,
        "options": options or [],
    }


# Five stable thematic sections. Fields inside them are activated by maturity
# stage; this preserves the familiar map without asking an idea-stage student
# team for investor-level metrics that do not exist yet.
CHECKPOINTS: list[dict[str, Any]] = [
    {
        "id": "idea",
        "title": "Проблема и клиент",
        "subtitle": "Что проверяем и для кого",
        "reward": "Основание для содержательной аналитики уже на стадии идеи",
        "fields": [
            _field("core.name", "Название проекта", hint="Как называется проект?"),
            _field("core.problem", "Какую проблему решаете", "textarea", hint="Конкретная ситуация и боль клиента"),
            _field("core.target_audience", "Кто пользуется продуктом", "textarea", hint="Основной сегмент, а не все возможные аудитории"),
            _field("core.solution", "Как работает решение", "textarea", hint="Главный сценарий использования и результат для клиента"),
            _field("validation.evidence", "Чем подтверждена проблема", "textarea", hint="Интервью, наблюдения, заявки или честно: пока гипотеза"),
        ],
    },
    {
        "id": "market",
        "title": "Рынок и альтернативы",
        "subtitle": "Где и с чем конкурирует проект",
        "reward": "Проверяемый рынок вместо придуманного TAM/SAM/SOM",
        "fields": [
            _field("core.geo", "География", hint="Страна, регион или конкретные вузы/отрасли"),
            _field("market.segment", "Основной рыночный сегмент", "textarea", hint="Кто реально может стать первым клиентом"),
            _field("market.competitors", "Конкуренты и текущие альтернативы", "list", hint="Название или ссылка — по одному на строку"),
            _field("market.size", "Оценка рынка или числа клиентов", "textarea", min_stage="mvp", hint="Не обязательно TAM: можно указать число доступных организаций/пользователей"),
            _field("market.size_source", "Основание оценки рынка", "textarea", min_stage="mvp", hint="Источник, ссылка или прозрачное допущение"),
        ],
    },
    {
        "id": "traction",
        "title": "Продукт и трекшн",
        "subtitle": "Что уже проверено на практике",
        "reward": "Метрики соответствуют реальной стадии проекта",
        "fields": [
            _field("core.stage", "Текущее состояние продукта", hint="Идея, прототип, MVP, пилоты или продажи"),
            _field("validation.next_experiment", "Ближайший эксперимент", "textarea", hint="Что команда проверит в следующие 2–4 недели"),
            _field("validation.prototype", "Прототип или MVP", "textarea", min_stage="mvp", hint="Что уже работает и что пока сделано вручную"),
            _field("validation.testers", "Сколько человек или команд протестировали", "number", min_stage="mvp", hint="Можно написать «пока не измеряем»"),
            _field("validation.repeat_usage", "Повторное использование", "textarea", min_stage="mvp", hint="Сколько вернулось или какие повторные сценарии наблюдали"),
            _field("validation.pilots", "Пилоты, заявки или LOI", "textarea", min_stage="mvp", hint="Платные и бесплатные пилоты указывайте отдельно"),
            _field("validation.measurable_result", "Измеримый результат продукта", "textarea", min_stage="mvp", hint="Экономия времени, конверсия, скорость или другой эффект"),
            _field("metrics.users", "Активные пользователи или команды", "number", min_stage="sales", hint="Укажите период и кого считаете активным"),
            _field("metrics.paying_customers", "Платящие клиенты или организации", "number", min_stage="sales", hint="Отдельно от регистраций и бесплатных пилотов"),
            _field("metrics.mrr", "MRR, ₽", "number", min_stage="sales", hint="Регулярная месячная выручка на текущую дату"),
            _field("metrics.growth", "Динамика за последние 3 месяца", "textarea", min_stage="sales", hint="MRR, клиенты или использование — с периодом"),
            _field("metrics.churn", "Удержание или отток", "textarea", min_stage="sales", hint="Если не измеряется — так и напишите"),
        ],
    },
    {
        "id": "model",
        "title": "Монетизация",
        "subtitle": "Кто платит и за что",
        "reward": "Цены и экономика отделены от гипотез аналитика",
        "fields": [
            _field("core.business_model", "Как планируете зарабатывать", hint="Подписка, лицензия, комиссия, разовая оплата"),
            _field("monetization.payer", "Кто принимает решение и платит", "textarea", hint="Пользователь и плательщик могут быть разными"),
            _field("monetization.pricing_hypothesis", "Какую цену хотите проверить", "textarea", hint="Можно указать диапазон и почему клиент согласится платить"),
            _field(
                "monetization.pricing_status",
                "Статус цены",
                "select",
                min_stage="mvp",
                options=[
                    {"value": "hypothesis", "label": "Гипотеза — ещё не тестировали"},
                    {"value": "testing", "label": "Тестируем на пилотах"},
                    {"value": "active", "label": "Цена действует"},
                    {"value": "free", "label": "Монетизации пока нет"},
                ],
            ),
            _field("monetization.price_test", "Результат проверки цены", "textarea", min_stage="mvp", hint="Что предлагали, кому и какой была реакция"),
            _field("monetization.variable_costs", "Основные переменные расходы", "textarea", min_stage="mvp", hint="LLM, инфраструктура, поддержка, комиссия — можно приблизительно"),
            _field("monetization.actual_pricing", "Фактические тарифы и средний чек", "textarea", min_stage="sales", hint="Название, цена, период оплаты; B2C и B2B отдельно"),
            _field("acquisition.channels", "Работающие каналы привлечения", "textarea", min_stage="sales", hint="Укажите, откуда пришли реальные клиенты"),
            _field("acquisition.spend_monthly", "Расходы на привлечение за месяц, ₽", "number", min_stage="sales", hint="Для автоматического расчёта CAC"),
            _field("acquisition.new_paying_customers", "Новых платящих клиентов за месяц", "number", min_stage="sales", hint="За тот же месяц, что и расходы"),
            _field("sales.pipeline", "B2B-пайплайн", "textarea", min_stage="sales", hint="Переговоры, пилоты и ожидаемые контракты"),
            _field("sales.cycle", "Средний цикл B2B-сделки", "textarea", min_stage="sales", hint="Если B2C или неприменимо — так и напишите"),
        ],
    },
    {
        "id": "team",
        "title": "Команда и цель",
        "subtitle": "Кто делает проект и куда он идёт",
        "reward": "План развития, релевантный акселератору и текущей стадии",
        "fields": [
            _field("team", "Участники и роли", "list", hint="Имя, роль и занятость — по одному на строку"),
            _field("organization.team_gap", "Какой компетенции не хватает", "textarea", hint="Продажи, технология, отраслевой эксперт или другое"),
            _field("goals.next_90_days", "Главная цель на 90 дней", "textarea", hint="Один измеримый результат текущей стадии"),
            _field("goals.support_needed", "Какая помощь нужна", "textarea", min_stage="mvp", hint="Пилоты, экспертиза, грант, инвестиции или партнёры"),
        ],
    },
    {
        "id": "legal",
        "title": "Юридический статус",
        "subtitle": "Только то, что известно сейчас",
        "reward": "Корректный контекст для грантов без ложной полной готовности",
        "fields": [
            _field("legal.entity_type", "Юр. форма (ООО/ИП/физлицо)", hint="ООО, ИП, физлицо или пока не оформлено"),
        ],
    },
]


def get_stage_id(passport: dict | None) -> str:
    """Return an explicit stage, otherwise infer one for existing projects."""
    passport = passport or {}
    explicit = (passport.get("roadmap") or {}).get("stage")
    if explicit in STAGE_INDEX:
        return explicit

    metrics = passport.get("metrics") or {}
    if isinstance(metrics.get("mrr"), (int, float)) and metrics.get("mrr", 0) > 0:
        return "sales"
    if isinstance(metrics.get("paying_customers"), (int, float)) and metrics.get("paying_customers", 0) > 0:
        return "sales"

    stage_text = str((passport.get("core") or {}).get("stage") or "").lower()
    if any(token in stage_text for token in ("mvp", "мвп", "прототип", "пилот", "тест")):
        return "mvp"
    users = metrics.get("users")
    if isinstance(users, (int, float)) and users > 0:
        return "mvp"
    return DEFAULT_STAGE


def get_stage(passport: dict | None) -> dict[str, Any]:
    stage_id = get_stage_id(passport)
    return dict(STAGES[STAGE_INDEX[stage_id]])


def _field_is_active(field: dict[str, Any], stage_id: str) -> bool:
    return STAGE_INDEX[field.get("min_stage", DEFAULT_STAGE)] <= STAGE_INDEX[stage_id]


def active_checkpoint_definitions(passport: dict | None) -> list[dict[str, Any]]:
    stage_id = get_stage_id(passport)
    return [
        {**checkpoint, "fields": [field for field in checkpoint["fields"] if _field_is_active(field, stage_id)]}
        for checkpoint in CHECKPOINTS
    ]


def all_field_definitions() -> list[dict[str, Any]]:
    return [field for checkpoint in CHECKPOINTS for field in checkpoint["fields"]]


def analysis_snapshot(passport: dict | None) -> dict[str, Any]:
    """Compact immutable input snapshot used to explain report changes."""
    passport = passport or {}
    snapshot: dict[str, Any] = {"roadmap.stage": get_stage_id(passport)}
    for field in all_field_definitions():
        value = plib._get_path(passport, field["path"])
        if plib._is_filled(value):
            snapshot[field["path"]] = value
    custom = passport.get("custom")
    if isinstance(custom, dict) and custom:
        snapshot["custom"] = custom
    return snapshot


def changed_field_labels(previous: dict | None, current: dict | None) -> list[str]:
    previous = previous or {}
    current = current or {}
    labels = {field["path"]: field["label"] for field in all_field_definitions()}
    labels["roadmap.stage"] = "Стадия проекта"
    labels["custom"] = "Дополнительные данные"
    return [
        labels.get(path, path)
        for path in sorted(set(previous) | set(current))
        if previous.get(path) != current.get(path)
    ][:12]


def derive_metrics(passport: dict | None) -> dict[str, dict[str, Any]]:
    """Calculate only metrics whose raw inputs were explicitly provided."""
    passport = passport or {}
    metrics = passport.get("metrics") or {}
    acquisition = passport.get("acquisition") or {}
    derived: dict[str, dict[str, Any]] = {}

    reported_cac = metrics.get("cac")
    if isinstance(reported_cac, (int, float)):
        derived["reported_cac"] = {
            "label": "CAC, введённый пользователем",
            "value": reported_cac,
            "unit": "₽",
            "formula": "значение из прежнего паспорта проекта",
        }

    mrr = metrics.get("mrr")
    paying = metrics.get("paying_customers")
    if isinstance(mrr, (int, float)) and isinstance(paying, (int, float)) and paying > 0:
        derived["arppu"] = {
            "label": "Средняя регулярная выручка на платящего клиента",
            "value": round(mrr / paying, 2),
            "unit": "₽/мес",
            "formula": "MRR / платящие клиенты",
        }

    spend = acquisition.get("spend_monthly")
    new_paying = acquisition.get("new_paying_customers")
    if isinstance(spend, (int, float)) and isinstance(new_paying, (int, float)) and new_paying > 0:
        derived["calculated_cac"] = {
            "label": "CAC",
            "value": round(spend / new_paying, 2),
            "unit": "₽",
            "formula": "расходы на привлечение / новые платящие клиенты",
        }
    return derived


def invalidate_analyses(passport: dict, changed_paths: set[str]) -> dict:
    """Mark reports stale after edits while preserving their history."""
    if not changed_paths:
        return passport

    updated = dict(passport)
    assets = dict(updated.get("assets") or {})
    overall = assets.get("roadmap_analysis")
    if isinstance(overall, dict) and overall.get("text"):
        overall = dict(overall)
        overall["stale"] = True
        overall["stale_at"] = datetime.utcnow().isoformat()
        overall["stale_paths"] = sorted(changed_paths)
        assets["roadmap_analysis"] = overall

    step_analyses = dict(assets.get("roadmap_step_analyses") or {})
    for checkpoint in CHECKPOINTS:
        checkpoint_paths = {field["path"] for field in checkpoint["fields"]}
        if "roadmap.stage" in changed_paths or changed_paths & checkpoint_paths:
            saved = step_analyses.get(checkpoint["id"])
            if isinstance(saved, dict) and saved.get("text"):
                step_analyses[checkpoint["id"]] = {**saved, "stale": True}
    if step_analyses:
        assets["roadmap_step_analyses"] = step_analyses
    if assets:
        updated["assets"] = assets
    return updated


def _field_state(passport: dict, field: dict[str, Any]) -> dict[str, Any]:
    path = field["path"]
    value = plib._get_path(passport, path)
    filled = plib._is_filled(value)
    if isinstance(value, list):
        preview = f"{len(value)} шт." if value else None
    elif isinstance(value, dict):
        preview = None
    else:
        preview = value if isinstance(value, (str, int, float)) else None
    return {
        "path": path,
        "label": field["label"],
        "type": field["type"],
        "hint": field.get("hint", ""),
        "options": field.get("options", []),
        "min_stage": field.get("min_stage", DEFAULT_STAGE),
        "filled": filled,
        "value": value,
        "preview": preview,
        "source": plib.field_source(passport, path),
    }


def _safe_analysis(entry: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(entry, dict) or not entry.get("text"):
        return None
    return {
        "text": entry["text"],
        "sources": entry.get("sources") or [],
        "generated_at": entry.get("generated_at"),
        "stage": entry.get("stage"),
        "stage_label": entry.get("stage_label"),
        "progress": entry.get("progress"),
        "stale": bool(entry.get("stale")),
        "changed_fields": entry.get("changed_fields") or [],
    }


def build_roadmap(passport: dict | None) -> dict[str, Any]:
    passport = passport or {}
    assets = passport.get("assets") or {}
    stage = get_stage(passport)
    stage_id = stage["id"]
    saved_step_analyses = assets.get("roadmap_step_analyses") or {}
    checkpoints: list[dict[str, Any]] = []

    for checkpoint in active_checkpoint_definitions(passport):
        fields = [_field_state(passport, field) for field in checkpoint["fields"]]
        filled = sum(1 for field in fields if field["filled"])
        total = len(fields)
        done = total > 0 and filled == total
        saved_step = saved_step_analyses.get(checkpoint["id"]) if isinstance(saved_step_analyses, dict) else None
        step_analysis = None
        if isinstance(saved_step, dict) and saved_step.get("text"):
            step_analysis = {
                "text": saved_step["text"],
                "generated_at": saved_step.get("generated_at"),
                "stale": bool(saved_step.get("stale")),
            }
        checkpoints.append({
            "id": checkpoint["id"],
            "title": checkpoint["title"],
            "subtitle": checkpoint["subtitle"],
            "reward": checkpoint["reward"],
            "status": "done" if done else "current",
            "filled": filled,
            "total": total,
            "progress": round(filled * 100 / total) if total else 0,
            "fields": fields,
            "analysis": step_analysis,
        })

    total_fields = sum(checkpoint["total"] for checkpoint in checkpoints)
    filled_fields = sum(checkpoint["filled"] for checkpoint in checkpoints)
    progress = round(filled_fields * 100 / total_fields) if total_fields else 0
    next_id = next(
        (checkpoint["id"] for checkpoint in checkpoints if checkpoint["status"] != "done"),
        checkpoints[0]["id"] if checkpoints else None,
    )

    required_for_analysis = [
        ("core.problem", "проблему"),
        ("core.solution", "решение"),
        ("core.target_audience", "пользователя"),
    ]
    analysis_missing = [
        label
        for path, label in required_for_analysis
        if not plib._is_filled(plib._get_path(passport, path))
    ]

    stages = []
    current_index = STAGE_INDEX[stage_id]
    for index, item in enumerate(STAGES):
        stages.append({
            **item,
            "current": item["id"] == stage_id,
            "completed": index < current_index,
            "available": index <= current_index + 1,
        })

    analysis = _safe_analysis(assets.get("roadmap_analysis"))
    history_raw = assets.get("roadmap_analysis_versions") or []
    history = [_safe_analysis(item) for item in history_raw if isinstance(item, dict)]
    history = [item for item in history if item]
    history.sort(key=lambda item: item.get("generated_at") or "", reverse=True)

    return {
        # Compatibility for old consumers; UI/PDF display only one percent.
        "readiness": progress,
        "progress": progress,
        "stage": stage,
        "stages": stages,
        "checkpoints": checkpoints,
        "next": next_id,
        "completed": sum(1 for checkpoint in checkpoints if checkpoint["status"] == "done"),
        "total": len(checkpoints),
        "analysis_ready": not analysis_missing,
        "analysis_missing": analysis_missing,
        "analysis": analysis,
        "analysis_history": history,
        "derived_metrics": derive_metrics(passport),
    }
