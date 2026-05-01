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

def get_instructor_client(provider: str = "routerai"):
    """
    Возвращает клиент instructor для работы со структурированными данными.
    По умолчанию использует RouterAI (OpenAI-совместимый API).
    """
    if provider == "routerai":
        base_url = os.getenv("ROUTERAI_API_BASE", "https://routerai.ru/api/v1")
        api_key = os.getenv("ROUTERAI_API_KEY")
        client = AsyncOpenAI(base_url=base_url, api_key=api_key)
    elif provider == "makura":
        base_url = "https://api.makura.ai/v1"
        api_key = os.getenv("MAKURA_API_KEY")
        client = AsyncOpenAI(base_url=base_url, api_key=api_key)
    else:
        # Fallback to standard OpenAI if configured
        client = AsyncOpenAI()
        
    return instructor.from_openai(client)

@observe(name="dispatch_intent")
async def dispatch_intent(query: str, client = None) -> Any:
    """
    Классифицирует интент пользователя с помощью сверхбыстрой модели Qwen 2.5 7B.
    Использует instructor для получения строго валидного Pydantic-объекта.
    """
    from schemas.llm import IntentClassification
    
    if client is None:
        client = get_instructor_client("routerai")
        
    model = os.getenv("DISPATCHER_MODEL", "qwen/qwen-2.5-7b-instruct")
    
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
        client = get_instructor_client("routerai")
        
    model = os.getenv("DISPATCHER_MODEL", "qwen/qwen-2.5-7b-instruct")
    
    return await client.chat.completions.create(
        model=model,
        response_model=RoadmapEditResponse,
        messages=[
            {"role": "system", "content": "Ты — экспертный аналитик данных Smart Roadmap. Твоя задача — извлекать структурные изменения из запроса пользователя."},
            {"role": "user", "content": f"Контекст проекта: {project_context}\n\nЗапрос пользователя: {query}"},
        ],
        max_retries=2
    )
