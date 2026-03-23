import os
import logging
import httpx
import json
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger("app")

async def call_zai(system_prompt: str, user_message: str, model: str = "z-ai/glm-4.7") -> Tuple[Optional[str], Optional[str]]:
    """
    Calls ZvenoAI API (OpenAI compatible).
    Returns (reply, metrics_json_string) or (None, None) on failure.
    """
    api_key = os.getenv("ZVENOAI_API_KEY")
    if not api_key:
        logger.warning("ZVENOAI_API_KEY not set")
        return None, None

    url = "https://api.zveno.ai/v1/chat/completions"
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
        "max_tokens": 2048
    }

    # logger.debug(f"ZvenoAI Prompt: {payload}")
    
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            
            if not content or not content.strip():
                logger.warning(f"ZvenoAI returned empty content for model {model}")
                logger.debug(f"ZvenoAI Full Response: {data}")
            else:
                logger.info(f"ZvenoAI response received ({len(content)} chars)")

            # Simple heuristic to extract JSON if present
            metrics = None
            if content and "---JSON_START---" in content:
                try:
                    metrics = content.split("---JSON_START---")[1].split("---JSON_END---")[0].strip()
                except:
                    pass
            
            return content, metrics
    except Exception as e:
        logger.error(f"ZvenoAI API call failed ({model}): {e}")
        return None, None

def extract_json_zai(text: str) -> Dict[str, Any]:
    """Helper to extract JSON from AI response."""
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return json.loads(text[start:end+1])
    except:
        pass
    return {}

async def generate_chat_title_zai(text: str) -> str:
    """Generate a short 2-4 word title for a chat session."""
    system_prompt = (
        "Ты — умный ассистент. Прочитай первое сообщение пользователя и придумай "
        "краткое название для этого диалога из 2-4 слов. Только текст, без кавычек."
    )
    # Using a fast model for titles
    # Primary GLM-4.7 model from Z.ai (Zveno preferred)
    title_model = "z-ai/glm-4.7-flash"
    
    reply, _ = await call_zai(system_prompt, text[:500], model=title_model)
    if reply:
        return reply.strip(' "\'\n\r\t.-').capitalize()
    return "Новый диалог"

async def analyze_search_intent_zai(text: str) -> Dict[str, Any]:
    """Analyzes if web search is needed."""
    system_prompt = (
        "Ты — умный классификатор запросов. Реши, нужен ли поиск в интернете. "
        "Верни СТРОГО JSON: {'needs_search': bool, 'search_query': str}"
    )
    reply, _ = await call_zai(system_prompt, text[:1000], model="z-ai/glm-4.7-flash")
    if reply:
        parsed = extract_json_zai(reply)
        return {
            "needs_search": bool(parsed.get("needs_search", False)),
            "search_query": str(parsed.get("search_query", "")) if parsed.get("needs_search") else ""
        }
    return {"needs_search": False, "search_query": ""}
