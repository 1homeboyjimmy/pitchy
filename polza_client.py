"""OpenAI-compatible chat and streaming client for Polza.ai."""
from __future__ import annotations

import logging
import os
import re
from typing import Any

from openai import AsyncOpenAI

try:
    from langfuse.decorators import observe
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f

logger = logging.getLogger("app")
POLZA_BASE_URL = os.getenv("POLZA_API_BASE", "https://polza.ai/api/v1").rstrip("/")
DEFAULT_MAIN_CHAT_MODEL = "openai/gpt-6-luna-pro"


def get_main_chat_model() -> str:
    return os.getenv("MAIN_CHAT_MODEL", DEFAULT_MAIN_CHAT_MODEL)


def is_polza_configured() -> bool:
    return bool((os.getenv("POLZA_API_KEY") or "").strip())


class PolzaUpstreamError(RuntimeError):
    """A provider or edge error was returned as successful chat content."""


_UPSTREAM_ERROR_PREFIX = re.compile(
    r"^\s*(?:\[?\s*error(?:\s+\d{3})?\s*\]?\s*:|(?:http|status)\s+\d{3}\b)",
    re.IGNORECASE,
)
_UPSTREAM_ERROR_MARKERS = (
    "blocked by bot detection",
    "access denied",
    "cloudflare ray id",
    "cf-error-code",
    "just a moment...",
)


def looks_like_upstream_error(text: str) -> bool:
    normalized = (text or "").strip().lower()
    return bool(normalized) and (
        bool(_UPSTREAM_ERROR_PREFIX.match(normalized))
        or any(marker in normalized[:1000] for marker in _UPSTREAM_ERROR_MARKERS)
    )


_client: AsyncOpenAI | None = None


def get_polza_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("POLZA_API_KEY"), base_url=POLZA_BASE_URL)
    return _client


@observe(name="polza_call")
async def call_polza(
    system_prompt: str,
    user_message: str,
    model: str | None = None,
    max_tokens: int = 4096,
    response_format: dict[str, Any] | None = None,
) -> tuple[str | None, str | None, dict[str, Any]]:
    request: dict[str, Any] = {
        "model": model or os.getenv("POLZA_MODEL", DEFAULT_MAIN_CHAT_MODEL),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }
    if response_format:
        request["response_format"] = response_format
    try:
        response = await get_polza_client().chat.completions.create(**request)
        content = response.choices[0].message.content or ""
        usage = response.usage.model_dump() if response.usage else {}
        metrics = None
        if content and "---JSON_START---" in content:
            try:
                metrics = content.split("---JSON_START---", 1)[1].split("---JSON_END---", 1)[0].strip()
            except (IndexError, AttributeError):
                pass
        return content, metrics, usage
    except Exception as exc:
        logger.error("Polza call failed: %s", exc)
        return None, None, {}


@observe(name="polza_stream")
async def stream_polza(
    system_prompt: str | None = None,
    user_message: str | None = None,
    messages: list[dict[str, Any]] | None = None,
    model: str | None = None,
):
    try:
        prompt_messages = messages or [
            {"role": "system", "content": "ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ.\n\n" + (system_prompt or "")},
            {"role": "user", "content": user_message or ""},
        ]
        stream = await get_polza_client().chat.completions.create(
            model=model or os.getenv("POLZA_MODEL", DEFAULT_MAIN_CHAT_MODEL),
            messages=prompt_messages,
            temperature=0.2,
            stream=True,
            stream_options={"include_usage": True},
        )
        usage_data: dict[str, Any] = {}
        pending_content = ""
        content_verified = False
        async for chunk in stream:
            if getattr(chunk, "usage", None):
                usage_data = chunk.usage.model_dump()
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            content = delta.content
            if not content:
                continue
            if content_verified:
                yield content
                continue
            pending_content += content
            if looks_like_upstream_error(pending_content):
                raise PolzaUpstreamError("upstream provider rejected the request")
            if "\n" in pending_content or len(pending_content) >= 256:
                content_verified = True
                yield pending_content
                pending_content = ""
        if pending_content:
            if looks_like_upstream_error(pending_content):
                raise PolzaUpstreamError("upstream provider rejected the request")
            yield pending_content
        if usage_data:
            yield {"__usage__": usage_data}
    except Exception as exc:
        logger.error("Polza streaming failed: %s: %s", type(exc).__name__, exc, exc_info=True)
        raise
