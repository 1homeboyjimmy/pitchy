import os
import uuid
import asyncio
import logging
import json
import numpy as np
from typing import Optional

import redis
from redis.commands.search.field import TextField, VectorField, TagField
from redis.commands.search.indexDefinition import IndexDefinition, IndexType
from redis.commands.search.query import Query
from redis.exceptions import ResponseError

from rag import GeminiEmbeddingFunction

logger = logging.getLogger("app")

class SemanticCache:
    def __init__(self):
        self.embedding_fn = GeminiEmbeddingFunction()
        self.index_name = "idx:semantic_cache"
        self.prefix = "semantic_cache:"
        self.ttl_seconds = 300  # 5 minutes
        
        # We create a separate client without decode_responses=True for safe raw bytes vector operations
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        self.client = redis.Redis.from_url(redis_url, decode_responses=False)
        self._setup_index()

    def _setup_index(self):
        try:
            try:
                self.client.ft(self.index_name).info()
                logger.info(f"RediSearch index {self.index_name} already exists.")
            except ResponseError as e:
                # Often raised if index doesn't exist
                if "Unknown Index name" in str(e):
                    schema = [
                        TagField("project_id"),
                        TextField("query"),
                        TextField("response"),
                        VectorField("query_vector", "FLAT", {
                            "TYPE": "FLOAT32",
                            "DIM": 3072,
                            "DISTANCE_METRIC": "COSINE"
                        })
                    ]
                    definition = IndexDefinition(prefix=[self.prefix], index_type=IndexType.HASH)
                    self.client.ft(self.index_name).create_index(schema, definition=definition)
                    logger.info(f"Created RediSearch index {self.index_name}")
                else:
                    raise e
        except Exception as e:
            logger.error(f"Failed to setup SemanticCache index: {e}")

    async def get(self, query: str, project_id: str, threshold: float = 0.95) -> Optional[str]:
        """
        Проверяет наличие похожего запроса в кэше для данного проекта.
        """
        try:
            return await asyncio.to_thread(self._sync_get, query, project_id, threshold)
        except Exception as e:
            logger.error(f"SemanticCache.get error: {e}")
            return None

    def _sync_get(self, query: str, project_id: str, threshold: float) -> Optional[str]:
        try:
            query_embedding = self.embedding_fn.encode_query(query)
            embedding_bytes = np.array(query_embedding, dtype=np.float32).tobytes()
            
            # distance < 0.05
            max_distance = 1.0 - threshold
            
            q = Query(f"(@project_id:{{{project_id}}})=>[KNN 1 @query_vector $vec AS score]")\
                .sort_by("score")\
                .return_fields("response", "score")\
                .dialect(2)
                
            res = self.client.ft(self.index_name).search(q, query_params={"vec": embedding_bytes})
            
            if res.docs:
                doc = res.docs[0]
                score = float(doc.score)
                if score <= max_distance:
                    resp_str = doc.response
                    if isinstance(resp_str, bytes):
                        resp_str = resp_str.decode('utf-8')
                    logger.info(f"Semantic Cache HIT for project {project_id} (dist: {score:.4f})")
                    return resp_str
            return None
        except Exception as e:
            logger.error(f"SemanticCache _sync_get error: {e}")
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
        try:
            query_embedding = self.embedding_fn.encode_query(query)
            embedding_bytes = np.array(query_embedding, dtype=np.float32).tobytes()
            
            doc_id = f"{self.prefix}{uuid.uuid4().hex}"
            
            self.client.hset(doc_id, mapping={
                "project_id": project_id,
                "query": query.encode('utf-8') if isinstance(query, str) else query,
                "response": response.encode('utf-8') if isinstance(response, str) else response,
                "query_vector": embedding_bytes
            })
            self.client.expire(doc_id, self.ttl_seconds)
            logger.info(f"Semantic Cache SET for project {project_id} with TTL={self.ttl_seconds}s")
        except Exception as e:
            logger.error(f"SemanticCache _sync_set error: {e}")

# Global instance
semantic_cache = SemanticCache()
