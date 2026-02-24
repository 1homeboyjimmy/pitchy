import argparse
import time
import logging
import sys
from urllib.parse import urlparse, urljoin
import requests
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET

from dotenv import load_dotenv

# Initialize early so DB/RAG are ready
load_dotenv()
import rag
from lockbox import lockbox
try:
    _lb_secrets = lockbox.get_secrets()
    import os
    for k, v in _lb_secrets.items():
        if k not in os.environ:
            os.environ[k] = v
except Exception:
    pass

from scraper import scrape_and_save, fetch_article

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def parse_sitemap(sitemap_url: str) -> list[str]:
    """Parses a sitemap.xml and returns a list of URLs."""
    logger.info(f"Fetching sitemap: {sitemap_url}")
    try:
        # Spoof user-agent just in case
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        resp = requests.get(sitemap_url, headers=headers, timeout=10)
        resp.raise_for_status()
        
        root = ET.fromstring(resp.content)
        # Sitemaps use namespaces, e.g. {http://www.sitemaps.org/schemas/sitemap/0.9}url
        urls = []
        for elem in root.iter():
            if 'loc' in elem.tag:
                text = elem.text.strip() if elem.text else ""
                if text.startswith("http"):
                    urls.append(text)
        return list(set(urls))
    except Exception as e:
        logger.error(f"Failed to parse sitemap: {e}")
        return []

def crawl_website(start_url: str, max_pages: int) -> list[str]:
    """Crawls a website starting from a URL, finding links within the same domain."""
    logger.info(f"Starting crawl at {start_url} (max {max_pages} pages)")
    
    domain = urlparse(start_url).netloc
    if getattr(urlparse(start_url), 'scheme', '') == '':
        logger.error("Start URL must include http:// or https://")
        return []

    visited = set()
    queue = [start_url]
    found_urls = []
    
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

    while queue and len(visited) < max_pages:
        url = queue.pop(0)
        if url in visited:
            continue
            
        visited.add(url)
        found_urls.append(url)
        logger.info(f"Crawling: {url}")
        
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code != 200 or 'text/html' not in resp.headers.get('Content-Type', ''):
                continue
                
            soup = BeautifulSoup(resp.content, "html.parser")
            for link in soup.find_all('a', href=True):
                href = link['href']
                absolute_url = urljoin(url, href)
                
                # Strip fragments (#)
                absolute_url = absolute_url.split('#')[0]
                
                # Check if it's the same domain and using http/https
                parsed = urlparse(absolute_url)
                if parsed.netloc == domain and parsed.scheme in ['http', 'https']:
                    if absolute_url not in visited and absolute_url not in queue:
                        queue.append(absolute_url)
                        
            time.sleep(0.5)  # Be nice to the server
        except Exception as e:
            logger.warning(f"Error crawling {url}: {e}")
            
    return found_urls

def append_to_rag(url: str, delay: float = 1.0):
    """Scrapes a URL and injects it into ChromaDB RAG."""
    try:
        # Use existing scraper logic
        filepath, text = scrape_and_save(url)
        if text and filepath:
            chunks = rag.add_text_to_rag(text)
            logger.info(f"SUCCESS: Added {chunks} chunks from {url}")
        else:
            logger.warning(f"SKIPPED: Could not extract text from {url}")
            
    except Exception as e:
        logger.error(f"FAILED on {url}: {e}")
    finally:
        time.sleep(delay) # Prevent rate limiting

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Universal Web Crawler for Pitchy RAG")
    parser.add_argument("url", help="The URL to start crawling from (or sitemap.xml URL)")
    parser.add_argument("--sitemap", action="store_true", help="Treat the URL as a sitemap.xml")
    parser.add_argument("--max-pages", "-m", type=int, default=50, help="Maximum number of pages to crawl (default: 50)")
    parser.add_argument("--delay", "-d", type=float, default=1.5, help="Delay in seconds between scraping pages (default: 1.5s)")
    
    args = parser.parse_args()
    
    logger.info("Initializing RAG database connection...")
    rag.init_rag()

    urls_to_scrape = []
    if args.sitemap:
        urls_to_scrape = parse_sitemap(args.url)
        # Optionally limit sitemaps too so we don't accidentally pull 100k pages
        if len(urls_to_scrape) > args.max_pages:
            logger.info(f"Sitemap has {len(urls_to_scrape)} URLs. Limiting to {args.max_pages}...")
            urls_to_scrape = urls_to_scrape[:args.max_pages]
    else:
        urls_to_scrape = crawl_website(args.url, args.max_pages)
        
    logger.info(f"Found {len(urls_to_scrape)} URLs to scrape and index.")
    if not urls_to_scrape:
        logger.error("No URLs found. Exiting.")
        sys.exit(0)
        
    for i, u in enumerate(urls_to_scrape):
        logger.info(f"Processing {i+1}/{len(urls_to_scrape)}: {u}")
        append_to_rag(u, delay=args.delay)
        
    logger.info("Crawl complete! Target database is updated.")
