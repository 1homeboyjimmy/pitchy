import os
import logging
import httpx
from dotenv import load_dotenv

try:
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

logger = logging.getLogger(__name__)


def _maybe_fix_mojibake(title: str) -> str:
    """Detect cp1251-decoded-from-utf-8 mojibake in Exa-returned titles
    (happens when the source page has no <meta charset> and gets read as
    cp1251) and recover.

    Mojibake signature: titles like "Р§РРЎР›Р•РќРќРћРЎРўР¬" where each
    UTF-8 byte of the original cyrillic letter became a single cp1251
    character. Round-trip via `.encode('cp1251').decode('utf-8')` reverses
    the breakage. No-op if input isn't actually mojibake.
    """
    if not title or not isinstance(title, str):
        return title or "Источник"
    # Quick reject: real Russian text rarely has runs of "Р" / "С" / "Т" as
    # standalone capitals next to each other; mojibake titles are full of them.
    if not any(c in title for c in "РСТУФ"):
        return title
    try:
        recovered = title.encode("cp1251").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return title
    # Sanity: recovered should look like real Russian (cyrillic letters in
    # normal a-я range, not the upper-case-only mash that mojibake produces).
    def _cyr_density(s: str) -> int:
        return sum(1 for c in s if "Ѐ" <= c <= "ӿ")
    orig = _cyr_density(title)
    rec = _cyr_density(recovered)
    if rec >= 3 and rec >= orig:
        return recovered
    return title


# Anti-bot / WAF interstitials (Cloudflare "You have been blocked",
# DDoS-Guard, captcha/"Just a moment" pages) that the search backend
# sometimes captures instead of the real page. Their boilerplate is useless
# and was leaking "Cloudflare Ray ID / Your IP" text into research answers,
# so we detect and drop such sources entirely.
_BLOCK_PAGE_MARKERS = (
    "cloudflare ray id",
    "you have been blocked",
    "attention required",
    "cf-error",
    "captcha-container",
    "checking your browser before accessing",
    "enable javascript and cookies to continue",
    "verify you are human",
    "ddos-guard",
    "just a moment...",
)


def _looks_like_block_page(text: str) -> bool:
    """True if `text` looks like an anti-bot/WAF interstitial, not real content."""
    if not text:
        return False
    low = text.lower()
    return any(marker in low for marker in _BLOCK_PAGE_MARKERS)


DEFAULT_EXA_API_BASE = "https://api.exa.ai"
DEFAULT_EXA_TIMEOUT_SECONDS = 30.0


class ExaSearchError(Exception):
    """Exa returned a non-2xx response. Carries the status code only — never the
    body, which for Cloudflare blocks is a full HTML page."""


def get_exa_proxy() -> str | None:
    """HTTP CONNECT proxy used to reach api.exa.ai, or None for direct egress.

    Cloudflare 403s api.exa.ai from our RU egress IP, so the request has to
    leave through the German node. Same tinyproxy the media subproject uses
    (`SEARCH_HTTPS_PROXY` there) — `SEARCH_HTTPS_PROXY` is accepted here too so
    a box running both stacks can share one value. Empty string = no proxy.
    """
    proxy = (os.getenv("EXA_HTTPS_PROXY") or os.getenv("SEARCH_HTTPS_PROXY") or "").strip()
    return proxy or None


def _get_exa_api_key() -> str:
    load_dotenv()
    api_key = os.getenv("EXA_API_KEY", "")
    if not api_key:
        logger.warning("EXA_API_KEY is missing. Web search (Exa) is disabled.")
        return ""
    proxy = get_exa_proxy()
    logger.info(
        f"Exa configured with key starting with {api_key[:5]}... "
        f"(egress: {'proxy' if proxy else 'direct'})"
    )
    return api_key


async def _exa_search(query: str, num_results: int, api_key: str) -> dict:
    """POST /search against Exa's REST API through the egress proxy.

    We call the REST endpoint directly instead of the `exa_py` SDK: the SDK
    builds its requests with bare `requests.request(...)` and exposes no way to
    attach a proxy, and the only alternative — a container-wide `HTTPS_PROXY` —
    would push every other outbound integration through Germany too.
    """
    body = {
        "query": query,
        "type": "deep",
        "numResults": num_results,
        # `text` alongside `highlights` so the fallback below has something to
        # use when Exa returns no highlights for a result.
        "contents": {"text": True, "highlights": True},
    }
    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    # Read config here, not at import time: `load_dotenv()` runs on first use.
    base_url = (os.getenv("EXA_BASE_URL") or DEFAULT_EXA_API_BASE).rstrip("/")
    try:
        timeout = float(os.getenv("EXA_TIMEOUT_SECONDS") or DEFAULT_EXA_TIMEOUT_SECONDS)
    except ValueError:
        timeout = DEFAULT_EXA_TIMEOUT_SECONDS
    async with httpx.AsyncClient(proxy=get_exa_proxy(), timeout=timeout) as client:
        response = await client.post(f"{base_url}/search", json=body, headers=headers)
    if response.status_code >= 400:
        raise ExaSearchError(f"Exa returned HTTP {response.status_code}")
    return response.json()

