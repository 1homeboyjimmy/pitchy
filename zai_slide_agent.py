"""Native Z.AI slide agent client.

Z.AI's `slides_glm_agent` is purpose-built for deck generation — it returns
fully-styled HTML for each slide instead of a generic JSON skeleton our
hand-rolled GLM-5 prompt produces. Quality jump is significant; the
trade-off is a paid API call and a hard dependency on Z.AI's RU
accessibility.

Endpoint: POST https://api.z.ai/api/v1/agents
Agent ID: slides_glm_agent
Auth:     Bearer ZAI_API_KEY

We expose the same generator shape that `_handle_presentation_in_chat`
already speaks ({type: thought | slide | presentation | chunk}), so the
caller can swap providers behind a single env flag.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import AsyncIterator

import httpx

logger = logging.getLogger("app.zai_slide_agent")

ZAI_API_URL = os.getenv("ZAI_API_URL", "https://api.z.ai/api/v1/agents").rstrip("/")
ZAI_AGENT_ID = os.getenv("ZAI_SLIDES_AGENT_ID", "slides_glm_agent")
# Optional egress proxy (e.g. the German server) for when api.z.ai is
# unreachable from the prod VPS. Format: "http://user:pass@host:port" or
# "socks5://host:port".
ZAI_HTTP_PROXY = os.getenv("ZAI_HTTP_PROXY", "").strip() or None


def is_configured() -> bool:
    """Cheap check used by the orchestrator to decide between native Z.AI
    and the Makura-based fallback. Returns False when the key is unset, so
    the chat flow silently degrades to the existing path."""
    return bool(os.getenv("ZAI_API_KEY"))


async def stream_slides(user_message: str,
                        history_text: str = "",
                        rag_context: str = "",
                        project_context: str = "",
                        conversation_id: str | None = None
                        ) -> AsyncIterator[dict]:
    """Stream slide events from Z.AI's slides_glm_agent.

    Yields the same envelope used by _handle_presentation_in_chat:
      {type: "thought",       content: str}
      {type: "slide",         data: dict, position: int}    # html ready
      {type: "presentation",  data: list[dict]}             # final
      {type: "chunk",         content: str}                 # error text

    On any failure raises; the orchestrator wraps the call so it can fall
    back to the Makura path.
    """
    api_key = os.getenv("ZAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ZAI_API_KEY not set")

    # Compose the instruction. The slide agent does its own outlining /
    # design, so we hand it structured project context rather than a
    # rigid format spec.
    parts = [
        "Создай профессиональную инвестиционную презентацию (Pitch Deck) на русском языке. "
        "6-10 слайдов. Структура — по канонам Sequoia / Y Combinator. "
        "Стиль — тёмная тема, чистая типографика, осмысленная иерархия. "
        "Тексты — короткие фразы, без вводных и причастных оборотов.",
        f"\nЗАПРОС ПОЛЬЗОВАТЕЛЯ: {user_message}",
    ]
    if project_context:
        parts.append(f"\nСТРУКТУРИРОВАННЫЙ КОНТЕКСТ ПРОЕКТА:\n{project_context}")
    if history_text and history_text.strip():
        parts.append(f"\nИСТОРИЯ ДИАЛОГА:\n{history_text}")
    if rag_context and rag_context.strip():
        parts.append(f"\nКОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ:\n{rag_context}")
    instruction = "\n".join(parts)

    payload = {
        "agent_id": ZAI_AGENT_ID,
        "stream": True,
        "request_id": str(uuid.uuid4()),
        "messages": [{
            "role": "user",
            "content": [{"type": "text", "text": instruction}],
        }],
    }
    if conversation_id:
        payload["conversation_id"] = conversation_id

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "X-Accel-Buffering": "no",
    }

    client_kwargs = {"timeout": httpx.Timeout(180.0, connect=15.0, read=120.0)}
    if ZAI_HTTP_PROXY:
        client_kwargs["proxy"] = ZAI_HTTP_PROXY

    slides: list[dict] = []
    seen_positions: set[int] = set()

    async with httpx.AsyncClient(**client_kwargs) as client:
        async with client.stream("POST", ZAI_API_URL, headers=headers, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise RuntimeError(f"Z.AI HTTP {response.status_code}: {body.decode(errors='replace')[:400]}")

            async for line in response.aiter_lines():
                if not line.strip() or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    event = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                for choice in event.get("choices", []):
                    msg = choice.get("message") or {}
                    if isinstance(msg, list):
                        # Some Z.AI responses wrap message in a list; normalize.
                        msg_items = msg
                    else:
                        msg_items = [msg]

                    for m in msg_items:
                        phase = (m or {}).get("phase")
                        for part in (m or {}).get("content", []) or []:
                            ptype = part.get("type")
                            if ptype == "text" and phase == "thinking":
                                text = part.get("text") or ""
                                if text:
                                    yield {"type": "thought", "content": text}
                            elif ptype == "object":
                                obj = part.get("object") or {}
                                output_html = obj.get("output") or ""
                                positions = obj.get("position") or []
                                if not output_html:
                                    continue
                                # One object can describe one or several slides.
                                # When `position` is empty, default to appending.
                                target_positions = positions if positions else [len(slides) + 1]
                                for pos in target_positions:
                                    if pos in seen_positions:
                                        continue
                                    seen_positions.add(pos)
                                    slide = {
                                        "type": "Html",
                                        "html": output_html,
                                    }
                                    # Keep the array index-aligned to position.
                                    while len(slides) < pos:
                                        slides.append(None)
                                    slides[pos - 1] = slide
                                    yield {"type": "slide", "data": slide, "position": pos}
                            elif ptype == "text" and phase == "answer":
                                # Trailing assistant commentary; surface as a
                                # tiny chunk so the chat still gets some prose
                                # alongside the deck.
                                text = part.get("text") or ""
                                if text.strip():
                                    yield {"type": "chunk", "content": text}

    # Final consolidated payload (skip Nones if positions were sparse).
    final = [s for s in slides if s]
    if final:
        yield {"type": "presentation", "data": final}
