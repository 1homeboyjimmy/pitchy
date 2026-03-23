import os
import logging
import httpx
import json
import traceback
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger("app")

async def call_makura(system_prompt: str, user_message: str, model: str = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Calls Makura.ai API (OpenAI compatible).
    Returns (reply, metrics_json_string) or (None, None) on failure.
    """
    api_key = os.getenv("MAKURA_API_KEY")
    if not api_key:
        logger.warning("MAKURA_API_KEY not set")
        return None, None

    # Use model from env if not provided
    if not model:
        model = os.getenv("MAKURA_MODEL", "glm-5")

    # Base URL from user: https://api.makura.ai/v1
    url = "https://api.makura.ai/v1/chat/completions"
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
        "temperature": 0.4,
        "max_tokens": 4096
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
            
            if resp.status_code != 200:
                logger.error(f"Makura error: {resp.status_code} - {resp.text}")
                return None, None
                
            data = resp.json()
            
            # Extract content
            message = data["choices"][0]["message"]
            content = message.get("content", "")
            
            if not content or not content.strip():
                logger.warning(f"Makura returned empty content for model {model}.")
                return None, None
            else:
                logger.info(f"Makura response received ({len(content)} chars)")

            # Simple heuristic to extract JSON if present
            metrics = None
            if content and "---JSON_START---" in content:
                try:
                    metrics = content.split("---JSON_START---")[1].split("---JSON_END---")[0].strip()
                except:
                    pass
            
            return content, metrics

    except Exception as e:
        logger.error(f"Makura call failed: {str(e)}")
        logger.error(traceback.format_exc())
        return None, None
