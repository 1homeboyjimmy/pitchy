import os
import instructor
from openai import AsyncOpenAI
from typing import Type, TypeVar, Any

try:
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

T = TypeVar("T", bound="Any")

def get_instructor_client(provider: str = "polza"):
    """
    Возвращает клиент instructor для работы со структурированными данными.
    Использует Polza (OpenAI-совместимый API).
    """
    if provider != "polza":
        raise ValueError("Structured LLM requests must use the Polza provider")
    client = AsyncOpenAI(
        base_url=os.getenv("POLZA_API_BASE", "https://polza.ai/api/v1"),
        api_key=os.getenv("POLZA_API_KEY"),
    )
        
    return instructor.from_openai(client)

@observe(name="dispatch_intent")
async def dispatch_intent(query: str, client = None) -> Any:
    """
    Классифицирует интент пользователя с помощью Qwen3-32B через Polza.
    Использует instructor для получения строго валидного Pydantic-объекта.
    """
    from schemas.llm import IntentClassification
    
    if client is None:
        client = get_instructor_client("polza")
        
    model = os.getenv("DISPATCHER_MODEL", "qwen/qwen3-32b")
    
    return await client.chat.completions.create(
        model=model,
        response_model=IntentClassification,
        messages=[
            {"role": "system", "content": "Ты — экспертный диспетчер интентов. Твоя задача — классифицировать запрос пользователя для выбора правильного пайплайна обработки."},
            {"role": "user", "content": query},
        ],
        max_retries=2
    )

@observe(name="request_roadmap_edit")
async def request_roadmap_edit(query: str, project_context: str, client = None) -> Any:
    """
    Извлекает структурные изменения для дорожной карты (Smart Roadmap).
    Использует RoadmapEditResponse для строгой типизации.
    """
    from schemas.llm import RoadmapEditResponse
    
    if client is None:
        client = get_instructor_client("polza")
        
    model = os.getenv("DISPATCHER_MODEL", "qwen/qwen3-32b")
    
    return await client.chat.completions.create(
        model=model,
        response_model=RoadmapEditResponse,
        messages=[
            {"role": "system", "content": "Ты — экспертный аналитик данных Smart Roadmap. Твоя задача — извлекать структурные изменения из запроса пользователя."},
            {"role": "user", "content": f"Контекст проекта: {project_context}\n\nЗапрос пользователя: {query}"},
        ],
        max_retries=2
    )
