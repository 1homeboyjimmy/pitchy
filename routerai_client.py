import os
import logging
import httpx
import json
import traceback
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger("app")

async def call_routerai(system_prompt: str, user_message: str, model: str = "z-ai/glm-5") -> Tuple[Optional[str], Optional[str]]:
    """
    Calls RouterAI API (OpenAI compatible).
    Returns (reply, metrics_json_string) or (None, None) on failure.
    """
    api_key = os.getenv("ROUTERAI_API_KEY")
    if not api_key:
        logger.warning("ROUTERAI_API_KEY not set")
        return None, None

    url = "https://routerai.ru/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.3,
        "max_tokens": 4096
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
            
            if resp.status_code != 200:
                logger.error(f"RouterAI error: {resp.status_code} - {resp.text}")
                return None, None
                
            data = resp.json()
            
            # Extract content
            message = data["choices"][0]["message"]
            content = message.get("content", "")
            
            # RouterAI usually returns content directly, but we keep the check for robustness
            if not content or not content.strip():
                logger.warning(f"RouterAI returned empty content for model {model}. Full response: {json.dumps(data, ensure_ascii=False)}")
                return None, None
            else:
                logger.info(f"RouterAI response received ({len(content)} chars)")

            # Simple heuristic to extract JSON if present (keeping compatibility with existing code)
            metrics = None
            if content and "---JSON_START---" in content:
                try:
                    metrics = content.split("---JSON_START---")[1].split("---JSON_END---")[0].strip()
                except:
                    pass
            
            return content, metrics

    except Exception as e:
        logger.error(f"RouterAI call failed: {str(e)}")
        logger.error(traceback.format_exc())
        return None, None
