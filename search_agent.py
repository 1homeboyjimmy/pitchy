import os
import asyncio
import logging
from tavily import AsyncTavilyClient

logger = logging.getLogger(__name__)

async def _get_tavily_client() -> AsyncTavilyClient | None:
    api_key = os.getenv("TAVILY_API_KEY", "")
    if not api_key:
        logger.warning("TAVILY_API_KEY is missing. Web search is disabled.")
        return None
    return AsyncTavilyClient(api_key=api_key)

async def execute_search_agent(query: str) -> str:
    """
    Асинхронный оркестратор агента поиска по интернету.
    Ищет информацию в Tavily и возвращает markdown-строку с контекстом.
    """
    logger.info(f"Executing web search agent using Tavily for query: {query}")
    tavily = await _get_tavily_client()
    if not tavily:
        return "Интернет-поиск отключен (отсутствует TAVILY_API_KEY)."

    try:
        # Using localized country parameter for Russia
        response = await tavily.search(query, search_depth="basic", max_results=3, country="russia")
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
    finally:
        if tavily: await tavily.close()

async def async_search_with_sources(query: str, use_deep_search: bool = False) -> tuple[list[dict], str]:
    """
    Асинхронная функция поиска для нового потокового агента.
    Возвращает (sources_list, context_string).
    """
    logger.info(f"Executing async API search using Tavily for query: {query}, deep_search: {use_deep_search}")
    tavily = await _get_tavily_client()
    if not tavily:
        return [], "Интернет-поиск отключен (отсутствует TAVILY_API_KEY)."
    
    try:
        safe_query = query[:390] if len(query) > 390 else query
        depth = "advanced" if use_deep_search else "basic"
        results_count = 10 if use_deep_search else 3
        
        response = await tavily.search(safe_query, search_depth=depth, max_results=results_count, country="russia")
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
    finally:
        if tavily: await tavily.close()

async def execute_deep_research(query: str) -> tuple[str, list[dict]]:
    """
    Запускает многоэтапное исследование (Deep Research) через агентный движок Tavily.
    """
    logger.info(f"Executing Deep Research using Tavily for query: {query}")
    tavily = await _get_tavily_client()
    if not tavily:
        return "Интернет-поиск отключен.", []

    try:
        # Use pro model for real research agent, restricted to Russia
        # Tavily's .research() is a specialized agentic workflow
        response = await tavily.research(query, model="pro", country="russia")
        
        content = response.get("content", "Не удалось сформировать отчет.")
        sources = response.get("sources", [])
        
        # Format sources nicely for display if they are not just dicts
        formatted_sources = []
        for s in sources:
            if isinstance(s, dict):
                formatted_sources.append(s)
            elif isinstance(s, str):
                formatted_sources.append({"title": "Источник", "url": s})

        return content, formatted_sources
    except Exception as e:
        logger.error(f"Tavily Deep Research error: {e}")
        return f"Произошла ошибка при глубоком исследовании: {str(e)}", []
    finally:
        if tavily: await tavily.close()

async def stream_deep_research(query: str):
    """
    Асинхронный генератор для многоэтапного исследования (Deep Research).
    Использует стриминг Tavily (SSE формат) для трансляции прогресса, источников и отчета.
    """
    logger.info(f"Steaming Deep Research using Tavily for query: {query}")
    tavily = await _get_tavily_client()
    if not tavily:
        yield {"type": "chunk", "content": "Интернет-поиск отключен."}
        return

    try:
        # stream=True returns a coroutine that must be awaited to get the async iterator
        stream = await tavily.research(query, stream=True, model="pro", country="russia")
        
        async for raw_event in stream:
            if not isinstance(raw_event, bytes):
                continue
            
            # SSE events are usually strings starting with "data: "
            line = raw_event.decode('utf-8').strip()
            if not line.startswith("data: "):
                continue
                
            data_str = line[len("data: "):]
            if data_str == "[DONE]":
                break
                
            try:
                data = json.loads(data_str)
                choices = data.get("choices", [])
                if not choices:
                    continue
                
                delta = choices[0].get("delta", {})
                
                # 1. Handle Thought/Planning (from tool_calls)
                if "tool_calls" in delta:
                    # Planning steps
                    tc_list = delta["tool_calls"].get("tool_call", [])
                    for tc in tc_list:
                        args = tc.get("arguments")
                        if args:
                            yield {"type": "thought", "content": f"{args}\n"}
                    
                    # Sources
                    tr_list = delta["tool_calls"].get("tool_response", [])
                    for tr in tr_list:
                        sources = tr.get("sources", [])
                        if sources:
                            formatted_sources = [{"title": s.get("title", "Источник"), "url": s.get("url", "")} for s in sources]
                            yield {"type": "sources", "data": formatted_sources}
                
                # 2. Handle Content Chunks
                if "content" in delta and delta["content"]:
                    yield {"type": "chunk", "content": delta["content"]}
                
            except json.JSONDecodeError:
                continue
                
    except Exception as e:
        logger.error(f"Tavily Deep Research streaming error: {e}")
        yield {"type": "chunk", "content": f"\n\n[Ошибка исследования: {str(e)}]"}
    finally:
        if tavily: await tavily.close()
