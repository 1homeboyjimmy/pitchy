import os
import logging
import httpx
import json
import traceback
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger("app")

# Models tried in order. The first is the default primary; the rest are
# fallbacks used when an earlier model fails before producing any output.
# glm-5 had a transient Makura-side outage — the fallback chain covers it
# if that recurs (a hung model fails over after the 60s read timeout).
MAKURA_FALLBACK_MODELS = ["glm-5", "glm-4.7", "glm-4.6", "auto"]

# If every Makura model fails (e.g. provider-wide outage), the main chat
# falls through to RouterAI's glm-5 as a last-ditch backstop. Separate API
# key and balance, so a Makura billing/quota issue can't take the chat down.
ROUTERAI_FALLBACK_MODEL = os.getenv("ROUTERAI_FALLBACK_MODEL", "glm-5")

async def call_makura(system_prompt: str, user_message: str, model: str = None) -> Tuple[Optional[str], Optional[str], Dict[str, Any]]:
    """
    Calls Makura.ai API (OpenAI compatible).
    Returns (reply, metrics_json_string, usage_dict) or (None, None, {}) on failure.
    """
    api_key = os.getenv("MAKURA_API_KEY")
    if not api_key:
        logger.warning("MAKURA_API_KEY not set")
        return None, None, {}

    # Use model from env if not provided
    if not model:
        model = os.getenv("MAKURA_MODEL", MAKURA_FALLBACK_MODELS[0])

    # Base URL from user: https://api.makura.ai/v1
    url = "https://api.makura.ai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prompt-Cache": "true"
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.4,
        "max_tokens": 4000,
        "tool_stream": True,
        "thinking": {"type": "enabled"}
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, json=payload)
            
            if resp.status_code != 200:
                logger.error(f"Makura error: {resp.status_code} - Body: {resp.text}")
                return None, None, {}
                
            try:
                data = resp.json()
            except Exception as json_err:
                logger.error(f"Failed to parse Makura JSON: {str(json_err)}. Raw body: {resp.text[:500]}")
                return None, None, {}
            
            # Extract content
            message = data["choices"][0]["message"]
            content = message.get("content", "")
            
            # Extract token usage from API response
            usage = data.get("usage", {})
            
            if not content or not content.strip():
                logger.warning(f"Makura returned empty content for model {model}.")
                return None, None, usage
            else:
                logger.info(f"Makura response received ({len(content)} chars, tokens: {usage})")

            # Simple heuristic to extract JSON if present
            metrics = None
            if content and "---JSON_START---" in content:
                try:
                    metrics = content.split("---JSON_START---")[1].split("---JSON_END---")[0].strip()
                except:
                    pass
            
            return content, metrics, usage

    except Exception as e:
        logger.error(f"Makura call failed: {str(e)}")
        logger.error(traceback.format_exc())
        return None, None, {}


async def _stream_makura_attempt(model: str, payload_messages: list, headers: dict, url: str):
    """
    Single streaming attempt against one model. Yields chunks; raises on any
    failure so the caller can decide whether to fall back to another model.
    """
    payload = {
        "model": model,
        "messages": payload_messages,
        "temperature": 0.4,
        "max_tokens": 4000,
        "stream": True,
        "tool_stream": True,
        "thinking": {"type": "enabled"}
    }

    # read=60s: a healthy stream sends tokens continuously, so a 60s gap means
    # the model is hung (e.g. glm-5) — fail fast and fall back instead of
    # blocking the whole request for the full 120s.
    timeout = httpx.Timeout(120.0, connect=15.0, read=60.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                err_body = await response.aread()
                raise RuntimeError(f"Makura HTTP {response.status_code}: {err_body.decode()[:300]}")

            usage_data = {}
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        # Capture usage from the final chunk (OpenAI-compatible APIs send it there)
                        if "usage" in chunk and chunk["usage"]:
                            usage_data = chunk["usage"]
                        choices = chunk.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})

                        # Handle native Z-AI/GLM reasoning_content
                        if "reasoning_content" in delta and delta["reasoning_content"]:
                            yield {"__thinking__": delta["reasoning_content"]}

                        if "content" in delta:
                            yield delta["content"]
                    except json.JSONDecodeError as e:
                        logger.error(f"Error parsing Makura stream chunk: {e}")
                        continue
            # Yield usage as a special sentinel dict at the very end
            if usage_data:
                yield {"__usage__": usage_data}


