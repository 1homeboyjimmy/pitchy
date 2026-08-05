"""Dedicated reranking for RAG chunks through RouterAI.

The reranker is a quality enhancer, not a hard dependency: if RouterAI is
unconfigured or unavailable, callers keep the source retrieval order.
"""

from __future__ import annotations

import logging

from routerai_client import rerank_documents

logger = logging.getLogger("app.reranker")

RERANKER_MODEL = "voyageai/rerank-2.5-lite"


async def rerank_indices(query: str, documents: list[str], top_k: int = 6) -> list[int]:
    """Return validated document indices ordered by relevance."""
    if not documents or top_k <= 0:
        return []

    result_limit = min(top_k, len(documents))
    if len(documents) == 1:
        return [0]

    try:
        ranking = await rerank_documents(
            query=query,
            documents=documents,
            top_n=result_limit,
            model=RERANKER_MODEL,
        )

        seen: set[int] = set()
        ordered_indices: list[int] = []
        for item in ranking:
            index = item.get("index") if isinstance(item, dict) else None
            if isinstance(index, int) and 0 <= index < len(documents) and index not in seen:
                ordered_indices.append(index)
                seen.add(index)
            if len(ordered_indices) >= result_limit:
                break

        if not ordered_indices:
            raise ValueError("RouterAI returned no valid rerank indices")

        logger.info(
            "Reranker %s picked %d of %d documents (order=%s)",
            RERANKER_MODEL,
            len(ordered_indices),
            len(documents),
            ordered_indices,
        )
        return ordered_indices
    except Exception as exc:
        logger.warning(
            "Reranker %s failed for query=%r (%s: %s); preserving retrieval order",
            RERANKER_MODEL,
            query[:80],
            type(exc).__name__,
            exc,
        )
        return list(range(result_limit))


async def rerank_chunks(query: str, chunks: list[str], top_k: int = 6) -> list[str]:
    """Return up to ``top_k`` chunks ordered by relevance to ``query``.

    RouterAI's dedicated rerank endpoint returns indices into ``chunks``. The
    response is validated here so a malformed provider response cannot break
    the chat pipeline or select a document more than once.
    """
    indices = await rerank_indices(query, chunks, top_k=top_k)
    return [chunks[index] for index in indices]
