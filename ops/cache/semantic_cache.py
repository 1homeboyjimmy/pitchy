import os
import uuid
import asyncio
import logging
from typing import Optional
import chromadb
from chromadb.api.models.Collection import Collection
from rag import GeminiEmbeddingFunction, _build_client, MODEL_META_KEY, EMBEDDING_MODEL_NAME

logger = logging.getLogger("app")

class SemanticCache:
    def __init__(self):
        self.client = _build_client()
        self.embedding_fn = GeminiEmbeddingFunction()
        self.collection_name = "semantic_cache"
        self._collection: Optional[Collection] = None

    def _get_collection(self) -> Collection:
        if self._collection is None:
            self._collection = self.client.get_or_create_collection(
                name=self.collection_name,
                embedding_function=self.embedding_fn,
                metadata={"hnsw:space": "cosine", MODEL_META_KEY: EMBEDDING_MODEL_NAME}
            )
        return self._collection

    async def get(self, query: str, project_id: str, threshold: float = 0.95) -> Optional[str]:
        """
        Проверяет наличие похожего запроса в кэше для данного проекта.
        Использует asyncio.to_thread для неблокирующего вызова ChromaDB.
        """
        try:
            return await asyncio.to_thread(self._sync_get, query, project_id, threshold)
        except Exception as e:
            logger.error(f"SemanticCache.get error: {e}")
            return None

    def _sync_get(self, query: str, project_id: str, threshold: float) -> Optional[str]:
        collection = self._get_collection()
        if collection.count() == 0:
            return None

        # query() возвращает расстояния (distances). Для 'cosine' это 1 - similarity.
        # similarity > 0.95 означает distance < 0.05.
        max_distance = 1.0 - threshold
        
        results = collection.query(
            query_texts=[query],
            n_results=1,
            where={"project_id": project_id},
            include=["documents", "distances"]
        )

        if not results["documents"] or not results["documents"][0]:
            return None

        distance = results["distances"][0][0]
        if distance <= max_distance:
            logger.info(f"Semantic Cache HIT for project {project_id} (dist: {distance:.4f})")
            return results["documents"][0][0]
        
        return None

    async def set(self, query: str, response: str, project_id: str):
        """
        Сохраняет ответ в семантический кэш.
        """
        try:
            await asyncio.to_thread(self._sync_set, query, response, project_id)
        except Exception as e:
            logger.error(f"SemanticCache.set error: {e}")

    def _sync_set(self, query: str, response: str, project_id: str):
        collection = self._get_collection()
        doc_id = f"cache_{uuid.uuid4().hex}"
        collection.add(
            documents=[response],
            metadatas=[{"query": query, "project_id": project_id}],
            ids=[doc_id]
        )
        logger.info(f"Semantic Cache SET for project {project_id}")

# Global instance
semantic_cache = SemanticCache()
