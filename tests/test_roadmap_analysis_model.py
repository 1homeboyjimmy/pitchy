import importlib
import json
import sys
import types

import pytest


CORE_PASSPORT = {
    "core": {
        "name": "Pitchy",
        "problem": "Стартапам сложно собрать данные для заявки",
        "solution": "Единый цифровой паспорт и аналитика проекта",
        "target_audience": "Основатели технологических стартапов",
    },
}


@pytest.fixture
def roadmap_module(monkeypatch):
    """Import the unit under test without initializing the paid RAG client."""
    rag_stub = types.ModuleType("rag")
    monkeypatch.setitem(sys.modules, "rag", rag_stub)

    previous = sys.modules.pop("roadmap_analysis", None)
    module = importlib.import_module("roadmap_analysis")
    try:
        yield module
    finally:
        sys.modules.pop("roadmap_analysis", None)
        if previous is not None:
            sys.modules["roadmap_analysis"] = previous


@pytest.mark.asyncio
async def test_step_analysis_uses_main_chat_model(monkeypatch, roadmap_module):
    roadmap_analysis = roadmap_module
    monkeypatch.setenv("MAIN_CHAT_MODEL", "provider/main-chat")

    async def no_rag(_query):
        return ""

    captured = {}

    async def fake_call(system_prompt, user_message, model):
        captured["model"] = model
        captured["user_message"] = user_message
        return "step analysis", None, {"total_tokens": 1}

    monkeypatch.setattr(roadmap_analysis, "_rag_context", no_rag)
    monkeypatch.setattr(roadmap_analysis, "call_routerai", fake_call)

    passport = {**CORE_PASSPORT, "legal": {"entity_type": "ООО"}}
    result = await roadmap_analysis.analyze_step(passport, checkpoint_id="legal")

    assert result["analysis"] == "step analysis"
    assert captured["model"] == "provider/main-chat"
    assert "Юр. форма (ООО/ИП/физлицо): ООО" in captured["user_message"]


@pytest.mark.asyncio
async def test_overall_analysis_uses_main_chat_model(monkeypatch, roadmap_module):
    roadmap_analysis = roadmap_module
    monkeypatch.setenv("MAIN_CHAT_MODEL", "provider/main-chat")

    async def no_rag(_query):
        return ""

    async def no_web(_query, deep=False):
        return "", [], None

    captured = {}

    async def fake_call(system_prompt, user_message, model):
        captured["model"] = model
        captured["user_message"] = user_message
        return "analysis", None, {"total_tokens": 1}

    monkeypatch.setattr(roadmap_analysis, "_rag_context", no_rag)
    monkeypatch.setattr(roadmap_analysis, "_web_context", no_web)
    monkeypatch.setattr(roadmap_analysis, "call_routerai", fake_call)

    result = await roadmap_analysis.analyze_overall({"core": {"name": "Pitchy"}})

    assert result["analysis"] == "analysis"
    assert captured["model"] == "provider/main-chat"


@pytest.mark.asyncio
async def test_streaming_analysis_uses_main_chat_model(monkeypatch, roadmap_module):
    roadmap_analysis = roadmap_module
    monkeypatch.setenv("MAIN_CHAT_MODEL", "provider/main-chat")

    async def no_rag(_query):
        return ""

    async def no_web(_query, deep=False):
        return "", [], None

    captured = {}

    async def fake_stream(system_prompt, user_message, model):
        captured["model"] = model
        yield "full analysis"

    class EmptyResult:
        @staticmethod
        def scalar_one_or_none():
            return None

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, _query):
            return EmptyResult()

    monkeypatch.setattr(roadmap_analysis, "_rag_context", no_rag)
    monkeypatch.setattr(roadmap_analysis, "_web_context", no_web)
    monkeypatch.setattr(roadmap_analysis, "stream_routerai", fake_stream)
    monkeypatch.setattr(roadmap_analysis, "AsyncSessionLocal", FakeSession)

    events = [event async for event in roadmap_analysis.stream_overall(
        CORE_PASSPORT,
        project_id=1,
    )]

    payloads = [json.loads(event.removeprefix("data: ")) for event in events]
    assert any(payload.get("content") == "full analysis" for payload in payloads)
    assert not any(payload["type"] == "error" for payload in payloads)
    assert payloads[-1]["type"] == "done"
    assert captured["model"] == "provider/main-chat"


@pytest.mark.asyncio
async def test_step_analysis_is_persisted(monkeypatch, roadmap_module):
    roadmap_analysis = roadmap_module

    async def no_rag(_query):
        return ""

    async def fake_call(system_prompt, user_message, model):
        return "saved analysis", None, {}

    captured = {}

    async def fake_persist(project_id, checkpoint_id, analysis):
        captured.update(
            project_id=project_id,
            checkpoint_id=checkpoint_id,
            analysis=analysis,
        )

    monkeypatch.setattr(roadmap_analysis, "_rag_context", no_rag)
    monkeypatch.setattr(roadmap_analysis, "call_routerai", fake_call)
    monkeypatch.setattr(roadmap_analysis, "_persist_step_analysis", fake_persist)

    result = await roadmap_analysis.analyze_step(
        {**CORE_PASSPORT, "legal": {"entity_type": "ООО"}},
        "legal",
        project_id=42,
    )

    assert result["ok"] is True
    assert captured == {
        "project_id": 42,
        "checkpoint_id": "legal",
        "analysis": "saved analysis",
    }


@pytest.mark.asyncio
async def test_web_configuration_failure_never_becomes_evidence(monkeypatch, roadmap_module):
    roadmap_analysis = roadmap_module
    monkeypatch.setattr(roadmap_analysis, "is_exa_configured", lambda: False)

    context, sources, warning = await roadmap_analysis._web_context("рынок")

    assert context == ""
    assert sources == []
    assert warning


@pytest.mark.asyncio
async def test_search_agent_does_not_return_configuration_errors_as_context(monkeypatch):
    import search_agent

    monkeypatch.setenv("EXA_API_KEY", "")
    monkeypatch.setattr(search_agent, "load_dotenv", lambda: None)

    sources, context = await search_agent.async_search_with_sources("рынок стартапов")

    assert sources == []
    assert context == ""


def test_hypothesis_prompt_does_not_demand_later_stage_metrics(roadmap_module):
    prompt = roadmap_module._overall_system({
        **CORE_PASSPORT,
        "roadmap": {"stage": "hypothesis"},
        "monetization": {"pricing_hypothesis": "Проверить подписку 990 ₽/месяц"},
    })

    assert "Не считай отсутствие продаж, MRR, CAC, churn или LTV недостатком" in prompt
    assert "не как ценовую политику проекта" in prompt


def test_roadmap_context_uses_only_fields_available_at_current_stage(roadmap_module):
    passport = {
        **CORE_PASSPORT,
        "roadmap": {"stage": "hypothesis"},
        "metrics": {"mrr": 120000, "paying_customers": 12},
        "monetization": {"pricing_hypothesis": "Проверить лицензию на семестр"},
    }

    text = roadmap_module._roadmap_text(passport)

    assert "Какую цену хотите проверить: Проверить лицензию на семестр" in text
    assert "MRR, ₽" not in text
    assert "Средняя регулярная выручка" not in text
