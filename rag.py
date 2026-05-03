from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict
import os
import asyncio
import re
import logging
from datetime import datetime

# Workaround for pydantic v1 config error in chromadb
os.environ["CHROMA_SERVER_NOFILE"] = "65535"

import chromadb  # noqa: E402
from chromadb.api.models.Collection import Collection  # noqa: E402
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings  # noqa: E402
from langchain_text_splitters import RecursiveCharacterTextSplitter  # noqa: E402
from slm_dispatcher import slm_dispatcher  # noqa: E402

try:  # noqa: E402
    from langfuse.decorators import observe, langfuse_context
except Exception as _lf_err:
    import logging as _lf_logging
    _lf_logging.getLogger("langfuse").warning("Langfuse decorators unavailable: %s", _lf_err)
    def observe(**kw):  # noqa: E402
        def _wrap(fn):
            return fn
        return _wrap
    langfuse_context = None

logger = logging.getLogger("rag")

DOCS_DIR = Path(os.getenv("CHROMA_DOCS_DIR", "sample_docs"))
ADMIN_DOCS_DIR = Path(os.getenv("ADMIN_DOCS_DIR", "admin_docs"))
DB_DIR = os.getenv("CHROMA_PERSIST_DIR", "chroma_db")
COLLECTION_NAME = os.getenv("CHROMA_COLLECTION", "startup_docs")
CHROMA_HTTP_HOST = os.getenv("CHROMA_HTTP_HOST")
CHROMA_HTTP_PORT = int(os.getenv("CHROMA_HTTP_PORT", "8000"))

# --- Model Configuration ---
EMBEDDING_MODEL_NAME = "google/gemini-embedding-001"
EMBEDDING_API_BASE = "https://routerai.ru/api/v1"
# Metadata key to track which model was used for embeddings
MODEL_META_KEY = "embedding_model"


class GeminiEmbeddingFunction(EmbeddingFunction):
    """Embedding function using Google Gemini Embedding via RouterAI API.
    Uses OpenAI-compatible /v1/embeddings endpoint.
    """
    def __init__(self):
        from openai import OpenAI
        api_key = os.getenv("ROUTERAI_API_KEY", "")
        if not api_key:
            logger.warning("ROUTERAI_API_KEY not set — embeddings will fail")
        self._client = OpenAI(
            api_key=api_key,
            base_url=EMBEDDING_API_BASE,
        )
        self._model = EMBEDDING_MODEL_NAME

    def __call__(self, input: Documents) -> Embeddings:
        """Embed a batch of documents. Batches in groups of 20 to stay within API limits."""
        all_embeddings: Embeddings = []
        batch_size = 20
        for start in range(0, len(input), batch_size):
            batch = input[start:start + batch_size]
            try:
                response = self._client.embeddings.create(
                    model=self._model,
                    input=batch,
                    encoding_format="float",
                )
                all_embeddings.extend([item.embedding for item in response.data])
            except Exception as e:
                logger.error(f"Embedding API error (batch {start}–{start+len(batch)}): {e}")
                # Return zero vectors so ChromaDB doesn't crash; data quality will be poor
                dim = 3072
                all_embeddings.extend([[0.0] * dim for _ in batch])
        return all_embeddings

    def encode_query(self, text: str) -> list[float]:
        """Encode a single search query."""
        try:
            response = self._client.embeddings.create(
                model=self._model,
                input=text,
                encoding_format="float",
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Embedding API error (query): {e}")
            return [0.0] * 3072


def _chunk_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> List[str]:
    # Strip HTML tags to prevent XSS/injection into RAG
    from bs4 import BeautifulSoup
    try:
        text = BeautifulSoup(text, "html.parser").get_text(separator=' ')
    except Exception:
        pass
    # Convert multiple spaces to single
    text = re.sub(r'\s+', ' ', text).strip()
    
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""]
    )
    return splitter.split_text(text)


