import os
import asyncio
import logging
from tavily import TavilyClient

logger = logging.getLogger(__name__)

def _get_tavily_client() -> TavilyClient | None:
    api_key = os.getenv("TAVILY_API_KEY", "")
    if not api_key:
        logger.warning("TAVILY_API_KEY is missing. Web search is disabled.")
        return None
    return TavilyClient(api_key=api_key)

def execute_search_agent(query: str) -> str:
    """
    Синхронный оркестратор агента поиска по интернету (для обратной совместимости).
    Ищет информацию в Tavily и возвращает markdown-строку с контекстом.
    """
    logger.info(f"Executing web search agent using Tavily for query: {query}")
    tavily = _get_tavily_client()
    if not tavily:
        return "Интернет-поиск отключен (отсутствует TAVILY_API_KEY)."

    try:
        response = tavily.search(query, search_depth="basic", max_results=3)
        results = response.get("results", [])
        if not results:
            return "Интернет-поиск не дал результатов по этому запросу."
        
        compiled_text = ""
        for idx, r in enumerate(results, 1):
            url = r.get("url", "unknown_url")
            content = r.get("content", "")
            compiled_text += f"### Источник {idx}: {url}\nСодержимое страницы:\n{content}\n\n"
            
        return compiled_text.strip()
    except Exception as e:
        logger.error(f"Tavily search error: {e}")
        return f"Произошла ошибка при поиске в интернете: {str(e)}"

async def async_search_with_sources(query: str) -> tuple[list[dict], str]:
    """
    Асинхронная функция поиска для нового потокового агента.
    Возвращает (sources_list, context_string).
    """
    logger.info(f"Executing async API search using Tavily for query: {query}")
    tavily = _get_tavily_client()
    if not tavily:
        return [], "Интернет-поиск отключен (отсутствует TAVILY_API_KEY)."
    
    try:
        # Вызов в отдельном потоке, так как tavily.search блокирующий
        response = await asyncio.to_thread(tavily.search, query, search_depth="basic", max_results=3)
        results = response.get("results", [])
        
        sources = [{"title": r.get("title", "Источник"), "url": r.get("url", "")} for r in results]
        
        compiled_text = ""
        for idx, r in enumerate(results, 1):
            url = r.get("url", "unknown_url")
            content = r.get("content", "")
            compiled_text += f"### Источник {idx}: {url}\nСодержимое страницы:\n{content}\n\n"
            
        return sources, compiled_text.strip()
    
    except Exception as e:
        logger.error(f"Async Tavily search error: {e}")
        return [], f"Произошла ошибка при поиске в интернете: {str(e)}"
