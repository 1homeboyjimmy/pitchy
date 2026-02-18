from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List
import os

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


class SentenceTransformerEmbeddingFunction(EmbeddingFunction):
    def __init__(self, model_name: str = "cointegrated/rubert-tiny2"):
        local_model_path = Path("model_data/rubert-tiny2")
        # Check for the actual weights file, not just directory existence
        weight_file = local_model_path / "pytorch_model.bin"
        
        if local_model_path.exists() and weight_file.exists():
            print(f"Loading local embedding model from {local_model_path}...")
            self.model = SentenceTransformer(str(local_model_path))
        else:
            print(f"Loading embedding model {model_name} from HuggingFace (local weights missing)...")
            self.model = SentenceTransformer(model_name)

    def __call__(self, input: Documents) -> Embeddings:
        embeddings = self.model.encode(input)
        return [e.tolist() for e in embeddings]


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
    # Logic to determine if reindexing is needed.
    # For now, we force reindex if the collection doesn't exist or is empty,
    # or simply always reindex on startup if logic demands.
    # Let's check environment variable or file modification time in a real scenario.
    return True  # Simplifying for this upgrade to ensure new embeddings are used.


def _seed_collection(collection: Collection, documents: List[str]):
    if not documents:
        return
    ids = [f"doc_{i}" for i in range(len(documents))]
    collection.add(documents=documents, ids=ids)


@dataclass
class StartupRAG:
    client: chromadb.ClientAPI
    collection: Collection

    @classmethod
    def build(cls) -> "StartupRAG":
        documents = _load_documents()
        if not documents:
            # Create empty if no docs, instead of erroring, to allow app startup
            pass

        embedding_fn = SentenceTransformerEmbeddingFunction()

        client = _build_client()
        
        # Always recreate collection to apply new embeddings
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
            if documents:
                _seed_collection(collection, documents)
            return cls(client=client, collection=collection)

        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=embedding_fn,
            metadata={"hnsw:space": "cosine"},
        )
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
