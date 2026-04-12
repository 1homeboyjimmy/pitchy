from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List
import os
import re
import logging

# Workaround for pydantic v1 config error in chromadb
os.environ["CHROMA_SERVER_NOFILE"] = "65535"

import chromadb  # noqa: E402
from chromadb.api.models.Collection import Collection  # noqa: E402
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings  # noqa: E402
from langchain_text_splitters import RecursiveCharacterTextSplitter  # noqa: E402

try:  # noqa: E402
    from langfuse.decorators import observe
except Exception as _lf_err:
    import logging as _lf_logging
    _lf_logging.getLogger("langfuse").warning("Langfuse decorators unavailable: %s", _lf_err)
    def observe(**kw):  # noqa: E402
        def _wrap(fn):
            return fn
        return _wrap

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
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""]
    )
    return splitter.split_text(text)


CATEGORIES = [
    "pitching", "grants_and_funds", "unit_economics",
    "target_audience", "legal_and_taxes", "product_management",
    "platform_rules", "general"
]

def _load_documents_by_category() -> dict[str, List[str]]:
    docs_by_cat = {cat: [] for cat in CATEGORIES}
    
    # Load from both sample_docs (bundled) and admin_docs (persistent volume)
    for docs_dir in [DOCS_DIR, ADMIN_DOCS_DIR]:
        if not docs_dir.exists():
            continue
        
        for cat in CATEGORIES:
            cat_dir = docs_dir / cat
            if cat_dir.exists() and cat_dir.is_dir():
                for path in cat_dir.glob("*.txt"):
                    content = path.read_text(encoding="utf-8").strip()
                    if content:
                        docs_by_cat[cat].extend(_chunk_text(content))
                    
        # Also load root .txt into "general"
        for path in docs_dir.glob("*.txt"):
            content = path.read_text(encoding="utf-8").strip()
            if content:
                docs_by_cat["general"].extend(_chunk_text(content))
            
    return docs_by_cat


def _build_client() -> chromadb.ClientAPI:
    if CHROMA_HTTP_HOST:
        return chromadb.HttpClient(host=CHROMA_HTTP_HOST, port=CHROMA_HTTP_PORT)
    return chromadb.PersistentClient(path=DB_DIR)


def _should_reindex() -> bool:
    return os.getenv("CHROMA_REINDEX", "false").lower() == "true"


def _seed_collection(collection: Collection, documents: List[str], batch_size: int = 20):
    """Seed a collection with documents. Uses smaller batches + sleep to respect API rate limits."""
    if not documents:
        return
    import time
    import hashlib
    
    total = len(documents)
    logger.info(f"Starting seeding {total} chunks in batches of {batch_size}...")
    
    for start_idx in range(0, total, batch_size):
        end_idx = min(start_idx + batch_size, total)
        batch_docs = documents[start_idx:end_idx]
        
        ids = []
        for i, doc in enumerate(batch_docs):
            doc_hash = hashlib.md5(doc.encode('utf-8')).hexdigest()[:10]
            ids.append(f"doc_{int(time.time())}_{start_idx + i}_{doc_hash}")
        
        collection.add(documents=batch_docs, ids=ids)
        
        # Sleep between batches to respect RouterAI API rate limits
        if end_idx < total:
            time.sleep(0.5)
            
    logger.info(f"Finished seeding {total} chunks.")


def _rerank_chunks(query: str, entries: List[dict], distances: List[float]) -> List[dict]:
    """Simple reranking based on keyword overlap + distance score."""
    if not entries:
        return []

    query_words = set(re.findall(r'\w{3,}', query.lower()))

    scored = []
    # Deduplicate documents first
    seen = set()
    for entry, dist in zip(entries, distances):
        doc = entry["text"]
        # Skip very short or garbage chunks
        if len(doc.strip()) < 50:
            continue
            
        doc_hash = hash(doc)
        if doc_hash in seen:
            continue
        seen.add(doc_hash)

        doc_words = set(re.findall(r'\w{3,}', doc.lower()))
        overlap = len(query_words & doc_words) / max(len(query_words), 1)
        similarity = max(0, 1 - dist)

        combined = 0.7 * similarity + 0.3 * overlap
        scored.append((entry, combined))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [entry for entry, _ in scored]