def _seed_collection(collection: Collection, documents: List[str], source: str = "manual_upload"):
    """Helper to add documents to a collection with automatic ID generation and metadata."""
    import hashlib
    import time
    if not documents:
        return
        
    ids = []
    metadatas = []
    for doc in documents:
        # Generate unique ID based on content hash and timestamp
        doc_id = f"seed_{int(time.time())}_{hashlib.md5(doc.encode()).hexdigest()[:8]}"
        ids.append(doc_id)
        metadatas.append({
            "source": source,
            "ingested_at": datetime.now().isoformat(),
            MODEL_META_KEY: EMBEDDING_MODEL_NAME
        })
        # Small sleep to ensure unique timestamps if needed, though hash should be enough
    
    collection.add(
        documents=documents,
        ids=ids,
        metadatas=metadatas
    )


# Isolated Semantic Buckets
CATEGORIES = [
    "market_analysis",   # Рынки, конкуренты, проблемы и решения
    "target_audience",   # ЦА, сегменты, CustDev
    "unit_economics",    # Новая база: финмодели, метрики CAC/LTV, формулы
    "pitching_tips",     # Структуры презентаций, выступления
    "grants_and_funds",  # Акселераторы, фонды, гранты
    "legal_regulations", # Законы, налоги, оферты
    "platform_manual",   # Вместо general: инструкции по платформе Pitchy и Интерактивной дорожной карте
]

def _is_junk_chunk(text: str) -> bool:
    """Heuristic check to identify low-value or junk chunks."""
    if len(text.strip()) < 80:
        return True # Too short to have meaningful context
    
    # Check for excessive link/handle density (likely just a contact list)
    link_patterns = [r't\.me/', r'http', r'@[\w_]+', r'\+\d{10,15}']
    matches = sum(1 for p in link_patterns if re.search(p, text))
    if matches >= 3 and len(text) < 300:
        return True
        
    # Check for legal boilerplate without context
    boilerplate = ["6.2.2", "7.1.3", "privacy policy", "terms of service", "права третьих лиц"]
    if any(b in text.lower() for b in boilerplate) and len(text) < 200:
        return True

    # Check for networking/spam
    spam_words = ["ищу партнерства", "коллабы", "набираю людей", "вакансия", "прожарка"]
    if any(s in text.lower() for s in spam_words):
        return True
        
    return False

def _preprocess_chunk(text: str, category: str) -> str:
    """Injects semantic context tags to increase separation in vector space."""
    tags = {
        "market_analysis": "[КОНТЕКСТ: АНАЛИЗ РЫНКА / ТРЕНДЫ]",
        "target_audience": "[КОНТЕКСТ: ЦЕЛЕВАЯ АУДИТОРИЯ / CUSTDEV]",
        "unit_economics": "[КОНТЕКСТ: ЮНИТ ЭКОНОМИКА / МЕТРИКИ]",
        "pitching_tips": "[КОНТЕКСТ: МЕТОДОЛОГИЯ / ПИТЧИНГ]",
        "grants_and_funds": "[КОНТЕКСТ: ГРАНТЫ / ФОНДЫ / АКСЕЛЕРАТОРЫ]",
        "legal_regulations": "[КОНТЕКСТ: ЗАКОНОДАТЕЛЬСТВО / ПРАВО]",
        "platform_manual": "[КОНТЕКСТ: ИНСТРУКЦИИ ПЛАТФОРМЫ]",
    }
    tag = tags.get(category, "[КОНТЕКСТ: ОБЩЕЕ]")
    return f"{tag}\n{text}"

def resolve_routing_intent(query: str) -> List[str]:
    """Determines which collections to search based on keywords in user query."""
    q = query.lower()
    intents = {
        "legal_regulations": ["налог", "закон", "оферта", "юрист", "договор", "право", "regulation", "tax", "law"],
        "pitching_tips": ["питч", "презентация", "инвестор", "выступление", "pitch", "deck"],
        "market_analysis": ["рынок", "объем", "тренд", "анализ", "конкурент", "market", "size", "trend", "analysis"],
        "target_audience": ["ца", "аудитория", "кастдев", "custdev", "сегмент", "интервью", "b2b", "b2c"],
        "unit_economics": ["юнит", "экономика", "cac", "ltv", "роялти", "pnl", "excel", "метрики", "финанс"],
        "grants_and_funds": ["грант", "фонд", "фси", "акселератор", "инвестиции", "субсидия", "инвестор"],
        "platform_manual": ["pitchy", "платформа", "инструкция", "как", "вопрос", "дорожн", "карта"]
    }
    
    selected = set()
    for cat, keywords in intents.items():
        if any(k in q for k in keywords):
            selected.add(cat)
            
    if not selected:
        return ["platform_manual", "market_analysis"]
    return list(selected)

