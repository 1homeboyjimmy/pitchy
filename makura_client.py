"""Deprecated compatibility aliases for pre-migration Makura call sites.

New application code must import directly from :mod:`polza_client`.
"""
from __future__ import annotations

from typing import Any

from polza_client import call_polza, stream_polza

_LEGACY_MODEL_IDS = {
    "glm-5": "z-ai/glm-5",
    "glm-4.7": "z-ai/glm-4.7",
    "glm-4.6": "z-ai/glm-4.6",
}


def _legacy_model(model: str | None) -> str | None:
    return _LEGACY_MODEL_IDS.get(model, model)


async def call_makura(
    system_prompt: str,
    user_message: str,
    model: str | None = None,
) -> tuple[str | None, str | None, dict[str, Any]]:
    return await call_polza(system_prompt, user_message, model=_legacy_model(model))


async def stream_makura(
    system_prompt: str | None = None,
    user_message: str | None = None,
    messages: list[dict[str, Any]] | None = None,
    model: str | None = None,
):
    async for item in stream_polza(
        system_prompt=system_prompt,
        user_message=user_message,
        messages=messages,
        model=_legacy_model(model),
    ):
        yield item