@dataclass
class StartupRAG:
    client: chromadb.ClientAPI
    collections: dict[str, Collection]
    embedding_fn: GeminiEmbeddingFunction

    @classmethod
    def build(cls) -> "StartupRAG":
        docs_by_cat = _load_documents_by_category()
        embedding_fn = GeminiEmbeddingFunction()
        client = _build_client()
        reindex = _should_reindex()

        if reindex:
            logger.warning("CHROMA_REINDEX=true — will DELETE and re-create all collections. This costs API tokens!")

        collections = {}
        for cat in CATEGORIES:
            try:
                existing_count = 0
                try:
                    existing_col = client.get_collection(name=cat)
                    existing_count = existing_col.count()
                except Exception:
                    pass  # Collection doesn't exist yet

                if reindex and existing_count > 0:
                    # Delete old collection to avoid dimension mismatch and duplicates
                    logger.info(f"[{cat}] Deleting old collection ({existing_count} chunks) for reindex...")
                    client.delete_collection(name=cat)
                    existing_count = 0

                col = client.get_or_create_collection(
                    name=cat,
                    embedding_function=embedding_fn,
                    metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME}
                )
                collections[cat] = col
                
                # Only seed if collection is truly empty
                if col.count() == 0 and docs_by_cat.get(cat):
                    logger.info(f"[{cat}] Seeding {len(docs_by_cat[cat])} chunks...")
                    _seed_collection(col, docs_by_cat[cat])
                elif col.count() > 0:
                    logger.info(f"[{cat}] Already has {col.count()} chunks, skipping seed.")
            except Exception as e:
                logger.error(f"Failed to load collection '{cat}': {e}")

        return cls(client=client, collections=collections, embedding_fn=embedding_fn)

    def query(self, text: str, categories: List[str] = None, top_k: int = 3) -> List[dict]:
        """Query specific collections and rerank across all of them."""
        if not categories:
            categories = ["general"]
            
        fetch_k = min(top_k * 3, 15)
        query_embedding = self.embedding_fn.encode_query(text)
        
        from concurrent.futures import ThreadPoolExecutor
        
        all_docs = []
        all_distances = []
        
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
                    
                    # Store as tuples to preserve metadata during reranking
                    return [{"text": d, "metadata": m or {}} for d, m in zip(docs, metas)], dists
                except Exception:
                    return [], []
            return [], []

        with ThreadPoolExecutor(max_workers=len(categories)) as executor:
            results = list(executor.map(query_cat, categories))
            for docs, dists in results:
                all_docs.extend(docs)
                all_distances.extend(dists)

        reranked = _rerank_chunks(text, all_docs, all_distances)
        return reranked[:top_k]

    def add_documents(self, documents: List[str], category: str = "general"):
        if not documents or category not in self.collections:
             return
        _seed_collection(self.collections[category], documents)
        logger.info(f"Added {len(documents)} new chunks to {category} collection.")


_RAG_INSTANCE: StartupRAG | None = None


def init_rag() -> None:
    global _RAG_INSTANCE
    _RAG_INSTANCE = StartupRAG.build()


@observe(name="rag_retrieval")
def get_relevant_chunks(text: str, categories: List[str] = None, top_k: int = 3) -> List[dict]:
    if _RAG_INSTANCE is None:
        raise RuntimeError("RAG is not initialized")
    return _RAG_INSTANCE.query(text, categories=categories, top_k=top_k)

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
        # Verify at least one collection is accessible
        if not _RAG_INSTANCE.collections:
            return False
        for coll in _RAG_INSTANCE.collections.values():
            coll.count()
        return True
    except Exception:
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
