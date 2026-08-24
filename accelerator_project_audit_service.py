"""Structured AI analysis for accelerator resident projects."""
from __future__ import annotations

import json
import os

from llm_client import get_instructor_client
from schemas.accelerators import ProjectAuditGeneratedResult


AUDIT_TYPE_INSTRUCTIONS = {
    "product": "Оцени ценностное предложение, проблему, решение, продуктовые гипотезы и готовность продукта.",
    "market": "Оцени рынок, сегменты клиентов, конкурентов, позиционирование и стратегию выхода на рынок.",
    "custdev": "Оцени качество клиентских гипотез, интервью, подтверждение проблемы и план следующих исследований.",
    "business_model": "Оцени бизнес-модель, каналы, монетизацию, экономику, масштабируемость и ключевые риски.",
    "grant": "Оцени готовность проекта к грантовой заявке: новизну, эффект, доказательства, команду и пробелы.",
}


async def generate_project_audit(
    *,
    audit_type: str,
    project_snapshot: dict,
    focus: str | None,
    client=None,
) -> ProjectAuditGeneratedResult:
    """Generate an evidence-based report using only the supplied project data."""
    if audit_type not in AUDIT_TYPE_INSTRUCTIONS:
        raise ValueError("Неизвестный тип аудита")
    if client is None:
        client = get_instructor_client("routerai")
    model = os.getenv("PROJECT_AUDIT_MODEL", "openai/gpt-4.1-mini")
    context = json.dumps(project_snapshot, ensure_ascii=False, default=str)
    if len(context) > 60000:
        context = context[:60000]
    return await client.chat.completions.create(
        model=model,
        response_model=ProjectAuditGeneratedResult,
        messages=[
            {
                "role": "system",
                "content": (
                    "Ты — строгий аналитик проектов акселератора. Опирайся только на "
                    "переданные данные, не выдумывай факты, метрики, интервью или источники. "
                    "Если информации недостаточно, явно перечисли пробелы в data_gaps. "
                    "Рекомендации должны быть конкретными, проверяемыми и пригодными для "
                    "превращения в задачи трекера. Отвечай по-русски. "
                    + AUDIT_TYPE_INSTRUCTIONS[audit_type]
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Дополнительный фокус: {focus or 'не задан'}\n\n"
                    f"Данные проекта:\n{context}"
                ),
            },
        ],
        temperature=0.2,
        max_tokens=5000,
        max_retries=2,
    )
