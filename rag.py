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


def _load_documents() -> List[str]:
    if not DOCS_DIR.exists():
        return []
    documents: List[str] = []
    for path in DOCS_DIR.glob("*.txt"):
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            continue
        documents.extend(_chunk_text(content))
    return documents


def _build_client() -> chromadb.ClientAPI:
    if CHROMA_HTTP_HOST:
        return chromadb.HttpClient(host=CHROMA_HTTP_HOST, port=CHROMA_HTTP_PORT)
    return chromadb.PersistentClient(path=DB_DIR)


def _should_reindex() -> bool:
    return os.getenv("CHROMA_REINDEX", "false").lower() == "true"


def _seed_collection(collection: Collection, documents: List[str]):
    if not documents:
        return
    ids = [f"doc_{i}" for i in range(len(documents))]
    collection.add(documents=documents, ids=ids)


def _rerank_chunks(query: str, documents: List[str], distances: List[float]) -> List[str]:
    """Simple reranking based on keyword overlap + distance score.
    Returns documents sorted by combined relevance.
    """
    if not documents:
        return []

    query_words = set(re.findall(r'\w{3,}', query.lower()))

    scored = []
    for doc, dist in zip(documents, distances):
        # Skip very short or garbage chunks
        if len(doc.strip()) < 50:
            continue

        doc_words = set(re.findall(r'\w{3,}', doc.lower()))
        # Keyword overlap ratio (0 to 1)
        overlap = len(query_words & doc_words) / max(len(query_words), 1)

        # ChromaDB cosine distance (lower = more similar, range 0-2)
        # Convert to similarity (0 to 1)
        similarity = max(0, 1 - dist)

        # Combined score: 70% embedding similarity + 30% keyword overlap
        combined = 0.7 * similarity + 0.3 * overlap
        scored.append((doc, combined))

    # Sort by combined score descending
    scored.sort(key=lambda x: x[1], reverse=True)
    return [doc for doc, _ in scored]


def _migrate_collection_if_needed(client: chromadb.ClientAPI, embedding_fn: E5EmbeddingFunction) -> Collection:
    """Auto-migrate: if the collection was built with a different model, re-embed all documents.
    Uses a marker file to ensure migration only runs ONCE.
    """
    # Check marker file — if it exists with current model name, skip migration entirely
    marker_path = Path("/tmp/.rag_migration_done")
    if marker_path.exists():
        stored = marker_path.read_text().strip()
        if stored == EMBEDDING_MODEL_NAME:
            return None

    try:
        old_collection = client.get_collection(name=COLLECTION_NAME)
    except Exception:
        # Collection doesn't exist, nothing to migrate
        marker_path.write_text(EMBEDDING_MODEL_NAME)
        return None

    # Check stored model metadata
    meta = old_collection.metadata or {}
    stored_model = meta.get(MODEL_META_KEY)

    # If metadata already matches OR metadata key is present with correct value, skip
    if stored_model == EMBEDDING_MODEL_NAME:
        marker_path.write_text(EMBEDDING_MODEL_NAME)
        return None

    # If metadata key is missing but collection has many documents, 
    # it was likely already migrated — just update metadata, don't delete!
    if stored_model is None and old_collection.count() > 10:
        print(f"[RAG Migration] Collection has {old_collection.count()} docs but no model tag. Tagging as current model (skipping re-embed).")
        # We can't update metadata on existing collection easily in ChromaDB,
        # so just write the marker file to prevent future migration attempts
        marker_path.write_text(EMBEDDING_MODEL_NAME)
        return None

    # Only migrate if explicitly a DIFFERENT model (not just missing metadata)
    if stored_model is not None and stored_model != EMBEDDING_MODEL_NAME:
        print(f"[RAG Migration] Model changed: '{stored_model}' → '{EMBEDDING_MODEL_NAME}'")
        print(f"[RAG Migration] Exporting {old_collection.count()} documents...")

        # Export all documents
        all_data = old_collection.get(include=["documents"])
        all_docs = all_data.get("documents", [])
        all_ids = all_data.get("ids", [])

        if not all_docs:
            print("[RAG Migration] No documents to migrate.")
            client.delete_collection(COLLECTION_NAME)
            marker_path.write_text(EMBEDDING_MODEL_NAME)
            return None

        print(f"[RAG Migration] Exported {len(all_docs)} chunks. Recreating collection...")

        # Delete old collection
        client.delete_collection(COLLECTION_NAME)

        # Create new collection with new embedding function
        new_collection = client.create_collection(
            name=COLLECTION_NAME,
            embedding_function=embedding_fn,
            metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME},
        )

        # Re-add documents in batches
        batch_size = 100
        for i in range(0, len(all_docs), batch_size):
            batch_docs = all_docs[i:i + batch_size]
            batch_ids = all_ids[i:i + batch_size]
            new_collection.add(documents=batch_docs, ids=batch_ids)
            print(f"[RAG Migration] Re-embedded {min(i + batch_size, len(all_docs))}/{len(all_docs)} chunks...")

        print(f"[RAG Migration] ✅ Migration complete! {len(all_docs)} chunks re-embedded.")
        marker_path.write_text(EMBEDDING_MODEL_NAME)
        return new_collection

    # Default: no migration needed
    marker_path.write_text(EMBEDDING_MODEL_NAME)
    return None


