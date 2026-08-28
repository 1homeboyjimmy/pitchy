import json

import pytest

import roadmap_analysis


@pytest.mark.asyncio
async def test_step_analysis_uses_main_chat_model(monkeypatch):
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
async def test_overall_analysis_uses_main_chat_model(monkeypatch):
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
async def test_streaming_analysis_uses_main_chat_model(monkeypatch):
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
