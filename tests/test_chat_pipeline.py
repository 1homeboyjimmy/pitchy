import pytest

import chat_pipeline
from schemas.base import TreeChatRequest


@pytest.mark.asyncio
async def test_rerank_preserves_candidate_metadata(monkeypatch):
    async def fake_indices(query, documents, top_k):
        return [1, 0]

    monkeypatch.setattr(chat_pipeline, "rerank_indices", fake_indices)
    entries = [
        {"text": "first", "metadata": {"source": "a"}},
        {"text": "second", "metadata": {"source": "b"}},
    ]

    result = await chat_pipeline.rerank_rag_entries("query", entries, top_k=2)

    assert [item["metadata"]["source"] for item in result] == ["b", "a"]


def test_evidence_keeps_raw_sources_when_swarm_facts_exist():
    context = chat_pipeline.build_evidence_context(
        project_context="roadmap state",
        rag_entries=[{
            "text": "knowledge fact",
            "metadata": {"source": "handbook.pdf", "category": "market_analysis"},
            "score": 0.91,
        }],
        web_context="[WEB1] fresh fact",
        swarm_facts="extracted metric",
    )

    assert "[EVIDENCE SAFETY]" in context
    assert "[KB1] source=handbook.pdf" in context
    assert "knowledge fact" in context
    assert "[WEB1] fresh fact" in context
    assert "extracted metric" in context


def test_category_allowlist_rejects_arbitrary_collection_names():
    assert chat_pipeline.sanitize_categories([
        "market_analysis", "../../private", "market_analysis", 123
    ]) == ["market_analysis"]


def test_fresh_public_statistics_force_web_search():
    assert chat_pipeline.requires_fresh_web_search(
        "Сколько МСП в РФ на 2026 год?", current_year=2026
    )
    assert chat_pipeline.requires_fresh_web_search(
        "Какие сейчас требования закона к обработке данных?", current_year=2026
    )
    assert not chat_pipeline.requires_fresh_web_search(
        "Помоги сформулировать ценностное предложение", current_year=2026
    )


def test_tree_chat_request_enforces_shared_limits():
    request = TreeChatRequest(message="hello", client_id="c", assistant_client_id="a")
    assert request.message == "hello"

    with pytest.raises(Exception):
        TreeChatRequest(message="x" * 20_001)

    with pytest.raises(Exception):
        TreeChatRequest(message="hello", client_id="x" * 51)
