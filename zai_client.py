import os
import logging
import httpx
import json
from typing import Optional, Tuple, Dict, Any
from routerai_client import call_routerai

logger = logging.getLogger("app")

async def generate_chat_title(text: str) -> str:
    """Generate a short 2-4 word title for a chat session via RouterAI (GLM-5)."""
    system_prompt = (
        "Ты — умный ассистент. Прочитай первое сообщение пользователя и придумай "
        "краткое название для этого диалога из 2-4 слов. Только текст, без кавычек."
    )
    reply, _ = await call_routerai(system_prompt, text[:500])
    if reply:
        return reply.strip(' "\'\n\r\t.-').capitalize()
    return "Новый диалог"

async def analyze_search_intent(text: str) -> Dict[str, Any]:
    """Analyzes if web search is needed via RouterAI (GLM-5)."""
    system_prompt = (
        "Ты — умный классификатор запросов. Реши, нужен ли поиск в интернете. "
        "Верни СТРОГО JSON: {'needs_search': bool, 'search_query': str}"
    )
    reply, _ = await call_routerai(system_prompt, text[:1000])
    if reply:
        # Mini-helper for JSON since we don't have extract_json here
        try:
            start = reply.find("{")
            end = reply.rfind("}")
            if start != -1 and end != -1:
                parsed = json.loads(reply[start:end+1])
                return {
                    "needs_search": bool(parsed.get("needs_search", False)),
                    "search_query": str(parsed.get("search_query", "")) if parsed.get("needs_search") else ""
                }
        except:
            pass
    return {"needs_search": False, "search_query": ""}
