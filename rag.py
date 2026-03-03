from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List
import os
import re

# Workaround for pydantic v1 config error in chromadb
os.environ["CHROMA_SERVER_NOFILE"] = "65535"

import chromadb  # noqa: E402
from chromadb.api.models.Collection import Collection  # noqa: E402
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings  # noqa: E402
from sentence_transformers import SentenceTransformer  # noqa: E402
from langchain_text_splitters import RecursiveCharacterTextSplitter  # noqa: E402


DOCS_DIR = Path(os.getenv("CHROMA_DOCS_DIR", "sample_docs"))
ADMIN_DOCS_DIR = Path(os.getenv("ADMIN_DOCS_DIR", "admin_docs"))
DB_DIR = os.getenv("CHROMA_PERSIST_DIR", "chroma_db")
COLLECTION_NAME = os.getenv("CHROMA_COLLECTION", "startup_docs")
CHROMA_HTTP_HOST = os.getenv("CHROMA_HTTP_HOST")
CHROMA_HTTP_PORT = int(os.getenv("CHROMA_HTTP_PORT", "8000"))

# --- Model Configuration ---
EMBEDDING_MODEL_NAME = "intfloat/multilingual-e5-small"
# Metadata key to track which model was used for embeddings
MODEL_META_KEY = "embedding_model"


class E5EmbeddingFunction(EmbeddingFunction):
    """Embedding function using multilingual-e5-small.
    E5 models require 'query: ' prefix for queries and 'passage: ' for documents.
    """
    def __init__(self):
        print(f"Loading embedding model {EMBEDDING_MODEL_NAME}...")
        self.model = SentenceTransformer(EMBEDDING_MODEL_NAME)

    def __call__(self, input: Documents) -> Embeddings:
        # E5 models expect prefixed input; for ChromaDB add/upsert we use passage prefix
        prefixed = [f"passage: {text}" for text in input]
        embeddings = self.model.encode(prefixed, normalize_embeddings=True)
        return [e.tolist() for e in embeddings]

    def encode_query(self, text: str) -> list[float]:
        """Encode a search query with 'query: ' prefix for better retrieval."""
        embedding = self.model.encode(f"query: {text}", normalize_embeddings=True)
        return embedding.tolist()


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


def _seed_collection(collection: Collection, documents: List[str]):
    if not documents:
        return
    import time
    import hashlib
    ids = []
    for i, doc in enumerate(documents):
        doc_hash = hashlib.md5(doc.encode('utf-8')).hexdigest()[:10]
        ids.append(f"doc_{int(time.time())}_{i}_{doc_hash}")
    collection.add(documents=documents, ids=ids)


def _rerank_chunks(query: str, documents: List[str], distances: List[float]) -> List[str]:
    """Simple reranking based on keyword overlap + distance score."""
    if not documents:
        return []

    query_words = set(re.findall(r'\w{3,}', query.lower()))

    scored = []
    # Deduplicate documents first
    seen = set()
    for doc, dist in zip(documents, distances):
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
        scored.append((doc, combined))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [doc for doc, _ in scored]


@dataclass
class StartupRAG:
    client: chromadb.ClientAPI
    collections: dict[str, Collection]
    embedding_fn: E5EmbeddingFunction

    @classmethod
    def build(cls) -> "StartupRAG":
        docs_by_cat = _load_documents_by_category()
        embedding_fn = E5EmbeddingFunction()
        client = _build_client()

        collections = {}
        for cat in CATEGORIES:
            try:
                # We skip deleting logic here to prevent long delays, 
                # but if re-indexing is on, the user should clear chroma_db folder manually.
                col = client.get_or_create_collection(
                    name=cat,
                    embedding_function=embedding_fn,
                    metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME}
                )
                collections[cat] = col
                
                # Seed if empty or reindex is forced
                if col.count() == 0 or _should_reindex():
                    if docs_by_cat.get(cat):
                        print(f"[{cat}] Seeding {len(docs_by_cat[cat])} chunks...")
                        _seed_collection(col, docs_by_cat[cat])
            except Exception as e:
                print(f"Failed to load collection '{cat}': {e}")

        return cls(client=client, collections=collections, embedding_fn=embedding_fn)

    def query(self, text: str, categories: List[str] = None, top_k: int = 3) -> List[str]:
        """Query specific collections and rerank across all of them."""
        if not categories:
            categories = ["general"]
            
        fetch_k = min(top_k * 3, 15)
        query_embedding = self.embedding_fn.encode_query(text)
        
        all_docs = []
        all_distances = []
        for cat in categories:
             if cat in self.collections:
                 # Check if empty
                 if self.collections[cat].count() == 0:
                     continue
                 try:
                     res = self.collections[cat].query(
                         query_embeddings=[query_embedding],
                         n_results=min(fetch_k, self.collections[cat].count()),
                         include=["documents", "distances"]
                     )
                     all_docs.extend(res.get("documents", [[]])[0])
                     all_distances.extend(res.get("distances", [[]])[0])
                 except Exception:
                     pass

        reranked = _rerank_chunks(text, all_docs, all_distances)
        return reranked[:top_k]

    def add_documents(self, documents: List[str], category: str = "general"):
        if not documents or category not in self.collections:
             return
        _seed_collection(self.collections[category], documents)
        print(f"Added {len(documents)} new chunks to {category} collection.")


_RAG_INSTANCE: StartupRAG | None = None


def init_rag() -> None:
    global _RAG_INSTANCE
    _RAG_INSTANCE = StartupRAG.build()


def get_relevant_chunks(text: str, categories: List[str] = None, top_k: int = 3) -> List[str]:
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
    embedding_fn = E5EmbeddingFunction()
    
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
    print(f"✅ Indexed successful chat interaction {doc_id} into successful_chats")

def search_successful_chats(query: str, top_k: int = 1) -> List[str]:
    """Finds a previously highly-rated similar interaction."""
    client = _build_client()
    embedding_fn = E5EmbeddingFunction()
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
        include=["documents", "distances"]
    )
    
    docs = result.get("documents", [[]])[0]
    distances = result.get("distances", [[]])[0]
    
    # Simple distance threshold (e.g., < 0.25 similarity threshold for highly similar)
    relevant = []
    for doc, dist in zip(docs, distances):
        if dist < 0.35: # Close similarity needed for exact historical matches
            relevant.append(doc)
            
    return relevant
