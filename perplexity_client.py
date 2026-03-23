import os
import logging
import httpx
from typing import Optional

logger = logging.getLogger("app")

async def call_perplexity(query: str, system_prompt: str = "You are a helpful assistant with real-time web access.") -> Optional[str]:
    """
    Calls Perplexity AI API (OpenAI-compatible) for deep web search.
    Returns the answer as a string or None on failure.
    """
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        logger.warning("PERPLEXITY_API_KEY not set")
        return None

    url = "https://api.perplexity.ai/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": "sonar", # Fast and reliable for search
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ],
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": 2048
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error(f"Perplexity API call failed: {e}")
        return None