async def _stream_routerai_attempt(model: str, payload_messages: list):
    """Single streaming attempt against RouterAI (OpenAI-compatible).
    Same shape as _stream_makura_attempt — yields content chunks and a
    final {"__usage__": ...} sentinel. Raises on any failure so the
    caller can decide to give up or try another fallback.
    """
    api_key = os.getenv("ROUTERAI_API_KEY")
    if not api_key:
        raise RuntimeError("ROUTERAI_API_KEY not set")
    base = os.getenv("ROUTERAI_API_BASE", "https://routerai.ru/api/v1").rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Accel-Buffering": "no",
    }
    payload = {
        "model": model,
        "messages": payload_messages,
        "temperature": 0.4,
        "max_tokens": 4000,
        "stream": True,
    }

    timeout = httpx.Timeout(120.0, connect=15.0, read=60.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                err_body = await response.aread()
                raise RuntimeError(f"RouterAI HTTP {response.status_code}: {err_body.decode()[:300]}")

            usage_data = {}
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        if "usage" in chunk and chunk["usage"]:
                            usage_data = chunk["usage"]
                        choices = chunk.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        if "reasoning_content" in delta and delta["reasoning_content"]:
                            yield {"__thinking__": delta["reasoning_content"]}
                        if "content" in delta and delta["content"]:
                            yield delta["content"]
                    except json.JSONDecodeError as e:
                        logger.error(f"Error parsing RouterAI stream chunk: {e}")
                        continue
            if usage_data:
                yield {"__usage__": usage_data}


async def stream_makura(system_prompt: str = None, user_message: str = None, messages: list = None, model: str = None):
    """
    Streams response from Makura.ai API with model fallback, then falls
    through to RouterAI/glm-5 if every Makura model fails before output.

    Yields chunks of text. If a model fails before producing any output, the
    next model in MAKURA_FALLBACK_MODELS is tried; if all Makura models fail,
    one final attempt is made against RouterAI as a cross-provider safety net.
    Once content has reached the client a mid-stream failure is surfaced as
    an error (switching providers mid-stream would corrupt the response).
    """
    api_key = os.getenv("MAKURA_API_KEY")
    if not api_key:
        yield "Error: MAKURA_API_KEY not set"
        return

    url = "https://api.makura.ai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prompt-Cache": "true",
        "X-Accel-Buffering": "no"
    }

    if messages:
        payload_messages = messages
    else:
        payload_messages = [
            {"role": "system", "content": "ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. ИСПОЛЬЗОВАНИЕ КИТАЙСКИХ ИЕРОГЛИФОВ КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО.\n\n" + (system_prompt or "") + "\n\nВНИМАНИЕ: ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ. НИКАКИХ КИТАЙСКИХ СИМВОЛОВ."},
            {"role": "user", "content": user_message or ""}
        ]

    # Build the model chain: explicit/env model first, then the fallbacks.
    primary = model or os.getenv("MAKURA_MODEL", MAKURA_FALLBACK_MODELS[0])
    candidates = [primary] + [m for m in MAKURA_FALLBACK_MODELS if m != primary]

    last_error = None
    for candidate in candidates:
        produced = False
        try:
            logger.info(f"Makura stream attempt: model={candidate}")
            async for chunk in _stream_makura_attempt(candidate, payload_messages, headers, url):
                produced = True
                yield chunk
            return  # stream finished cleanly
        except Exception as e:
            last_error = e
            if produced:
                # Content already reached the client — switching models now
                # would corrupt the response, so surface the error instead.
                logger.error(f"Makura stream broke mid-response on {candidate}: {type(e).__name__}: {e}", exc_info=True)
                yield f"\n[Ошибка соединения: {type(e).__name__}: {e}]"
                return
            logger.warning(f"Makura model {candidate} failed before any output ({type(e).__name__}: {e}); trying fallback")

    # Every Makura model failed before producing output. Fall through to
    # RouterAI (separate provider, separate balance, OpenAI-compatible API)
    # with glm-5 as a final cross-provider safety net.
    if os.getenv("ROUTERAI_API_KEY"):
        try:
            logger.warning(f"All Makura models failed; falling over to RouterAI/{ROUTERAI_FALLBACK_MODEL}")
            produced = False
            async for chunk in _stream_routerai_attempt(ROUTERAI_FALLBACK_MODEL, payload_messages):
                produced = True
                yield chunk
            if produced:
                return  # RouterAI saved us
        except Exception as e:
            last_error = e
            logger.error(f"RouterAI fallback ({ROUTERAI_FALLBACK_MODEL}) also failed: {type(e).__name__}: {e}")

    logger.error(f"All providers exhausted. Last: {type(last_error).__name__}: {last_error}", exc_info=last_error)
    yield f"\n[Ошибка соединения: {type(last_error).__name__}: {last_error}]"
