import os
import logging
import httpx
try:
    from langfuse.decorators import observe
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f

logger = logging.getLogger("app")

ROUTERAI_BASE_URL = os.getenv("ROUTERAI_API_BASE", "https://routerai.ru/api/v1").rstrip("/")


@observe(name="routerai_rerank")
async def rerank_documents(query: str, documents: list[str], top_n: int = 30, model: str | None = None) -> list[dict]:
    """Use RouterAI's dedicated rerank endpoint and return ranked indices/scores."""
    if not documents:
        return []
    api_key = os.getenv("ROUTERAI_API_KEY")
    if not api_key:
        logger.warning("ROUTERAI_API_KEY is missing; preserving source order")
        return [{"index": i, "relevance_score": 0.0} for i in range(min(top_n, len(documents)))]
    requested_model = model or os.getenv("ROUTERAI_RERANK_MODEL", "cohere/rerank-v3.5")
    timeout = float(os.getenv("RERANK_TIMEOUT_SECONDS", "30"))
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{ROUTERAI_BASE_URL}/rerank",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": requested_model,
                "query": query,
                "documents": documents,
                "top_n": min(top_n, len(documents)),
            },
        )
        response.raise_for_status()
        data = response.json()
    raw_results = (data.get("results") or data.get("data") or []) if isinstance(data, dict) else []
    results = []
    seen = set()
    for item in raw_results:
        index = item.get("index") if isinstance(item, dict) else None
        score = item.get("relevance_score", item.get("score", 0.0)) if isinstance(item, dict) else 0.0
        if isinstance(index, int) and 0 <= index < len(documents) and index not in seen:
            results.append({"index": index, "relevance_score": float(score)})
            seen.add(index)
        if len(results) >= min(top_n, len(documents)):
            break
    return results
