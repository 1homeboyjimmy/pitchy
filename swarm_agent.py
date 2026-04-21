import os
import asyncio
from typing import List
import logging
from pydantic import BaseModel, Field
import instructor
from openai import AsyncOpenAI

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

async def _process_single_chunk(client, chunk: str) -> ChunkAnalysis:
    """Анализ одного чанка одним микро-агентом."""
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

async def run_analytical_swarm(chunks: List[str]) -> List[ChunkAnalysis]:
    """Параллельный запуск роя на N чанков."""
    client = get_patched_client()
    tasks = [_process_single_chunk(client, chunk) for chunk in chunks]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    valid_results = [
        res for res in results 
        if isinstance(res, ChunkAnalysis) and res.is_relevant and res.confidence > 0.7
    ]
    return valid_results