def _load_raw_documents() -> List[Dict[str, str]]:
    """Loads all raw documents from admin and sample directories without category assumptions."""
    raw_docs = []
    # Load from both sample_docs (bundled) and admin_docs (persistent volume)
    for docs_dir in [DOCS_DIR, ADMIN_DOCS_DIR]:
        if not docs_dir.exists():
            continue
        
        # Scan all .txt recursively
        for path in docs_dir.rglob("*.txt"):
            try:
                content = path.read_text(encoding="utf-8").strip()
                if content:
                    raw_docs.append({"content": content, "source": path.name})
            except Exception as e:
                logger.error(f"Failed to read {path}: {e}")
            
    return raw_docs


def _build_client() -> chromadb.ClientAPI:
    if CHROMA_HTTP_HOST:
        return chromadb.HttpClient(host=CHROMA_HTTP_HOST, port=CHROMA_HTTP_PORT)
    return chromadb.PersistentClient(path=DB_DIR)


def _should_reindex() -> bool:
    return os.getenv("CHROMA_REINDEX", "false").lower() == "true"


@observe(name="smart_ingest_batch", capture_input=False)
async def _smart_ingest_batch(rag_instance: "StartupRAG", chunks: List[str], source: str):
    """Classifies and distributes a batch of chunks into the correct RAG collections."""
    if not chunks:
        return

    # 1. SLM Classification
    categories = await slm_dispatcher.classify_chunks_batch(chunks)
    
    # 2. Distribute based on classification
    for chunk, cat in zip(chunks, categories):
        if cat == "junk" or _is_junk_chunk(chunk):
            continue
            
        target_cat = cat if cat in CATEGORIES else "platform_manual"
        
        # 3. Add to collection
        if target_cat in rag_instance.collections:
            processed_text = _preprocess_chunk(chunk, target_cat)
            import hashlib
            import time
            doc_id = f"{target_cat}_{int(time.time())}_{hashlib.md5(chunk.encode()).hexdigest()[:8]}"
            
            rag_instance.collections[target_cat].add(
                documents=[processed_text],
                ids=[doc_id],
                metadatas=[{
                    "source": source,
                    "category": target_cat,
                    "ingested_at": datetime.now().isoformat(),
                    MODEL_META_KEY: EMBEDDING_MODEL_NAME
                }]
            )


@observe(name="Reranker")
def _rerank_chunks(query: str, entries: List[dict], distances: List[float]) -> List[dict]:
    """Reranking using Jina AI Reranker API with fallback to distance score."""
    if not entries:
        return []

    logger.info(f"Starting rerank for {len(entries)} chunks")

    # Dedup and filter
    seen = set()
    filtered_entries = []
    filtered_distances = []
    
    for entry, dist in zip(entries, distances):
        doc = entry["text"]
        if len(doc.strip()) < 50:
            continue
        doc_hash = hash(doc)
        if doc_hash in seen:
            continue
        seen.add(doc_hash)
        filtered_entries.append(entry)
        filtered_distances.append(dist)
        
    if not filtered_entries:
        return []

    if langfuse_context:
        langfuse_context.update_current_observation(
            metadata={
                "total_chunks_before": len(entries),
                "total_chunks_after": len(filtered_entries)
            }
        )

    jina_api_key = os.getenv("JINA_API_KEY")
    if jina_api_key:
        return _jina_rerank_internal(query, filtered_entries, jina_api_key)
    
    return _fallback_rerank(query, filtered_entries, filtered_distances)

