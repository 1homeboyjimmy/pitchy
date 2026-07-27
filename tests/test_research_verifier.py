import json

import pytest

import research_service


def _claims(count: int) -> list[dict]:
    return [
        {
            "claim": f"Claim {index}",
            "source_index": index + 1,
            "passage": f"Evidence {index}",
        }
        for index in range(count)
    ]


@pytest.mark.asyncio
async def test_verify_splits_claims_into_small_batches(monkeypatch):
    calls: list[list[dict]] = []

    async def fake_call(_system, prompt, **_kwargs):
        batch = json.loads(prompt.split("Утверждения:\n", 1)[1])
        calls.append(batch)
        verdicts = [
            {
                "claim_index": item["claim_index"],
                "status": "supported",
                "confidence": 0.9,
                "reason": "Matches passage",
            }
            for item in batch
        ]
        return json.dumps({"verdicts": verdicts}), None, {}

    monkeypatch.setattr(research_service, "call_routerai", fake_call)
    result = await research_service._verify("query", _claims(17), [])

    assert sorted(len(batch) for batch in calls) == [1, 8, 8]
    assert all(claim["status"] == "supported" for claim in result)


@pytest.mark.asyncio
async def test_verify_degrades_missing_verdicts_without_failing_job(monkeypatch):
    calls = 0

    async def fake_call(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return "", None, {"completion_tokens": 5000}

    monkeypatch.setattr(research_service, "call_routerai", fake_call)
    result = await research_service._verify("query", _claims(9), [])

    assert calls == 4
    assert all(claim["status"] == "partial" for claim in result)
    assert all(claim["confidence"] == 0.35 for claim in result)
    assert all("исходным фрагментом" in claim["verification_reason"] for claim in result)


@pytest.mark.asyncio
async def test_collect_keeps_research_context_in_every_search_branch(monkeypatch):
    queries: list[str] = []

    async def fake_search(query, _limit):
        queries.append(query)
        return [{"url": f"https://example.com/{len(queries)}", "content": "text", "title": "title"}]

    monkeypatch.setattr(research_service, "research_search_documents", fake_search)
    plan = {
        "objective": "Определить лидера цветочного рынка Москвы",
        "scope": {"geography": "Москва", "segment": "цветочные магазины"},
        "questions": [
            {"id": "q1", "question": "Кто входит в топ-5?", "preferred_sources": ["2GIS"]},
            {"id": "q2", "question": "Какая выручка игроков?", "preferred_sources": ["отчётность"]},
        ],
    }

    await research_service._collect(plan)

    assert len(queries) == 3
    assert all("цветочного рынка Москвы" in query for query in queries)
    assert all("цветочные магазины" in query for query in queries)


def test_select_ranked_documents_drops_low_score_tail(monkeypatch):
    monkeypatch.setattr(research_service, "RERANK_MIN_SCORE", 0.2)
    monkeypatch.setattr(research_service, "RERANK_MIN_DOCUMENTS", 2)
    docs = [{"title": f"Doc {index}"} for index in range(5)]
    ranking = [
        {"index": 0, "relevance_score": 0.9},
        {"index": 1, "relevance_score": 0.4},
        {"index": 2, "relevance_score": 0.1},
        {"index": 3, "relevance_score": 0.05},
        {"index": 4, "relevance_score": 0.01},
    ]

    selected = research_service._select_ranked_documents(docs, ranking)

    assert [doc["title"] for doc in selected] == ["Doc 0", "Doc 1"]


@pytest.mark.asyncio
async def test_extract_claims_uses_structured_extractor_and_retries_invalid_json(monkeypatch):
    calls = 0

    async def fake_call(_system, _prompt, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            assert kwargs["model"] == research_service.EXTRACTOR_MODEL
            return "not-json", None, {}
        assert kwargs["model"] == research_service.EXTRACTOR_FALLBACK_MODEL
        return json.dumps({
            "claims": [{
                "claim": "Relevant fact",
                "value_text": None,
                "unit": None,
                "period": None,
                "geography": "Москва",
                "is_estimate": False,
                "source_index": 1,
                "passage": "Evidence",
            }]
        }), None, {}

    monkeypatch.setattr(research_service, "call_makura", fake_call)
    docs = [{"source_index": 1, "title": "Flowers", "url": "https://example.com", "content": "Evidence"}]

    claims = await research_service._extract_claims("цветочные магазины Москвы", docs)

    assert calls == 2
    assert claims[0]["claim"] == "Relevant fact"


@pytest.mark.asyncio
async def test_research_brief_becomes_global_metric_contract(monkeypatch):
    async def fake_call(_system, _prompt, **kwargs):
        assert kwargs["model"] == research_service.CRITIC_MODEL
        assert kwargs["response_format"] == {"type": "json_object"}
        return json.dumps({
            "direct_answer": "Единого лидера определить нельзя.",
            "decision_status": "inconclusive",
            "entities": [{"name": "A", "role": "лидер по числу точек", "segment": "офлайн"}],
            "metric_registry": [{
                "metric": "точки",
                "value": "10",
                "geography": "Москва",
                "period": "2026",
                "status": "fact",
                "interpretation": "Только физическое присутствие",
            }],
            "scope_rules": {"geography": "Москва"},
            "caveats": ["Нет сопоставимой выручки"],
        }), None, {}

    monkeypatch.setattr(research_service, "call_routerai", fake_call)
    claims = [{
        "claim": "У A 10 точек в Москве",
        "value_text": "10",
        "period": "2026",
        "geography": "Москва",
        "status": "supported",
        "confidence": 0.9,
        "source_index": 1,
    }]

    brief = await research_service._build_research_brief(
        "Кто лидер?",
        {"objective": "Определить лидера", "scope": {"geography": "Москва"}},
        claims,
    )

    assert brief["decision_status"] == "inconclusive"
    assert brief["metric_registry"][0]["geography"] == "Москва"


@pytest.mark.asyncio
async def test_critic_preserves_draft_when_rewrite_is_empty(monkeypatch):
    async def fake_call(*_args, **kwargs):
        assert kwargs["model"] == research_service.CRITIC_MODEL
        assert kwargs["max_tokens"] == 8000
        return "", None, {}

    monkeypatch.setattr(research_service, "call_routerai", fake_call)
    draft = "## Прямой ответ\n\n" + ("Проверенный текст. " * 80)

    edited = await research_service._edit_report(
        "Исходный запрос",
        draft,
        {"direct_answer": "Ответ", "decision_status": "qualified"},
    )

    assert edited == draft
