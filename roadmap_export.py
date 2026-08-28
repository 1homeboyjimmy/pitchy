"""PDF дорожной карты: собирает export_templates/roadmap_pdf.html из
результата roadmap_service.build_roadmap(). Сам рендер (Jinja2 + WeasyPrint,
шрифты, блокировка внешних ресурсов) живёт в export_service."""

from __future__ import annotations

from datetime import datetime

import export_service

_STATUS_LABELS = {"done": "Завершён", "current": "В работе", "locked": "Впереди"}


def _item_text(value) -> str:
    """Элемент списка паспорта (конкурент/участник команды) → строка.
    Списки хранят и строки, и словари ({name, role, ...}) — склеиваем значения."""
    if isinstance(value, dict):
        parts = [str(v).strip() for v in value.values() if v and str(v).strip()]
        return " — ".join(parts)
    return str(value).strip() if value is not None else ""


def _field_display(field: dict) -> dict:
    value = field.get("value")
    if field.get("type") == "select" and value is not None:
        option = next(
            (item for item in (field.get("options") or []) if item.get("value") == value),
            None,
        )
        if option:
            value = option.get("label") or value
    filled = bool(field.get("filled"))
    text = None
    items = None
    if filled:
        if isinstance(value, list):
            items = [t for t in (_item_text(v) for v in value) if t]
            filled = bool(items)
        elif isinstance(value, dict):
            text = _item_text(value)
            filled = bool(text)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            # 240000 → «240 000» (числовые поля паспорта: MRR, пользователи)
            text = f"{value:,.0f}".replace(",", " ") if float(value).is_integer() else f"{value:,}".replace(",", " ")
        else:
            text = str(value).strip()
            filled = bool(text)
    return {
        "label": field.get("label") or field.get("path"),
        "filled": filled,
        "text": text,
        # НЕ "items": в Jinja f.items разрешается в метод dict.items, а не в ключ
        "list_items": items,
    }


def render_roadmap_pdf(project_name: str, roadmap: dict) -> bytes:
    checkpoints = []
    for cp in roadmap.get("checkpoints") or []:
        checkpoints.append({
            "title": cp.get("title"),
            "subtitle": cp.get("subtitle"),
            "reward": cp.get("reward"),
            "status": cp.get("status"),
            "status_label": _STATUS_LABELS.get(cp.get("status"), ""),
            "filled": cp.get("filled", 0),
            "total": cp.get("total", 0),
            "fields": [_field_display(f) for f in cp.get("fields") or []],
        })

    analysis = roadmap.get("analysis") or {}
    analysis_html = None
    analysis_date = None
    sources = []
    if analysis.get("text"):
        # Аналитика — markdown из LLM-стрима: чистим маркеры/мысли и рендерим
        # с теми же стилями таблиц, что и у экспорта ответов чата.
        analysis_html = export_service.markdown_to_html(
            export_service.strip_llm_markup(analysis["text"])
        )
        generated_at = analysis.get("generated_at")
        if generated_at:
            try:
                analysis_date = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00")).strftime("%d.%m.%Y")
            except ValueError:
                analysis_date = None
        sources = [
            {"title": str(s.get("title") or ""), "url": str(s.get("url") or "")}
            for s in (analysis.get("sources") or [])
            if isinstance(s, dict) and (s.get("title") or s.get("url"))
        ]

    return export_service.render_pdf_template(
        "roadmap_pdf.html",
        {
            "project_name": project_name or "Проект",
            "date": datetime.now().strftime("%d.%m.%Y"),
            "progress": roadmap.get("progress", 0),
            "stage": roadmap.get("stage") or {},
            "completed": roadmap.get("completed", 0),
            "total": roadmap.get("total", 0),
            "checkpoints": checkpoints,
            "analysis_html": analysis_html,
            "analysis_date": analysis_date,
            "analysis_stale": bool(analysis.get("stale")),
            "analysis_stage_label": analysis.get("stage_label"),
            "analysis_progress": analysis.get("progress"),
            "sources": sources,
        },
    )
