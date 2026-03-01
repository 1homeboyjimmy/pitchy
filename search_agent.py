import asyncio
import logging
from duckduckgo_search import DDGS
from scraper import fetch_article, extract_text

logger = logging.getLogger(__name__)

def perform_web_search(query: str, max_results: int = 3) -> list[str]:
    """
    Выполняет поиск в DuckDuckGo и возвращает список URL-адресов топ-результатов.
    """
    urls = []
    try:
        with DDGS() as ddgs:
            # Ищем топ n результатов
            results = ddgs.text(query, max_results=max_results)
            for r in results:
                url = r.get("href")
                if url:
                    urls.append(url)
    except Exception as e:
        logger.error(f"Error performing web search for '{query}': {e}")
    return urls

def fetch_and_scrape_links(urls: list[str]) -> str:
    """
    Скачивает и парсит переданные ссылки.
    Склеивает результаты в единый markdown-текст с ограничением по длине для каждой статьи.
    """
    compiled_text = ""
    MAX_CHARS_PER_ARTICLE = 3000  # Чтобы не переполнить контекст ИИ

    for idx, url in enumerate(urls, 1):
        html = fetch_article(url)
        if not html:
            continue
        
        text = extract_text(html)
        if not text:
            continue
        
        # Обрезаем текст
        if len(text) > MAX_CHARS_PER_ARTICLE:
            text = text[:MAX_CHARS_PER_ARTICLE] + "...\n[Текст обрезан]"
        
        compiled_text += f"### Источник {idx}: {url}\n{text}\n\n"
        
    return compiled_text.strip()

def execute_search_agent(query: str) -> str:
    """
    Оркестратор агента поиска по интернету.
    1. Ищет ссылки по запросу.
    2. Скачивает их содержимое.
    3. Формирует текстовый контекст для RAG.
    """
    logger.info(f"Executing web search agent for query: {query}")
    urls = perform_web_search(query, max_results=3)
    
    if not urls:
        return "Интернет-поиск не дал результатов по этому запросу."
    
    logger.info(f"Found {len(urls)} URLs. Starting to scrape...")
    context = fetch_and_scrape_links(urls)
    
    if not context:
         return "Не удалось извлечь читаемый текст с найденных сайтов."
    
    return context
