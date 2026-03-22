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
from typing import Any

import httpx

from yandex_gpt_client import call_yandex_gpt, extract_json

logger = logging.getLogger("app")

# ——— Prompts ———

TREE_STRUCTURE_PROMPT = """Ты — опытный бизнес-аналитик и архитектор стартапов. Твоя задача — проанализировать описание стартапа и построить JSON-структуру древа принятия решений.

Структура дерева:
- Уровень 0: Корень (Индекс готовности)
- Уровень 1: 4 категории — Продукт (product), Рынок (market), Монетизация (monetization), Команда (team)
- Уровень 2: Конкретные задачи/факты/риски/вопросы внутри каждой категории (3-5 штук)

Каждый узел должен содержать:
- id: уникальный string-идентификатор (например, "cat-product", "t-mvp")
- type: один из "Question", "Risk", "Fact", "Task", "Artifact"
- status: один из "empty", "partial", "completed", "risk"
- label: краткое название на русском
- category: для уровня 1 — "product", "market", "monetization", "team"
- level: число (1 или 2)
- data: объект с полями description (строка), metrics (объект с числами/строками), aiRecommendation (строка)
- parent_id: id родительского узла ("root" для уровня 1)
- children_ids: массив id дочерних узлов

Верни строго JSON-объект с ключами:
- "nodes": массив узлов (без корневого root — он создаётся автоматически)
- "edges": массив ребер, каждое — {"id": "e-...", "source": "...", "target": "..."}
- "readiness_index": число от 0 до 100 — общая оценка готовности стартапа
- "title": краткое название древа на русском (до 50 символов)

Описание стартапа:
{description}

Верни ТОЛЬКО JSON, без пояснений."""

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
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
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
    """
    prompt = TREE_STRUCTURE_PROMPT.replace("{description}", description)

    # Try Claude first
    raw = await _call_claude(prompt)

    # Fallback to YandexGPT
    if not raw:
        logger.info("Using YandexGPT for tree structure generation")
        system_prompt = "Ты — архитектор бизнес-аналитики. Генерируй ответ строго в формате JSON."
        try:
            raw, _usage = call_yandex_gpt(system_prompt, prompt, timeout=60, max_tokens=3000)
        except Exception as e:
            logger.error(f"YandexGPT tree generation failed: {e}")
            return _generate_fallback_tree(description)

    # Parse JSON
    try:
        tree_data = extract_json(raw)
        if not tree_data:
            tree_data = json.loads(raw)
    except Exception:
        try:
            # Try to find JSON in the response
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                tree_data = json.loads(raw[start:end])
            else:
                return _generate_fallback_tree(description)
        except Exception:
            return _generate_fallback_tree(description)

    # Validate and normalize
    result = _normalize_tree_data(tree_data, description)

    # Safety: if AI returned parseable JSON but with no valid nodes, use fallback
    if not result.get("tree_data", {}).get("nodes"):
        logger.warning("AI returned JSON but no valid nodes found, using fallback tree")
        return _generate_fallback_tree(description)

    return result


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


def _normalize_tree_data(raw: dict, description: str) -> dict[str, Any]:
    """Normalize and validate tree data from AI response."""
    nodes = raw.get("nodes", [])
    edges = raw.get("edges", [])
    readiness = raw.get("readiness_index", 0)
    title = raw.get("title", "Анализ стартапа")

    # Ensure readiness is in valid range
    try:
        readiness = max(0, min(100, int(readiness)))
    except (TypeError, ValueError):
        readiness = 0

    # Validate nodes have required fields
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

    # Validate edges
    valid_ids = {n["id"] for n in validated_nodes} | {"root"}
    validated_edges = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        if edge.get("source") in valid_ids and edge.get("target") in valid_ids:
            validated_edges.append({
                "id": edge.get("id", f"e-{edge['source']}-{edge['target']}"),
                "source": edge["source"],
                "target": edge["target"],
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
    """Generate a basic fallback tree when AI fails."""
    short_desc = description[:100] + "..." if len(description) > 100 else description

    nodes = [
        {"id": "cat-product", "type": "Task", "status": "empty", "label": "Продукт", "category": "product", "level": 1, "data": {"description": "Проанализируйте продуктовое предложение", "aiRecommendation": "Определите ключевые фичи MVP"}, "parent_id": "root", "children_ids": ["t-mvp", "t-value"]},
        {"id": "cat-market", "type": "Task", "status": "empty", "label": "Рынок", "category": "market", "level": 1, "data": {"description": "Оцените целевой рынок"}, "parent_id": "root", "children_ids": ["t-tam", "t-ca"]},
        {"id": "cat-monetization", "type": "Task", "status": "empty", "label": "Монетизация", "category": "monetization", "level": 1, "data": {"description": "Определите модель монетизации"}, "parent_id": "root", "children_ids": ["t-pricing", "t-unit"]},
        {"id": "cat-team", "type": "Task", "status": "empty", "label": "Команда", "category": "team", "level": 1, "data": {"description": "Оцените команду проекта"}, "parent_id": "root", "children_ids": ["t-roles"]},
        # Level 2
        {"id": "t-mvp", "type": "Task", "status": "empty", "label": "MVP-функции", "level": 2, "data": {"description": "Список ключевых функций MVP"}, "parent_id": "cat-product", "children_ids": []},
        {"id": "t-value", "type": "Question", "status": "empty", "label": "Value Proposition", "level": 2, "data": {"description": "Уникальное ценностное предложение"}, "parent_id": "cat-product", "children_ids": []},
        {"id": "t-tam", "type": "Fact", "status": "empty", "label": "TAM/SAM/SOM", "level": 2, "data": {"description": "Расчёт объёмов рынка"}, "parent_id": "cat-market", "children_ids": []},
        {"id": "t-ca", "type": "Risk", "status": "empty", "label": "Конкурентный анализ", "level": 2, "data": {"description": "Оценка конкурентной среды"}, "parent_id": "cat-market", "children_ids": []},
        {"id": "t-pricing", "type": "Task", "status": "empty", "label": "Ценообразование", "level": 2, "data": {"description": "Тарифная сетка"}, "parent_id": "cat-monetization", "children_ids": []},
        {"id": "t-unit", "type": "Task", "status": "empty", "label": "Юнит-экономика", "level": 2, "data": {"description": "LTV, CAC, маржинальность"}, "parent_id": "cat-monetization", "children_ids": []},
        {"id": "t-roles", "type": "Fact", "status": "empty", "label": "Ключевые роли", "level": 2, "data": {"description": "Состав и компетенции"}, "parent_id": "cat-team", "children_ids": []},
    ]

    edges = [
        {"id": "e-root-product", "source": "root", "target": "cat-product"},
        {"id": "e-root-market", "source": "root", "target": "cat-market"},
        {"id": "e-root-monetization", "source": "root", "target": "cat-monetization"},
        {"id": "e-root-team", "source": "root", "target": "cat-team"},
        {"id": "e-product-mvp", "source": "cat-product", "target": "t-mvp"},
        {"id": "e-product-value", "source": "cat-product", "target": "t-value"},
        {"id": "e-market-tam", "source": "cat-market", "target": "t-tam"},
        {"id": "e-market-ca", "source": "cat-market", "target": "t-ca"},
        {"id": "e-mon-pricing", "source": "cat-monetization", "target": "t-pricing"},
        {"id": "e-mon-unit", "source": "cat-monetization", "target": "t-unit"},
        {"id": "e-team-roles", "source": "cat-team", "target": "t-roles"},
    ]

    return {
        "title": f"Анализ: {short_desc}",
        "readiness_index": 10,
        "tree_data": {"nodes": nodes, "edges": edges},
    }
