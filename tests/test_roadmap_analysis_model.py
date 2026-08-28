import importlib
import json
import sys
import types

import pytest


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
    monkeypatch.setattr(roadmap_analysis, "validate_for_analysis", lambda _text: (True, ""))

    async def no_rag(_query):
        return ""

    captured = {}

    async def fake_call(system_prompt, user_message, model):
        captured["model"] = model
        return "step analysis", None, {"total_tokens": 1}

    monkeypatch.setattr(roadmap_analysis, "_rag_context", no_rag)
    monkeypatch.setattr(roadmap_analysis, "call_routerai", fake_call)

    result = await roadmap_analysis.analyze_step(
        {"core": {"name": "Pitchy"}},
        checkpoint_id="problem",
    )

    assert result["analysis"] == "step analysis"
    assert captured["model"] == "provider/main-chat"


@pytest.mark.asyncio
async def test_overall_analysis_uses_main_chat_model(monkeypatch, roadmap_module):
    roadmap_analysis = roadmap_module
    monkeypatch.setenv("MAIN_CHAT_MODEL", "provider/main-chat")

    async def no_rag(_query):
        return ""

    async def no_web(_query, deep=False):
        return "", []

    captured = {}

    async def fake_call(system_prompt, user_message, model):
        captured["model"] = model
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
    monkeypatch.setattr(roadmap_analysis, "validate_for_analysis", lambda _text: (True, ""))

    async def no_rag(_query):
        return ""

    async def no_web(_query, deep=False):
        return "", []

    captured = {}

    async def fake_stream(system_prompt, user_message, model):
        captured["model"] = model
        yield {"__usage__": {"total_tokens": 1}}

    monkeypatch.setattr(roadmap_analysis, "_rag_context", no_rag)
    monkeypatch.setattr(roadmap_analysis, "_web_context", no_web)
    monkeypatch.setattr(roadmap_analysis, "stream_routerai", fake_stream)

    events = [event async for event in roadmap_analysis.stream_overall(
        {"core": {"name": "Pitchy"}},
        project_id=1,
    )]

    payloads = [json.loads(event.removeprefix("data: ")) for event in events]
    assert payloads[-1]["type"] == "done"
    assert captured["model"] == "provider/main-chat"
