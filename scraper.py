import requests
from bs4 import BeautifulSoup
import os
from pathlib import Path
from urllib.parse import urlparse


DOCS_DIR = Path(os.getenv("ADMIN_DOCS_DIR", "admin_docs"))


def clean_filename(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.strip("/").replace("/", "_")
    domain = parsed.netloc.replace("www.", "")
    if not path:
        path = "index"
    return f"{domain}_{path}.txt"


def fetch_article(url: str) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/91.0.4472.124 Safari/537.36"
        )
    }
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    try:
        response = requests.get(url, headers=headers, timeout=10, verify=False)
        response.raise_for_status()
        response.encoding = response.apparent_encoding
        return response.text
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return ""


def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    
    # Remove junk
    for el in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "iframe"]):
        el.decompose()
        
    # Try to find the primary content container
    main_content = soup.body if soup.body else soup
    
    text = main_content.get_text(separator="\n\n")

    # Clean up whitespace
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    text = '\n'.join(chunk for chunk in chunks if chunk)
    return text


def scrape_and_save(url: str) -> tuple[str | None, str | None]:
    print(f"Scraping {url}...")
    html = fetch_article(url)
    if not html:
        return None, None

    text = extract_text(html)
    if not text:
        print("No text extracted.")
        return None, None

    filename = clean_filename(url)
    filepath = DOCS_DIR / filename

    os.makedirs(DOCS_DIR, exist_ok=True)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Source: {url}\n\n")
        f.write(text)

    print(f"Saved to {filepath}")
    return str(filepath), text

def extract_text_from_pdf(filepath: str | Path) -> str:
    from pypdf import PdfReader
    
    text = ""
    try:
        reader = PdfReader(str(filepath))
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n\n"
        return text.strip()
    except Exception as e:
        print(f"Error extracting PDF: {e}")
        return ""



if __name__ == "__main__":
    # Example URLs (replace with real legal/news sources later)
    urls = [
        "https://example.com",
        # Add more URLs here
    ]

    for url in urls:
        scrape_and_save(url)
