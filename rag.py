from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List
import os

import chromadb
from chromadb.api.models.Collection import Collection
from sklearn.feature_extraction.text import TfidfVectorizer


DOCS_DIR = Path(os.getenv("CHROMA_DOCS_DIR", "sample_docs"))
DB_DIR = os.getenv("CHROMA_PERSIST_DIR", "chroma_db")
COLLECTION_NAME = os.getenv("CHROMA_COLLECTION", "startup_docs")
CHROMA_HTTP_HOST = os.getenv("CHROMA_HTTP_HOST")
CHROMA_HTTP_PORT = int(os.getenv("CHROMA_HTTP_PORT", "8000"))


class TfidfEmbeddingFunction:
    def __init__(self, vectorizer: TfidfVectorizer):
        self._vectorizer = vectorizer

    def _embed(self, texts: List[str]) -> List[List[float]]:
        matrix = self._vectorizer.transform(texts).toarray()
        return [row for row in matrix]

    def __call__(self, input: List[str]) -> List[List[float]]:
        return self._embed(input)

    def embed_documents(self, input: List[str]) -> List[List[float]]:
        return self._embed(input)

    def embed_query(self, input: List[str]) -> List[List[float]]:
        return self._embed(input)

    def name(self) -> str:
        return "tfidf"


def _chunk_text(text: str, max_chars: int = 600, overlap: int = 80) -> List[str]:
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_chars:
        return [cleaned]
    chunks = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + max_chars)
        chunks.append(cleaned[start:end])
        if end == len(cleaned):
            break
        start = max(0, end - overlap)
    return chunks


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


@dataclass
class StartupRAG:
    client: chromadb.ClientAPI
    collection: Collection

    @classmethod
    def build(cls) -> "StartupRAG":
        documents = _load_documents()
        if not documents:
            raise RuntimeError(f"No documents found in {DOCS_DIR}/")

        vectorizer = TfidfVectorizer()
        vectorizer.fit(documents)
        embedding_fn = TfidfEmbeddingFunction(vectorizer)

        client = _build_client()
        if _should_reindex():
            try:
                client.delete_collection(COLLECTION_NAME)
            except Exception:
                pass
            collection = client.create_collection(
                name=COLLECTION_NAME,
                embedding_function=embedding_fn,
                metadata={"hnsw:space": "cosine"},
            )
            _seed_collection(collection, documents)
            return cls(client=client, collection=collection)

        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=embedding_fn,
            metadata={"hnsw:space": "cosine"},
        )
        if collection.count() == 0:
            _seed_collection(collection, documents)
        return cls(client=client, collection=collection)

    def query(self, text: str, top_k: int = 3) -> List[str]:
        result = self.collection.query(query_texts=[text], n_results=top_k)
        docs = result.get("documents", [[]])[0]
        return [doc for doc in docs if doc]


_RAG_INSTANCE: StartupRAG | None = None


def init_rag() -> None:
    global _RAG_INSTANCE
    _RAG_INSTANCE = StartupRAG.build()


def get_relevant_chunks(text: str, top_k: int = 3) -> List[str]:
    if _RAG_INSTANCE is None:
        raise RuntimeError("RAG is not initialized")
    return _RAG_INSTANCE.query(text, top_k=top_k)


def healthcheck() -> bool:
    if _RAG_INSTANCE is None:
        return False
    try:
        _RAG_INSTANCE.collection.count()
        return True
    except Exception:
        return False


def _build_client():
    if CHROMA_HTTP_HOST:
        return chromadb.HttpClient(host=CHROMA_HTTP_HOST, port=CHROMA_HTTP_PORT)
    return chromadb.PersistentClient(path=DB_DIR)


def _seed_collection(collection: Collection, documents: List[str]) -> None:
    ids = [f"doc_{idx}" for idx in range(len(documents))]
    collection.add(documents=documents, ids=ids)


def _should_reindex() -> bool:
    flag = os.getenv("CHROMA_REINDEX")
    if flag is not None:
        return flag.strip().lower() == "true"
    return os.getenv("APP_ENV", "dev").lower() != "prod"
