import pytest

import rag_reranker


@pytest.mark.asyncio
async def test_rerank_chunks_uses_voyageai_through_router(monkeypatch):
    calls = []

    async def fake_rerank_documents(**kwargs):
        calls.append(kwargs)
        return [
            {"index": 2, "relevance_score": 0.9},
            {"index": 0, "relevance_score": 0.8},
        ]

    monkeypatch.setattr(rag_reranker, "rerank_documents", fake_rerank_documents)

    result = await rag_reranker.rerank_chunks(
        "best market", ["first", "second", "third"], top_k=2
    )

    assert result == ["third", "first"]
    assert calls == [{
        "query": "best market",
        "documents": ["first", "second", "third"],
        "top_n": 2,
        "model": "voyageai/rerank-2.5-lite",
    }]


@pytest.mark.asyncio
async def test_rerank_chunks_falls_back_on_router_failure(monkeypatch):
    async def fake_rerank_documents(**kwargs):
        raise RuntimeError("router unavailable")

    monkeypatch.setattr(rag_reranker, "rerank_documents", fake_rerank_documents)

    chunks = ["first", "second", "third"]
    assert await rag_reranker.rerank_chunks("query", chunks, top_k=2) == chunks[:2]


@pytest.mark.asyncio
async def test_rerank_chunks_rejects_invalid_and_duplicate_indices(monkeypatch):
    async def fake_rerank_documents(**kwargs):
        return [
            {"index": 1, "relevance_score": 0.9},
            {"index": 1, "relevance_score": 0.8},
            {"index": 99, "relevance_score": 0.7},
            {"index": 0, "relevance_score": 0.6},
        ]

    monkeypatch.setattr(rag_reranker, "rerank_documents", fake_rerank_documents)

    result = await rag_reranker.rerank_chunks(
        "query", ["first", "second", "third"], top_k=2
    )

    assert result == ["second", "first"]


@pytest.mark.asyncio
async def test_rerank_chunks_still_reorders_when_candidates_fit_top_k(monkeypatch):
    async def fake_rerank_documents(**kwargs):
        return [
            {"index": 1, "relevance_score": 0.9},
            {"index": 0, "relevance_score": 0.8},
        ]

    monkeypatch.setattr(rag_reranker, "rerank_documents", fake_rerank_documents)

    result = await rag_reranker.rerank_chunks("query", ["first", "second"], top_k=6)

    assert result == ["second", "first"]
