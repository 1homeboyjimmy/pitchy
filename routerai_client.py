import os
import logging
import httpx
import json
import re
import traceback
from typing import Optional, Tuple, Dict, Any

from openai import AsyncOpenAI

try:
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

logger = logging.getLogger("app")

DEFAULT_MAIN_CHAT_MODEL = "z-ai/glm-5.2"


def get_main_chat_model() -> str:
    """Return the single model configured for Pitchy's primary chat pipeline."""
    return os.getenv("MAIN_CHAT_MODEL", DEFAULT_MAIN_CHAT_MODEL)


def is_routerai_configured() -> bool:
    return bool((os.getenv("ROUTERAI_API_KEY") or "").strip())


class RouterAIUpstreamError(RuntimeError):
    """RouterAI returned a provider/WAF error as successful chat content."""


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
    """Detect technical error envelopes that must never reach the chat."""
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    return bool(_UPSTREAM_ERROR_PREFIX.match(normalized)) or any(
        marker in normalized[:1000] for marker in _UPSTREAM_ERROR_MARKERS
    )

# Unified client for RouterAI
_router_client = None

def get_routerai_client():
    global _router_client
    if _router_client is None:
        api_key = os.getenv("ROUTERAI_API_KEY")
        base_url = os.getenv("ROUTERAI_BASE_URL", "https://routerai.ru/api/v1")
        _router_client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )
    return _router_client

@observe(name="routerai_call")
async def call_routerai(system_prompt: str, user_message: str, model: str = "moonshotai/kimi-k2.6", max_tokens: int = 4096, response_format: Optional[Dict[str, Any]] = None) -> Tuple[Optional[str], Optional[str], Dict[str, Any]]:
    """
    Calls RouterAI API via the official OpenAI-compatible client.
    """
    client = get_routerai_client()
    try:
        request: Dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.2,
            "max_tokens": max_tokens,
        }
        if response_format:
            request["response_format"] = response_format
        response = await client.chat.completions.create(**request)
        content = response.choices[0].message.content or ""
        usage = response.usage.model_dump() if hasattr(response, 'usage') else {}
        
        metrics = None
        if content and "---JSON_START---" in content:
            try:
                metrics = content.split("---JSON_START---")[1].split("---JSON_END---")[0].strip()
            except: pass
            
        return content, metrics, usage
    except Exception as e:
        logger.error(f"RouterAI call failed: {e}")
        return None, None, {}

@observe(name="routerai_stream")
async def stream_routerai(system_prompt: str, user_message: str, model: str = "moonshotai/kimi-k2.6"):
    """
    Streams from RouterAI API via the official OpenAI-compatible client.
    """
    client = get_routerai_client()
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.2,
            stream=True
        )
        
        usage_data = {}
        pending_content = ""
        content_verified = False
        async for chunk in stream:
            if hasattr(chunk, 'usage') and chunk.usage:
                usage_data = chunk.usage.model_dump()
                
            if not chunk.choices:
                continue
                
            delta = chunk.choices[0].delta
            if delta.content:
                if content_verified:
                    yield delta.content
                    continue

                # A provider-side browser/WAF can return an error envelope in
                # a successful 200 stream. Hold only the first line so that
                # technical output is rejected before it reaches persistence.
                pending_content += delta.content
                if looks_like_upstream_error(pending_content):
                    raise RouterAIUpstreamError("upstream provider rejected the request")
                if "\n" in pending_content or len(pending_content) >= 256:
                    content_verified = True
                    yield pending_content
                    pending_content = ""

        if pending_content:
            if looks_like_upstream_error(pending_content):
                raise RouterAIUpstreamError("upstream provider rejected the request")
            yield pending_content
                
        if usage_data:
            yield {"__usage__": usage_data}
            
    except Exception as e:
        logger.error(f"RouterAI streaming failed: {type(e).__name__}: {e}", exc_info=True)
        raise

@observe(name="routerai_rerank")
async def rerank_documents(query: str, documents: list[str], top_n: int = 30, model: str = "cohere/rerank-v3.5") -> list[dict]:
    """Rerank documents through RouterAI's dedicated rerank endpoint."""
    if not documents:
        return []
    api_key = os.getenv("ROUTERAI_API_KEY")
    if not api_key:
        logger.warning("ROUTERAI_API_KEY is missing; preserving source order")
        return [{"index": i, "relevance_score": 0.0} for i in range(min(top_n, len(documents)))]
    base_url = os.getenv("ROUTERAI_BASE_URL", "https://routerai.ru/api/v1").rstrip("/")
    payload = {"model": model, "query": query, "documents": documents, "top_n": min(top_n, len(documents)), "return_documents": False}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=float(os.getenv("RERANK_TIMEOUT_SECONDS", "15"))) as client:
        response = await client.post(f"{base_url}/rerank", json=payload, headers=headers)
    response.raise_for_status()
    data = response.json()
    results = data.get("results") or data.get("data") or []
    return [{"index": int(item["index"]), "relevance_score": float(item.get("relevance_score", item.get("score", 0)))} for item in results]
