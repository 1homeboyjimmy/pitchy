"""
AI Orchestrator for Decision Tree generation.

Multi-model stack:
- Claude (via Anthropic API) — tree structure generation
- YandexGPT — content enrichment in Russian
- GigaChat — financial calculations (fallback to YandexGPT)

All models degrade gracefully: if a specific API is unavailable,
fallback to YandexGPT (always available).
"""
from __future__ import annotations

import json
import logging
import os
import uuid
import copy
from typing import Any

import httpx

from yandex_gpt_client import call_yandex_gpt, extract_json
from core_tree import CORE_SKELETON

logger = logging.getLogger("app")

# ——— Prompts ———

TREE_EXTRACTION_PROMPT = """Ты — опытный бизнес-аналитик стартапов. Твоя задача — проанализировать описание стартапа и извлечь ключевые факты.

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

ENRICH_NODE_PROMPT = """Ты — бизнес-эксперт по российскому рынку. Дополни информацию для узла древа принятия решений стартапа.

Контекст стартапа: {context}

Узел: {node_label} (тип: {node_type})
Текущее описание: {current_description}

Дополни:
1. Развёрнутое описание (2-3 предложения)
2. Конкретные метрики, если применимо
3. Рекомендацию (1-2 предложения)

Отвечай на русском языке с учётом специфики российского бизнеса."""


# ——— Claude API (Anthropic) ———

async def _call_claude(prompt: str) -> str | None:
    """Call Claude API for tree structure generation. Returns None on failure."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        logger.info("ANTHROPIC_API_KEY not set, falling back to YandexGPT")
        return None

    try:
        base_url = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
        model_id = "claude-sonnet-4-6" if "lumigate.us" in base_url else "claude-3-7-sonnet-20250219"
        
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{base_url}/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                    "User-Agent": "Mozilla/5.0",
                },
                json={
                    "model": model_id,
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["content"][0]["text"]
    except Exception as e:
        logger.warning(f"Claude API call failed: {e}")
        return None


# ——— GigaChat API ———

async def _call_gigachat(prompt: str) -> str | None:
    """Call GigaChat for financial calculations. Returns None on failure."""
    api_key = os.getenv("GIGACHAT_API_KEY")
    if not api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=60, verify=False) as client:
            # Get access token
            auth_resp = await client.post(
                "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
                headers={
                    "Authorization": f"Basic {api_key}",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "RqUID": str(uuid.uuid4()),
                },
                data={"scope": "GIGACHAT_API_PERS"},
            )
            auth_resp.raise_for_status()
            token = auth_resp.json()["access_token"]

            # Call completion
            resp = await client.post(
                "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "model": "GigaChat-Max",
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        logger.warning(f"GigaChat API call failed: {e}")
        return None


# ——— Main orchestrator functions ———

async def generate_tree_from_text(description: str) -> dict[str, Any]:
    """
    Generate a decision tree structure from text description.
    Tries Claude first, falls back to YandexGPT.
    Extracts flat key-value pairs and injects them into the CORE_SKELETON.
    """
    prompt = TREE_EXTRACTION_PROMPT.replace("{description}", description)

    # Try Claude first
    raw = await _call_claude(prompt)

    # Fallback to YandexGPT
    if not raw:
        logger.info("Using YandexGPT for tree structure generation")
        system_prompt = "Ты — бизнес-аналитик. Извлекай данные СТРОГО в формате JSON без markdown."
        try:
            raw, _usage = call_yandex_gpt(system_prompt, prompt, timeout=60, max_tokens=2000)
        except Exception as e:
            logger.error(f"YandexGPT extraction failed: {e}")
            return _generate_fallback_tree(description)

    # Parse JSON
    try:
        extracted = extract_json(raw)
        if not extracted:
            extracted = json.loads(raw)
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

    # Validate and normalize
    return _normalize_tree_data(extracted, description)

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


    validated_nodes = []
    for node in nodes:
        if not isinstance(node, dict) or "id" not in node:
            continue
        validated = {
            "id": str(node["id"]),
            "type": node.get("type", "Task"),
            "status": node.get("status", "empty"),
            "label": node.get("label", "Без названия"),
            "category": node.get("category"),
            "level": node.get("level", 2),
            "data": node.get("data", {}),
            "parent_id": node.get("parent_id", "root"),
            "children_ids": node.get("children_ids", []),
        }
        validated_nodes.append(validated)

    # Auto-generate edges from parent_id to prevent floating nodes
    validated_edges = []
    for n in validated_nodes:
        pid = n["parent_id"]
        if pid:
            validated_edges.append({
                "id": f"e-{pid}-{n['id']}",
                "source": pid,
                "target": n["id"]
            })

    return {
        "title": str(title)[:200],
        "readiness_index": readiness,
        "tree_data": {
            "nodes": validated_nodes,
            "edges": validated_edges,
        },
    }


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
