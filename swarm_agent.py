import os
import asyncio
from typing import List
import logging
from pydantic import BaseModel, Field
import instructor
from openai import AsyncOpenAI

try:
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

logger = logging.getLogger("app")

class ChunkAnalysis(BaseModel):
    is_relevant: bool = Field(description="Содержит ли текст полезные бизнес-метрики или конкурентов?")
    competitors: List[str] = Field(default_factory=list, description="Найденные имена конкурентов")
    metrics: List[str] = Field(default_factory=list, description="Найденные числа, цены, доли рынка")
    confidence: float = Field(description="Уверенность в данных от 0.0 до 1.0", ge=0.0, le=1.0)

def get_patched_client():
    client = AsyncOpenAI(
        base_url="https://routerai.ru/api/v1",
        api_key=os.getenv("ROUTERAI_API_KEY", "test_key")
    )
    return instructor.from_openai(client)

@observe(name="swarm_node")
async def _process_single_chunk(client, chunk: str, trace_id: str = None, parent_observation_id: str = None) -> ChunkAnalysis:
    """Анализ одного чанка одним микро-агентом."""
    if langfuse_context:
        if trace_id:
            langfuse_context.update_current_observation(trace_id=trace_id)
        if parent_observation_id:
            langfuse_context.update_current_observation(parent_observation_id=parent_observation_id)
        # Help Langfuse link parallel tasks if context propagation is flaky
        langfuse_context.update_current_observation(metadata={"chunk_len": len(chunk)})
        
    try:
        response = await client.chat.completions.create(
            model="qwen/qwen-2.5-7b-instruct", 
            response_model=ChunkAnalysis,
            messages=[
                {"role": "system", "content": "Извлеки бизнес-данные. Верни строгий JSON."},
                {"role": "user", "content": f"Текст: {chunk}"}
            ],
            temperature=0.1,
            max_retries=2
        )
        return response
    except Exception as e:
        logger.error(f"Swarm chunk error: {e}", exc_info=True)
        return ChunkAnalysis(is_relevant=False, confidence=0.0)

@observe(name="run_analytical_swarm")
async def run_analytical_swarm(chunks: List[str], trace_id: str = None, parent_observation_id: str = None) -> List[ChunkAnalysis]:
    """Параллельный запуск роя на N чанков (возвращает список)."""
    results = []
    async for res in stream_analytical_swarm(chunks, trace_id, parent_observation_id):
        results.append(res)
    
    valid_results = [
        res for res in results 
        if isinstance(res, ChunkAnalysis) and res.is_relevant and res.confidence > 0.7
    ]
    return valid_results

async def stream_analytical_swarm(chunks: List[str], trace_id: str = None, parent_observation_id: str = None):
    """Генератор для потоковой обработки чанков роем."""
    if langfuse_context:
        if trace_id:
            langfuse_context.update_current_observation(trace_id=trace_id)
        if parent_observation_id:
            langfuse_context.update_current_observation(parent_observation_id=parent_observation_id)
        
    client = get_patched_client()
    tasks = [_process_single_chunk(client, chunk, trace_id=trace_id, parent_observation_id=parent_observation_id) for chunk in chunks]
    
    for coro in asyncio.as_completed(tasks):
        try:
            yield await coro
        except Exception as e:
            logger.error(f"Swarm task error in stream: {e}")
            yield ChunkAnalysis(is_relevant=False, confidence=0.0)
