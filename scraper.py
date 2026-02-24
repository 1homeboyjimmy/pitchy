import requests
from bs4 import BeautifulSoup
import os
from pathlib import Path
from urllib.parse import urlparse


DOCS_DIR = Path("sample_docs")


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

    # Remove script and style elements
    for script in soup(["script", "style", "nav", "footer", "header", "aside"]):
        script.decompose()

    # Get text
    text = soup.get_text(separator="\n\n")

    # Break into lines and remove leading and trailing space on each
    lines = (line.strip() for line in text.splitlines())
    # Break multi-headlines into a line each
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    # Drop blank lines
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


if __name__ == "__main__":
    # Example URLs (replace with real legal/news sources later)
    urls = [
        "https://example.com",
        # Add more URLs here
    ]

    for url in urls:
        scrape_and_save(url)