@observe(name="jina_reranker")
def _jina_rerank_internal(query: str, filtered_entries: List[dict], api_key: str) -> List[dict]:
    try:
        import requests
        url = "https://api.jina.ai/v1/rerank"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        payload = {
            "model": "jina-reranker-v2-base-multilingual",
            "query": query,
            "documents": [e["text"] for e in filtered_entries],
            "top_n": len(filtered_entries)
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=5.0)
        response.raise_for_status()
        res_results = response.json().get("results", [])
        res_results.sort(key=lambda x: x["relevance_score"], reverse=True)
        
        reranked = []
        for r in res_results:
            entry = filtered_entries[r["index"]]
            entry["score"] = r["relevance_score"]
            reranked.append(entry)
        
        logger.info(f"Successfully reranked {len(reranked)} chunks using Jina AI.")
        return reranked
    except Exception as e:
        logger.error(f"Jina reranker API failed: {e}")
        return []

def _fallback_rerank(query, entries, distances):
    scored = []
    query_words = set(re.findall(r'\w{3,}', query.lower()))
    for entry, dist in zip(entries, distances):
        doc = entry["text"]
        doc_words = set(re.findall(r'\w{3,}', doc.lower()))
        overlap = len(query_words & doc_words) / max(len(query_words), 1)
        similarity = max(0, 1 - dist)
        combined = 0.9 * similarity + 0.1 * overlap
        scored.append((entry, combined))

    scored.sort(key=lambda x: x[1], reverse=True)
    
    for entry, score in scored:
        entry["score"] = score
        
    return [entry for entry, _ in scored]


