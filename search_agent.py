import os
import asyncio
import logging
from exa_py import Exa
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


def _get_exa_client() -> Exa | None:
    load_dotenv()
    api_key = os.getenv("EXA_API_KEY", "")
    if not api_key:
        logger.warning("EXA_API_KEY is missing. Web search (Exa) is disabled.")
        return None
    logger.info(f"Exa client initialized with key starting with {api_key[:5]}...")
    return Exa(api_key)

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
            
            # Boost Rosstat for statistical queries
            search_kwargs = {
                "type": "auto",
                "num_results": num_results,
                "highlights": True
            }
            
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

            return exa_client.search_and_contents(
                localized_query,
                **search_kwargs
            )
            
        response = await asyncio.to_thread(_do_search)
        
        sources = []
        compiled_text = ""
        
        if not response or not response.results:
            return [], "Поиск не дал результатов."
            
        for idx, r in enumerate(response.results, 1):
            # Use highlights if available, otherwise fallback to text
            content = ""
            if hasattr(r, 'highlights') and r.highlights:
                content = "\n".join(r.highlights)
            else:
                text_attr = getattr(r, 'text', '')
                content = text_attr[:1000] + "..." if len(text_attr) > 1000 else text_attr

            # Skip anti-bot / WAF interstitials (Cloudflare "You have been
            # blocked", captcha, "Just a moment") captured instead of the real
            # page — otherwise their boilerplate pollutes the answer.
            if _looks_like_block_page(content) or _looks_like_block_page(getattr(r, 'title', '')):
                logger.info(f"Skipping blocked/anti-bot source: {getattr(r, 'url', '')}")
                continue

            sources.append({"title": _maybe_fix_mojibake(getattr(r, 'title', 'Источник')), "url": getattr(r, 'url', '')})
            compiled_text += f"### Источник {idx}: {getattr(r, 'url', '')}\nСодержимое:\n{content}\n\n"
            
        return sources, compiled_text.strip()
    
    except Exception as e:
        # Never surface the raw exception to the user: when Exa's API is
        # Cloudflare-blocked for our egress IP (403) it raises with the entire
        # block-page HTML as the message, which was leaking into chat answers.
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
