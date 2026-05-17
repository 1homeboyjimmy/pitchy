"""LLM-as-reranker for RAG chunks.

Calls Makura with a small/fast model (deepseek-v4-flash by default,
fallback to qwen3-coder / qwen3-32b) to pick the top_k most relevant
chunks for a query. This runs AFTER Chroma's vector retrieval, taking
its top-10 by cosine similarity and returning the top-N that the LLM
judges most useful for actually answering the question.

Failure mode: any error (network, timeout, malformed JSON, no API key)
falls back to the naive top_k slice of the input. The reranker is a
quality enhancer, never a hard dependency.
"""

from __future__ import annotations

import json
import logging
import os

import httpx

logger = logging.getLogger("app.reranker")

MAKURA_API_URL = "https://api.makura.ai/v1/chat/completions"
# Try models in order. First two are fast/cheap and good at JSON;
# qwen3-32b is the heavier safety net.
RERANKER_MODELS = ["deepseek-v4-flash", "qwen3-coder", "qwen3-32b"]
# Cap how much of each chunk we show the reranker so prompt stays cheap.
CHUNK_PREVIEW_CHARS = 400
RERANKER_TIMEOUT = 15.0


async def rerank_chunks(query: str, chunks: list[str], top_k: int = 6) -> list[str]:
    """Return the top_k chunks most relevant to query, in relevance order.

    Args:
        query: User's question / search query.
        chunks: Candidate chunks (e.g. Chroma's top-10 by vector sim).
        top_k: Number to return.

    Returns:
        List of strings — a relevance-ordered subset of `chunks` of size
        at most `top_k`. On any failure, returns `chunks[:top_k]` so the
        caller can keep going.
    """
    if not chunks:
        return []
    if len(chunks) <= top_k:
        return chunks

    api_key = os.getenv("MAKURA_API_KEY", "").strip()
    if not api_key:
        logger.info("Reranker disabled: MAKURA_API_KEY missing")
        return chunks[:top_k]

    # Build the "indexed candidates" prompt. We give compact previews,
    # not full chunks, to keep the prompt small (faster + cheaper).
    candidates = "\n".join(
        f"[{i}] {c[:CHUNK_PREVIEW_CHARS]}" for i, c in enumerate(chunks)
    )
    user_prompt = (
        f"Вопрос пользователя:\n{query}\n\n"
        f"Кандидаты ({len(chunks)} фрагментов):\n{candidates}\n\n"
        f"Выбери {top_k} фрагментов, наиболее полезных для ответа на вопрос. "
        f"Сортируй по убыванию релевантности (самый полезный — первый).\n\n"
        f'Верни СТРОГО JSON: {{"top": [<индексы через запятую>]}}\n'
        f'Пример: {{"top": [3, 0, 7, 1, 5, 8]}}'
    )

    payload_base = {
        "messages": [
            {"role": "system",
             "content": "Ты помощник по релевантности. Отвечаешь ТОЛЬКО валидным JSON, без преамбулы."},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
    }

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=RERANKER_TIMEOUT) as client:
        for model in RERANKER_MODELS:
            try:
                resp = await client.post(
                    MAKURA_API_URL, headers=headers,
                    json={**payload_base, "model": model},
                )
                if resp.status_code != 200:
                    logger.warning(f"Reranker {model}: HTTP {resp.status_code} — {resp.text[:160]}")
                    continue
                content = resp.json()["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                indices = parsed.get("top") if isinstance(parsed, dict) else None
                if not isinstance(indices, list):
                    logger.warning(f"Reranker {model}: 'top' is not a list, got {type(indices).__name__}")
                    continue
                # Validate + dedup + truncate
                seen: set[int] = set()
                ordered_idx: list[int] = []
                for i in indices:
                    if isinstance(i, int) and 0 <= i < len(chunks) and i not in seen:
                        ordered_idx.append(i)
                        seen.add(i)
                    if len(ordered_idx) >= top_k:
                        break
                if not ordered_idx:
                    logger.warning(f"Reranker {model}: no valid indices in response")
                    continue
                result = [chunks[i] for i in ordered_idx]
                logger.info(f"Reranker {model}: picked {len(result)} of {len(chunks)} "
                            f"(order={ordered_idx})")
                return result
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                logger.warning(f"Reranker {model}: network error {type(e).__name__}")
                continue
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                logger.warning(f"Reranker {model}: parse error {type(e).__name__}: {e}")
                continue
            except Exception as e:
                logger.warning(f"Reranker {model}: unexpected {type(e).__name__}: {e}")
                continue

    # Every model failed — degrade gracefully.
    logger.warning(f"All rerankers failed for query={query[:80]!r}, falling back to naive top-{top_k}")
    return chunks[:top_k]
