# AI pipeline and provider ownership

This document describes the active provider boundaries in Pitchy. `polza_client.py` owns chat completions and streaming. `routerai_client.py` owns only the dedicated rerank API. `makura_client.py` is a legacy compatibility wrapper and should not be used by new application code.

## Main chat (`main.send_chat_message`)

| Stage | Responsibility | Implementation / model |
|---|---|---|
| Semantic cache | Return a matching prior answer when safe | Cache embeddings use `qwen/qwen3-embedding-4b` through Polza |
| Intent and category routing | Select knowledge categories, answer mode, finance flag, and whether fresh web data is needed | `SLMClient` on `qwen/qwen3-32b` through Polza; deterministic heuristics refine the answer mode |
| Local knowledge retrieval | Find relevant internal Pitchy/project material | Chroma vector search using Qwen3 Embedding 4B query vectors |
| Web search decision | Force current information for explicit deep research, classifier decision, freshness triggers, or factual questions | Decision belongs to routing logic; the LLM does not fetch web pages itself |
| Web search and source extraction | Find current external sources and return snippets/source metadata | Exa Search API via `search_agent.py`, with configured HTTPS proxy when needed |
| RAG rerank | Reorder local retrieved chunks by query relevance | `cohere/rerank-v3.5` through RouterAI's `/api/v1/rerank` endpoint |
| Analytical swarm | Extract structured project evidence from RAG/web context for review requests | `qwen/qwen3-32b` through Polza; skipped for simple fact and consult modes |
| Context assembly | Combine project memory, local RAG, web evidence, and optional swarm facts | `chat_pipeline.build_evidence_context` |
| Final response | Synthesize and stream the answer | `openai/gpt-6-luna-pro` through Polza |

The older chat entry points and `ChatOrchestrator` use the same provider split: Polza generates/classifies, Exa searches the web, and RouterAI is only the specialized reranker. They have separate routing code and should be regression-checked individually when changed.

## Deep research (`research_service.run_research_job`)

| Stage | Owner |
|---|---|
| Plan research questions | Qwen3-32B on Polza |
| Search each direction in parallel | Exa Search API (`research_search_documents`) |
| Rank source documents | Cohere Rerank v3.5 on RouterAI's dedicated endpoint |
| Extract claims | Qwen3-32B on Polza; GPT-6 Luna Pro fallback |
| Independently verify claims | Kimi K2.6 on Polza |
| Build brief, write sections, critique final report | GPT-6 Luna Pro on Polza |

## Smart Roadmap analysis

`roadmap_analysis.py` builds project/RAG context, invokes Exa when current external evidence is needed, and uses the configured main-chat model (`MAIN_CHAT_MODEL`, default GPT-6 Luna Pro on Polza) to analyze and stream results. Structured roadmap edit extraction in `llm_client.py` uses Qwen3-32B through Polza.

Other structured application flows are also assigned explicitly to Polza: export intent classification uses Qwen3-32B, and accelerator project audits default to GPT-6 Luna Pro. Grant generation, tree/roadmap generation, attachment parsing, and presentation fallback call the shared Polza client. No active application LLM call site selects RouterAI or Makura.

## Required provider secrets

- `POLZA_API_KEY` for LLM calls and embeddings.
- `ROUTERAI_API_KEY` for the Cohere reranker only.
- `EXA_API_KEY` for web search.

Changing the embedding model requires rebuilding existing Chroma collections so document and query vectors share one embedding space.
