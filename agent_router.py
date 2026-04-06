import asyncio
import json
from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from search_agent import async_search_with_sources
from makura_client import stream_makura
from main import SYSTEM_CHAT_PROMPT
from langfuse import Langfuse
from typing import Optional

router = APIRouter(prefix="/api/agent", tags=["agent"])
langfuse_client = Langfuse()

class AskRequest(BaseModel):
    query: str

class FeedbackRequest(BaseModel):
    trace_id: str
    value: float  # Для оценок 1 или -1
    comment: Optional[str] = None

async def agent_stream(query: str):
    # Создаем стабильный трейс вручную
    trace = langfuse_client.trace(name="agent_session_stream")
    
    # Отправляем статус поиска
    yield f"data: {json.dumps({'event': 'status', 'data': 'Выполняю поиск в интернете через Tavily...'})}\n\n"
    
    # Делаем вызов через модернизированный модуль
    sources, search_context = await async_search_with_sources(query)

    if sources:
        yield f"data: {json.dumps({'event': 'sources', 'data': sources})}\n\n"
    else:
        yield f"data: {json.dumps({'event': 'status', 'data': search_context})}\n\n"

    # Формируем промпт для LLM
    user_prompt = f"Вопрос пользователя: {query}\n\n"
    if search_context and "Интернет-поиск отключен" not in search_context and "Произошла ошибка" not in search_context:
        user_prompt += f"Найденная информация из интернета, которую нужно использовать:\n{search_context}"

    yield f"data: {json.dumps({'event': 'status', 'data': 'Сеть думает...'})}\n\n"

    # Стриминг ответа от LLM
    async for chunk in stream_makura(SYSTEM_CHAT_PROMPT, user_prompt):
        if chunk.startswith("Error:") or chunk.startswith("\n[Ошибка"):
            yield f"data: {json.dumps({'event': 'status', 'data': f'Ошибка LLM: {chunk}'})}\n\n"
        else:
            yield f"data: {json.dumps({'event': 'text_chunk', 'data': chunk})}\n\n"
        
    # Сигнал завершения с ID
    yield f"data: {json.dumps({'event': 'done', 'data': {'trace_id': trace.id}})}\n\n"

@router.post("/ask")
async def ask_agent(request: AskRequest):
    return StreamingResponse(agent_stream(request.query), media_type="text/event-stream")

def _send_langfuse_feedback(trace_id: str, value: float, comment: str):
    try:
        langfuse_client.score(
            trace_id=trace_id,
            name="user_feedback",
            value=value,
            comment=comment
        )
    except Exception as e:
        # Логируем, но не падаем
        print(f"Failed to submit feedback to Langfuse: {e}")

@router.post("/feedback")
async def agent_feedback(request: FeedbackRequest, background_tasks: BackgroundTasks):
    """
    Принимает оценку ответа агента.
    value: 1 (Like), 0/-1 (Dislike)
    """
    background_tasks.add_task(
        _send_langfuse_feedback,
        trace_id=request.trace_id,
        value=request.value,
        comment=request.comment
    )
    return {"status": "ok"}

