from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional

class IntentClassification(BaseModel):
    """Классификация интента пользователя для выбора правильного конвейера обработки."""
    intent: str = Field(..., description="Типы: finance, search, roadmap, chat, presentation, legal")
    reasoning: str = Field(..., description="Обоснование выбора именно этого интента")
    confidence: float = Field(..., ge=0, le=1)

class RoadmapEditResponse(BaseModel):
    """Схема для обновления дорожной карты (Smart Roadmap)."""
    action: str = Field(..., description="Типы: ADD_NODE, DELETE_NODE, UPDATE_STATUS, REGENERATE")
    node_id: Optional[str] = None
    node_content: Optional[str] = None
    priority: Optional[int] = Field(None, ge=1, le=5)
    justification: str = Field(..., description="Почему это изменение необходимо для проекта")

class FinanceResponse(BaseModel):
    """Схема для детального финансового анализа Unit-экономики."""
    cac: float = Field(..., description="Customer Acquisition Cost")
    ltv: float = Field(..., description="Lifetime Value")
    payback_period: float = Field(..., description="Период окупаемости в месяцах")
    risks: List[str] = Field(..., description="Список финансовых рисков")
    recommendations: List[str] = Field(..., description="Рекомендации по улучшению маржинальности")
