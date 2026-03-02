import asyncio
import logging
from duckduckgo_search import DDGS
from scraper import fetch_article, extract_text

logger = logging.getLogger(__name__)

def perform_web_search(query: str, max_results: int = 5) -> list[tuple[str, str]]:
    """
    Выполняет поиск в DuckDuckGo и возвращает список кортежей (url, snippet) топ-результатов.
    """
    results_list = []
    try:
        with DDGS() as ddgs:
            # Ищем топ n результатов
            results = ddgs.text(query, max_results=max_results)
            for r in results:
                url = r.get("href")
                snippet = r.get("body", "")
                if url:
                    results_list.append((url, snippet))
    except Exception as e:
        logger.error(f"Error performing web search for '{query}': {e}")
    return results_list

def fetch_and_scrape_links(search_results: list[tuple[str, str]]) -> str:
    """
    Скачивает и парсит переданные ссылки.
    Склеивает результаты в единый markdown-текст с ограничением по длине для каждой статьи.
    """
    compiled_text = ""
    MAX_CHARS_PER_ARTICLE = 6000  # Increased to capture actual article body but limited to fit 5 pages

    for idx, (url, snippet) in enumerate(search_results, 1):
        html = fetch_article(url)
        if not html:
            # Если не смогли скачать, хотя бы добавим сниппет
            compiled_text += f"### Источник {idx}: {url}\nКраткое описание из поиска: {snippet}\n\n"
            continue
        
        text = extract_text(html)
        if not text:
            compiled_text += f"### Источник {idx}: {url}\nКраткое описание из поиска: {snippet}\n\n"
            continue
        
        # Обрезаем текст
        if len(text) > MAX_CHARS_PER_ARTICLE:
            text = text[:MAX_CHARS_PER_ARTICLE] + "...\n[Текст обрезан]"
        
        compiled_text += f"### Источник {idx}: {url}\nКраткое описание из поиска: {snippet}\nСодержимое страницы:\n{text}\n\n"
        
    return compiled_text.strip()

def execute_search_agent(query: str) -> str:
    """
    Оркестратор агента поиска по интернету.
    1. Ищет ссылки по запросу.
    2. Скачивает их содержимое.
    3. Формирует текстовый контекст для RAG.
    """
    logger.info(f"Executing web search agent for query: {query}")
    search_results = perform_web_search(query, max_results=5)
    
    if not search_results:
        return "Интернет-поиск не дал результатов по этому запросу."
    
    logger.info(f"Found {len(search_results)} URLs. Starting to scrape...")
    context = fetch_and_scrape_links(search_results)
    
    if not context:
         return "Не удалось извлечь читаемый текст с найденных сайтов."
    
    return context
