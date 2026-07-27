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