@observe(name="Deep Search (Exa AI)")
async def async_search_with_sources(query: str, use_deep_search: bool = False, trace_id: str = None, parent_observation_id: str = None) -> tuple[list[dict], str]:
    """
    Асинхронная функция поиска через Exa AI.
    Возвращает (sources_list, context_string).
    Обеспечивает мягкую деградацию при недоступности API.
    """
    if langfuse_context:
        if trace_id:
            langfuse_context.update(trace_id=trace_id)
        if parent_observation_id:
            langfuse_context.update(parent_observation_id=parent_observation_id)
        
    logger.info(f"Executing async API search using Exa for query: {query}, deep_search: {use_deep_search}")
    
    api_key = _get_exa_api_key()
    if not api_key:
        return [], "Интернет-поиск отключен (отсутствует EXA_API_KEY)."

    try:
        num_results = 10 if use_deep_search else 3

        localized_query = query if "росси" in query.lower() else f"{query} в россии"

        # Soft hint toward authoritative sources for statistical queries.
        # A hard `site:rosstat.gov.ru` operator was returning irrelevant
        # pages for topics that Rosstat doesn't actually cover (e.g.
        # МСП register is owned by FNS, not Rosstat) — so we let Exa
        # rank freely and just nudge the query with factual markers and
        # the authoritative domain names for each topic.
        ql = query.lower()
        if any(w in ql for w in ["статистика", "росстат", "цифр", "мвд", "мсп", "перепис"]):
            hints = ["официальная статистика", "реестр"]
            if "мсп" in ql or "малого" in ql or "малый бизнес" in ql:
                # МСП registry is published by FNS, not Rosstat
                hints.append("rmsp.nalog.ru единый реестр субъектов МСП ФНС")
            else:
                hints.append("rosstat.gov.ru")
            logger.info(f"Applying soft factual hints: {hints}")
            localized_query = f"{localized_query} {' '.join(hints)}"

        payload = await _exa_search(localized_query, num_results, api_key)

        sources = []
        compiled_text = ""

        results = payload.get("results") or []
        if not results:
            return [], "Поиск не дал результатов."

        for r in results:
            url = r.get("url") or ""
            title = r.get("title") or "Источник"

            # Use highlights if available, otherwise fallback to text
            highlights = r.get("highlights") or []
            if highlights:
                content = "\n".join(highlights)
            else:
                text_attr = r.get("text") or ""
                content = text_attr[:1000] + "..." if len(text_attr) > 1000 else text_attr

            # Skip anti-bot / WAF interstitials (Cloudflare "You have been
            # blocked", captcha, "Just a moment") captured instead of the real
            # page — otherwise their boilerplate pollutes the answer.
            if _looks_like_block_page(content) or _looks_like_block_page(title):
                logger.info(f"Skipping blocked/anti-bot source: {url}")
                continue

            sources.append({"title": _maybe_fix_mojibake(title), "url": url})
            # Number by kept sources, not by position in the raw response: the
            # skip above used to leave gaps, so "Источник 3" in the context
            # pointed at a different item than the 3rd entry of `sources`.
            compiled_text += f"### Источник {len(sources)}: {url}\nСодержимое:\n{content}\n\n"

        return sources, compiled_text.strip()
    
    except Exception as e:
        # Never surface the raw exception to the user: a Cloudflare block on our
        # egress IP answers 403 with a full HTML page, which used to leak into
        # chat answers. `ExaSearchError` carries the status code only, and the
        # generic message below covers proxy/timeout failures too.
        logger.error(f"Async Exa search error: {e}")
        return [], "Интернет-поиск временно недоступен."

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

@observe(name="Research Search (Exa AI)")
async def research_search_documents(query: str, num_results: int = 8) -> list[dict]:
    """Return clean source documents for the persistent research pipeline."""
    api_key = _get_exa_api_key()
    if not api_key:
        return []
    payload = await _exa_search(query, max(1, min(num_results, 20)), api_key)
    documents = []
    for result in payload.get("results") or []:
        title = _maybe_fix_mojibake(result.get("title") or "Источник")
        url = result.get("url") or ""
        highlights = result.get("highlights") or []
        content = "\n".join(highlights) if highlights else (result.get("text") or "")
        content = content[:12000]
        if not url or not content or _looks_like_block_page(title) or _looks_like_block_page(content):
            continue
        documents.append({"title": title, "url": url, "content": content, "published_date": result.get("publishedDate")})
    return documents