@dataclass
class StartupRAG:
    client: chromadb.ClientAPI
    collections: dict[str, Collection]
    embedding_fn: GeminiEmbeddingFunction

    @classmethod
    async def build_async(cls) -> "StartupRAG":
        """
        Initializes the RAG system.
        """
        instance = await cls._actually_build()
        # Log success separately to avoid serialization error of StartupRAG object
        cls._log_init_success(len(instance.collections))
        return instance

    @staticmethod
    @observe(name="init_rag_pipeline")
    def _log_init_success(count: int) -> str:
        return f"RAG Pipeline Initialized with {count} collections"

    @classmethod
    async def _actually_build(cls) -> "StartupRAG":
        raw_docs = _load_raw_documents()
        embedding_fn = GeminiEmbeddingFunction()
        client = _build_client()
        reindex = _should_reindex()

        if reindex:
            logger.warning("CHROMA_REINDEX=true — will DELETE and re-create all collections.")

        collections = {}
        for cat in CATEGORIES:
            try:
                if reindex:
                    try:
                        client.delete_collection(name=cat)
                    except:
                        pass
                
                col = client.get_or_create_collection(
                    name=cat,
                    embedding_function=embedding_fn,
                    metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME}
                )
                
                # Critical check: verify model match to avoid Dimension Mismatch crashes
                if col.count() > 0:
                    peek = col.peek(limit=1)
                    if peek['metadatas'] and peek['metadatas'][0].get(MODEL_META_KEY) != EMBEDDING_MODEL_NAME:
                        logger.warning(f"Collection '{cat}' has incompatible model embeddings. Wiping for safety.")
                        client.delete_collection(name=cat)
                        import time
                        time.sleep(0.5) # Give OS time to release file descriptors
                        col = client.get_or_create_collection(
                            name=cat,
                            embedding_function=embedding_fn,
                            metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME}
                        )
                
                collections[cat] = col
            except Exception as e:
                logger.error(f"Failed to load collection '{cat}': {e}")

        instance = cls(client=client, collections=collections, embedding_fn=embedding_fn)
        
        if reindex and raw_docs:
            logger.info(f"Starting SMART INGESTION for {len(raw_docs)} documents...")
            for doc_entry in raw_docs:
                chunks = _chunk_text(doc_entry["content"])
                # Process chunks in batches of 10 to SLM
                batch_size = 10
                for i in range(0, len(chunks), batch_size):
                    batch = chunks[i:i+batch_size]
                    await _smart_ingest_batch(instance, batch, source=doc_entry["source"])
            logger.info("SMART INGESTION complete.")

        return instance

    @observe(name="RAG Search")
    def search(self, text: str, categories: List[str] = None, top_k: int = 3) -> List[dict]:
        """Synchronous query for backward compatibility. Use asearch for async environments."""
        if not categories:
            categories = resolve_routing_intent(text)
            
        fetch_k = min(top_k * 4, 20)
        query_embedding = self.embedding_fn.encode_query(text)
        
        all_docs = []
        all_distances = []
        
        from concurrent.futures import ThreadPoolExecutor
        
        def query_cat(cat):
            if cat in self.collections:
                if self.collections[cat].count() == 0:
                    return [], []
                try:
                    res = self.collections[cat].query(
                        query_embeddings=[query_embedding],
                        n_results=min(fetch_k, self.collections[cat].count()),
                        include=["documents", "distances", "metadatas"]
                    )
                    docs = res.get("documents", [[]])[0]
                    dists = res.get("distances", [[]])[0]
                    metas = res.get("metadatas", [[]])[0]
                    
                    return [{"text": d, "metadata": m or {}} for d, m in zip(docs, metas)], dists
                except Exception:
                    return [], []
            return [], []

        with ThreadPoolExecutor(max_workers=len(categories)) as executor:
            results = list(executor.map(query_cat, categories))
            for docs, dists in results:
                all_docs.extend(docs)
                all_distances.extend(dists)

        if langfuse_context:
            langfuse_context.update_current_observation(
                metadata={"total_hits": len(all_docs), "categories": categories}
            )

        reranked = _rerank_chunks(text, all_docs, all_distances)
        return reranked[:top_k]

    async def _query_single_collection(self, collection, query_embedding, fetch_k):
        if collection.count() == 0:
            return [], []
        try:
            res = await asyncio.to_thread(
                collection.query,
                query_embeddings=[query_embedding],
                n_results=min(fetch_k, collection.count()),
                include=["documents", "distances", "metadatas"]
            )
            docs = res.get("documents", [[]])[0]
            dists = res.get("distances", [[]])[0]
            metas = res.get("metadatas", [[]])[0]
            return [{"text": d, "metadata": m or {}} for d, m in zip(docs, metas)], dists
        except Exception as e:
            logger.error(f"RAG _query_single_collection error: {e}")
            return [], []

    async def asearch(self, text: str, categories: List[str] = None, top_k: int = 3, parent_trace=None) -> List[dict]:
        """Asynchronous search using asyncio.gather for non-blocking I/O."""
        total_docs = sum(c.count() for c in self.collections.values())
        if total_docs == 0:
            logger.warning("RAG Health: All collections are empty. Fast-path exit.")
            return []
            
        span = None
        if parent_trace:
            span = parent_trace.span(name="RAG Search", input=text)
            
        try:
            if not categories:
                categories = resolve_routing_intent(text)
                logger.info(f"Routed intent to collections: {categories}")
                
            fetch_k = min(top_k * 4, 20)
            query_embedding = await asyncio.to_thread(self.embedding_fn.encode_query, text)
            
            tasks = []
            for cat in categories:
                if cat in self.collections:
                    tasks.append(self._query_single_collection(self.collections[cat], query_embedding, fetch_k))
                    
            if not tasks:
                if span: span.end(output=[])
                return []
                
            results = await asyncio.gather(*tasks)
            
            all_docs = []
            all_distances = []
            for docs, dists in results:
                all_docs.extend(docs)
                all_distances.extend(dists)

            if span:
                span.update(metadata={"total_hits": len(all_docs), "categories": categories})

            reranked = await asyncio.to_thread(_rerank_chunks, text, all_docs, all_distances)
            results_out = reranked[:top_k]
            
            if span:
                span.end(output=results_out)
            return results_out
        except Exception as e:
            if span:
                span.end(level="ERROR", statusMessage=str(e))
            raise e

    def query(self, text: str, categories: List[str] = None, top_k: int = 3) -> List[dict]:
        """Backward compatibility for query()."""
        return self.search(text, categories, top_k)
        
    async def aquery(self, text: str, categories: List[str] = None, top_k: int = 3, parent_trace=None) -> List[dict]:
        return await self.asearch(text, categories, top_k, parent_trace)

    def add_documents(self, documents: List[str], category: str = "platform_manual"):
        if not documents or category not in self.collections:
             return
        _seed_collection(self.collections[category], documents)
        logger.info(f"Added {len(documents)} new chunks to {category} collection.")


_RAG_INSTANCE: StartupRAG | None = None


async def init_rag() -> None:
    global _RAG_INSTANCE
    _RAG_INSTANCE = await StartupRAG.build_async()