@dataclass
class StartupRAG:
    client: chromadb.ClientAPI
    collection: Collection
    embedding_fn: E5EmbeddingFunction

    @classmethod
    def build(cls) -> "StartupRAG":
        documents = _load_documents()

        embedding_fn = E5EmbeddingFunction()
        client = _build_client()

        # Check if migration is needed (model changed)
        migrated = _migrate_collection_if_needed(client, embedding_fn)
        if migrated:
            return cls(client=client, collection=migrated, embedding_fn=embedding_fn)

        # Always recreate collection to apply new embeddings
        if _should_reindex():
            try:
                client.delete_collection(COLLECTION_NAME)
            except Exception:
                pass
            collection = client.create_collection(
                name=COLLECTION_NAME,
                embedding_function=embedding_fn,
                metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME},
            )
            if documents:
                _seed_collection(collection, documents)
            return cls(client=client, collection=collection, embedding_fn=embedding_fn)

        # Try to get existing collection first
        try:
            collection = client.get_collection(
                name=COLLECTION_NAME,
                embedding_function=embedding_fn,
            )
            # If it's empty and we have docs, seed it anyway
            if documents and collection.count() == 0:
                print(f"Collection {COLLECTION_NAME} is empty, seeding...")
                _seed_collection(collection, documents)
        except Exception:
            # Create if doesn't exist
            collection = client.create_collection(
                name=COLLECTION_NAME,
                embedding_function=embedding_fn,
                metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME},
            )
            if documents:
                _seed_collection(collection, documents)

        return cls(client=client, collection=collection, embedding_fn=embedding_fn)

    def query(self, text: str, top_k: int = 3) -> List[str]:
        """Query with E5 query prefix and reranking."""
        # Fetch more candidates for reranking
        fetch_k = min(top_k * 3, 15)
        query_embedding = self.embedding_fn.encode_query(text)
        result = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=fetch_k,
            include=["documents", "distances"],
        )
        docs = result.get("documents", [[]])[0]
        distances = result.get("distances", [[]])[0]

        # Rerank and return top_k
        reranked = _rerank_chunks(text, docs, distances)
        return reranked[:top_k]

    def add_documents(self, documents: List[str]):
        if not documents:
            return

        # We need unique IDs. Simplest way is a hash or timestamp + index.
        import time
        import hashlib

        ids = []
        for doc in documents:
            doc_hash = hashlib.md5(doc.encode('utf-8')).hexdigest()[:10]
            ids.append(f"doc_{int(time.time())}_{doc_hash}")

        self.collection.add(documents=documents, ids=ids)
        print(f"Added {len(documents)} new chunks to RAG collection.")


_RAG_INSTANCE: StartupRAG | None = None


def init_rag() -> None:
    global _RAG_INSTANCE
    _RAG_INSTANCE = StartupRAG.build()


def get_relevant_chunks(text: str, top_k: int = 3) -> List[str]:
    if _RAG_INSTANCE is None:
        raise RuntimeError("RAG is not initialized")
    return _RAG_INSTANCE.query(text, top_k=top_k)

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
        _RAG_INSTANCE.collection.count()
        return True
    except Exception:
        return False
