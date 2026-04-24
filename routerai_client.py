import os
import logging
import httpx
import json
import traceback
from typing import Optional, Tuple, Dict, Any

try:
    from langfuse.openai import AsyncOpenAI
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    from openai import AsyncOpenAI
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

logger = logging.getLogger("app")

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
async def call_routerai(system_prompt: str, user_message: str, model: str = "moonshotai/kimi-k2.6") -> Tuple[Optional[str], Optional[str], Dict[str, Any]]:
    """
    Calls RouterAI API via Langfuse-instrumented OpenAI client.
    """
    client = get_routerai_client()
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.2,
            max_tokens=4096
        )
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
    Streams from RouterAI API via Langfuse-instrumented OpenAI client.
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
        async for chunk in stream:
            if hasattr(chunk, 'usage') and chunk.usage:
                usage_data = chunk.usage.model_dump()
                
            if not chunk.choices:
                continue
                
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content
                
        if usage_data:
            yield {"__usage__": usage_data}
            
    except Exception as e:
        logger.error(f"RouterAI streaming failed: {e}")
        yield f"\n[Ошибка соединения: {str(e)}]"