@observe(name="rag_retrieval")
def get_relevant_chunks(text: str, categories: List[str] = None, top_k: int = 3) -> List[dict]:
    if _RAG_INSTANCE is None:
        raise RuntimeError("RAG is not initialized")
    return _RAG_INSTANCE.query(text, categories=categories, top_k=top_k)

async def aget_relevant_chunks(text: str, categories: List[str] = None, top_k: int = 3, parent_trace=None) -> List[dict]:
    if _RAG_INSTANCE is None:
        raise RuntimeError("RAG is not initialized")
    return await _RAG_INSTANCE.aquery(text, categories=categories, top_k=top_k, parent_trace=parent_trace)

def add_text_to_rag(text: str) -> int:
    if _RAG_INSTANCE is None:
        raise RuntimeError("RAG is not initialized")
    chunks = _chunk_text(text)
    if chunks:
        _RAG_INSTANCE.add_documents(chunks)
    return len(chunks)

def healthcheck() -> bool:
    if _RAG_INSTANCE is None:
        return False
    try:
        if not _RAG_INSTANCE.collections:
            return False
        total_docs = 0
        for cat, coll in _RAG_INSTANCE.collections.items():
            count = coll.count()
            total_docs += count
            # logger.info(f"RAG Health: {cat} collection has {count} records.")
        
        if total_docs == 0:
            logger.warning("RAG Health: All collections are empty.")
            
        return True
    except Exception as e:
        logger.warning(f"RAG healthcheck failed: {e}")
        return False

def index_successful_chat_interaction(user_query: str, ai_response: str, message_id: int):
    """Saves a highly-rated chat pair into the successful_chats collection for future RAG usage."""
    client = _build_client()
    embedding_fn = GeminiEmbeddingFunction()
    
    collection = client.get_or_create_collection(
        name="successful_chats",
        embedding_function=embedding_fn,
        metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME}
    )
    
    text_content = f"Вопрос пользователя: {user_query}\n\nЭталонный ответ: {ai_response}"
    doc_id = f"feedback_msg_{message_id}"
    
    collection.upsert(
        documents=[text_content],
        ids=[doc_id]
    )
    logger.info(f"Indexed successful chat interaction {doc_id} into successful_chats")

def search_successful_chats(query: str, top_k: int = 1) -> List[dict]:
    """Finds a previously highly-rated similar interaction."""
    client = _build_client()
    embedding_fn = GeminiEmbeddingFunction()
    try:
        collection = client.get_collection(
            name="successful_chats",
            embedding_function=embedding_fn
        )
    except Exception:
        return []
    
    if collection.count() == 0:
        return []
        
    query_embedding = embedding_fn.encode_query(query)
    result = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=["documents", "distances", "metadatas"]
    )
    
    docs = result.get("documents", [[]])[0]
    distances = result.get("distances", [[]])[0]
    metas = result.get("metadatas", [[]])[0]
    
    # Simple distance threshold for highly similar matches
    relevant = []
    for doc, dist, meta in zip(docs, distances, metas):
        if dist < 0.35:
            relevant.append({"text": doc, "metadata": meta or {}})
            
    return relevant

async def asearch_successful_chats(query: str, top_k: int = 1) -> List[dict]:
    """Finds a previously highly-rated similar interaction asynchronously."""
    client = _build_client()
    embedding_fn = GeminiEmbeddingFunction()
    try:
        collection = client.get_collection(
            name="successful_chats",
            embedding_function=embedding_fn
        )
    except Exception:
        return []
    
    if collection.count() == 0:
        return []
        
    query_embedding = await asyncio.to_thread(embedding_fn.encode_query, query)
    
    try:
        result = await asyncio.to_thread(
            collection.query,
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=["documents", "distances", "metadatas"]
        )
    except Exception as e:
        logger.error(f"Error querying successful_chats: {e}")
        return []
    
    docs = result.get("documents", [[]])[0]
    distances = result.get("distances", [[]])[0]
    metas = result.get("metadatas", [[]])[0]
    
    # Simple distance threshold for highly similar matches
    relevant = []
    for doc, dist, meta in zip(docs, distances, metas):
        if dist < 0.35:
            relevant.append({"text": doc, "metadata": meta or {}})
            
    return relevant
