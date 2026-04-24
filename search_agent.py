import os
import asyncio
import logging
from exa_py import Exa
from dotenv import load_dotenv

try:
    from langfuse.decorators import observe
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f

logger = logging.getLogger(__name__)

def _get_exa_client() -> Exa | None:
    load_dotenv()
    api_key = os.getenv("EXA_API_KEY", "")
    if not api_key:
        logger.warning("EXA_API_KEY is missing. Web search (Exa) is disabled.")
        return None
    logger.info(f"Exa client initialized with key starting with {api_key[:5]}...")
    return Exa(api_key)

@observe(name="Deep Search (Exa AI)")
async def async_search_with_sources(query: str, use_deep_search: bool = False) -> tuple[list[dict], str]:
    """
    Асинхронная функция поиска через Exa AI.
    Возвращает (sources_list, context_string).
    Обеспечивает мягкую деградацию при недоступности API.
    """
    logger.info(f"Executing async API search using Exa for query: {query}, deep_search: {use_deep_search}")
    
    # Init client
    exa_client = None
    try:
        exa_client = await asyncio.to_thread(_get_exa_client)
    except Exception as e:
        logger.error(f"Failed to initialize Exa client: {e}")
        
    if not exa_client:
        return [], "Интернет-поиск отключен (отсутствует EXA_API_KEY)."
    
    try:
        num_results = 10 if use_deep_search else 3
        
        # exa_py operations are synchronous
        def _do_search():
            localized_query = query if "росси" in query.lower() else f"{query} в россии"
            return exa_client.search_and_contents(
                localized_query,
                type="auto",
                use_autoprompt=True,
                num_results=num_results,
                highlights=True,
                include_domains=["ru", "su", "рф"]
            )
            
        response = await asyncio.to_thread(_do_search)
        
        sources = []
        compiled_text = ""
        
        if not response or not response.results:
            return [], "Поиск не дал результатов."
            
        for idx, r in enumerate(response.results, 1):
            sources.append({"title": getattr(r, 'title', 'Источник'), "url": getattr(r, 'url', '')})
            
            # Use highlights if available, otherwise fallback to text
            content = ""
            if hasattr(r, 'highlights') and r.highlights:
                content = "\n".join(r.highlights)
            else:
                text_attr = getattr(r, 'text', '')
                content = text_attr[:1000] + "..." if len(text_attr) > 1000 else text_attr
                
            compiled_text += f"### Источник {idx}: {getattr(r, 'url', '')}\nСодержимое:\n{content}\n\n"
            
        return sources, compiled_text.strip()
    
    except Exception as e:
        logger.error(f"Async Exa search error: {e}")
        return [], f"Произошла ошибка при поиске в интернете: {str(e)}"

async def execute_search_agent(query: str) -> str:
    """Оркестратор для обратной совместимости."""
    _, text = await async_search_with_sources(query, use_deep_search=False)
    return text

async def execute_deep_research(query: str) -> tuple[str, list[dict]]:
    """Обратная совместимость для глубокого исследования."""
    sources, context = await async_search_with_sources(query, use_deep_search=True)
    return context, sources

async def stream_deep_research(query: str):
    """Отключаем стриминг Tavily в Pitchy 2.0."""
    yield {"type": "thought", "content": "Инициализация Exa Search...\n"}
    sources, context = await async_search_with_sources(query, use_deep_search=True)
    yield {"type": "sources", "data": sources}
    yield {"type": "chunk", "content": context}
