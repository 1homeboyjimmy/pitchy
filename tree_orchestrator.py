"""
AI Orchestrator for Smart Roadmap generation.
Powered by Makura (GLM-5).
"""
from __future__ import annotations

import json
import logging
import os
import uuid
import copy
from typing import Any

import httpx

from makura_client import call_makura
from core_tree import CORE_SKELETON

try:
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

class NullSpan:
    def update(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass

def get_span(name: str):
    if langfuse_context:
        return langfuse_context.span(name=name)
    return NullSpan()

logger = logging.getLogger("app")

# ——— Prompts ———

TREE_EXTRACTION_PROMPT = """Ты — опытный бизнес-аналитик стартапов. Твоя задача — проанализировать описание стартапа и извлечь ключевые факты для Интерактивной дорожной карты (Smart Roadmap).

Описание стартапа:
{description}

Извлеки следующие ключи (если они упомянуты явно или косвенно). Если данных нет, оставь значение пустым (null).
Верни СТРОГО JSON-объект вида:
{
  "readiness_index": <оценка готовности проекта от 0 до 100, число>,
  "title": "<Краткое название проекта (2-4 слова)>",
  "extracted_data": {
    "concept": "<суть проекта, 1 предложение>",
    "business_type": "<один из: B2B SaaS, Mobile App, E-commerce, Offline, Hardware, Marketplace, Other>",
    "client_type": "<один из: B2C, B2B, B2G>",
    "geo": "<география рынка, например 'Россия' или 'Global'>",
    "segment_size": <размер сегмента, число или null>,
    "pain_point": "<основная боль клиента>",
    "current_solution": "<как клиенты решают проблему сейчас>",
    "value_proposition": "<в чем ваше преимущество/УТП>",
    "key_features": "<ключевые фичи>",
    "competitor_names": "<имена конкурентов>",
    "competitive_advantage": "<наше конкурентное преимущество>",
    "tam": <общий рынок TAM, число или null>,
    "som": <достижимый рынок SOM, число или null>,
    "revenue_model": "<Подписка (SaaS), Транзакционная (Комиссия), Разовая продажа, Рекламная, Freemium, Другое>",
    "avg_check": <средний чек, число или null>,
    "cac": <стоимость привлечения, число или null>,
    "ltv": <пожизненная ценность, число или null>,
    "primary_channel": "<основной канал привлечения>",
    "secondary_channels": "<дополнительные каналы>",
    "team_size": <размер команды, число или 1>,
    "missing_roles": "<каких ролей не хватает>",
    "traction": "<текущий трекшн в метриках или словах>",
    "mvp_ready": "<Да, В разработке, или Нет (только идея)>",
    "top_risk": "<главный риск проекта>",
    "mitigation_plan": "<план Б по снижению риска>",
    "short_term_goal": "<ближайшая цель на 3 месяца>",
    "resources_needed": "<какие ресурсы нужны>"
  }
}

Верни ТОЛЬКО валидный JSON, без пояснений и markdown-блоков."""

ENRICH_NODE_PROMPT = """Ты — бизнес-эксперт по российскому рынку. Дополни информацию для блока Интерактивной дорожной карты (Smart Roadmap) стартапа.

Контекст стартапа: {context}

Блок: {node_label} (тип: {node_type})
Текущее описание: {current_description}

Дополни:
1. Развёрнутое описание (2-3 предложения)
2. Конкретные метрики, если применимо
3. Рекомендацию (1-2 предложения)

Отвечай на русском языке с учётом специфики российского бизнеса."""




# ——— Main orchestrator functions ———

@observe(name="Smart Roadmap Generation")
async def generate_tree_from_text(description: str) -> dict[str, Any]:
    """
    Generate a Smart Roadmap structure from text description.
    Uses Makura (GLM) for structure generation.
    Extracts flat key-value pairs and injects them into the CORE_SKELETON.
    """
    prompt = TREE_EXTRACTION_PROMPT.replace("{description}", description)

    # Use GLM-5 via RouterAI or Makura
    provider = os.getenv("PRIMARY_PROVIDER", "makura")
    logger.info(f"Using {provider} for Smart Roadmap structure generation")
    
    extracted = {}
    with get_span(name="Structure Extraction") as span:
        if provider == "makura":
            raw, _, _ = await call_makura("Ты — бизнес-аналитик. Извлекай данные СТРОГО в формате JSON.", prompt)
        else:
            raw, _, _ = await call_makura("Ты — бизнес-аналитик. Извлекай данные СТРОГО в формате JSON.", prompt)

        if not raw:
            logger.error("Makura extraction failed")
            return _generate_fallback_tree(description)

        # Parse JSON
        try:
            extracted = json.loads(raw) if raw else {}
        except Exception:
            try:
                start = raw.find("{")
                end = raw.rfind("}") + 1
                if start >= 0 and end > start:
                    extracted = json.loads(raw[start:end])
                else:
                    return _generate_fallback_tree(description)
            except Exception:
                return _generate_fallback_tree(description)
        
        span.update(metadata={"provider": provider, "raw_length": len(raw) if raw else 0})

    # Validate and normalize
    with get_span(name="Normalization & Mapping") as span:
        result = _normalize_tree_data(extracted, description)
        span.update(metadata={
            "nodes_count": len(result.get("tree_data", {}).get("nodes", [])),
            "readiness": result.get("readiness_index")
        })
        return result

def _normalize_tree_data(raw: dict, description: str) -> dict[str, Any]:
    """Normalize and map extracted flat data to the 13-node CORE_SKELETON."""
    readiness = raw.get("readiness_index", 10)
    title = raw.get("title", "Анализ стартапа")
    extracted_data = raw.get("extracted_data", {})
    
    if not isinstance(extracted_data, dict):
        extracted_data = {}

    try:
        readiness = max(0, min(100, int(readiness)))
    except (TypeError, ValueError):
        readiness = 10

    # Deepcopy our bulletproof structural backbone
    nodes = copy.deepcopy(CORE_SKELETON)

    # Inject extracted values into inputs
    for node in nodes:
        inputs = node.get("data", {}).get("inputs", [])
        total_required = 0
        filled_required = 0
        has_any_filled = False

        for inp in inputs:
            if inp.get("required"):
                total_required += 1
                
            field = inp.get("field")
            if field and field in extracted_data:
                val = extracted_data[field]
                if val is not None and str(val).strip() != "":
                    inp["value"] = val
                    inp["status"] = "completed"
                    has_any_filled = True
                    if inp.get("required"):
                        filled_required += 1

        # Determine node completion STATUS
        if total_required > 0:
            if filled_required == total_required:
                node["status"] = "completed"
            elif filled_required > 0 or has_any_filled:
                node["status"] = "partial"
            else:
                node["status"] = "empty"
        else:
            node["status"] = "completed" if has_any_filled else "empty"

    # Auto-generate perfect edges directly from parent_id
    edges = []
    for n in nodes:
        pid = n.get("parent_id")
        if pid:
            edges.append({
                "id": f"e-{pid}-{n['id']}",
                "source": pid,
                "target": n["id"]
            })

    return {
        "title": str(title)[:200],
        "readiness_index": readiness,
        "tree_data": {
            "nodes": nodes,
            "edges": edges,
        }
    }


async def generate_tree_from_pdf(text: str, page_refs: dict[str, int] | None = None) -> dict[str, Any]:
    """Generate tree from extracted PDF text. Adds source references."""
    tree_data = await generate_tree_from_text(text)

    # Add source references if available
    if page_refs and "nodes" in tree_data.get("tree_data", {}):
        for node in tree_data["tree_data"]["nodes"]:
            node_label_lower = node.get("label", "").lower()
            for keyword, page in page_refs.items():
                if keyword.lower() in node_label_lower:
                    if "data" not in node:
                        node["data"] = {}
                    node["data"]["sourceRef"] = f"PDF, стр. {page}"

    return tree_data

def _generate_fallback_tree(description: str) -> dict[str, Any]:
    """Generate a basic fallback tree when AI fails using CORE_SKELETON."""
    nodes = copy.deepcopy(CORE_SKELETON)
    edges = []
    
    for n in nodes:
        pid = n.get("parent_id")
        if pid:
            edges.append({
                "id": f"e-{pid}-{n['id']}",
                "source": pid,
                "target": n["id"]
            })

    return {
        "title": "Анализ стартапа",
        "readiness_index": 10,
        "tree_data": {
            "nodes": nodes,
            "edges": edges,
        },
    }
