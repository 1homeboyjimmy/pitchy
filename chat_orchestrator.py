import json
import logging
import copy
import os
import asyncio
import time
from typing import Any, Optional
from datetime import datetime

from redis_client import get_redis
from makura_client import call_makura, stream_makura
from tree_orchestrator import _normalize_tree_data
from search_agent import execute_search_agent
from core_tree import CORE_SKELETON
import rag
from models import User, ProjectTree
from llm_client import dispatch_intent, request_roadmap_edit
from ops.cache.semantic_cache import semantic_cache
from schemas.llm import IntentClassification, RoadmapEditResponse

# Langfuse normalization: SDK looks for LANGFUSE_HOST, but server sets LANGFUSE_BASE_URL
if os.getenv("LANGFUSE_BASE_URL") and not os.getenv("LANGFUSE_HOST"):
    os.environ["LANGFUSE_HOST"] = os.environ["LANGFUSE_BASE_URL"]

try:
    from langfuse.decorators import observe, langfuse_context
except Exception as _lf_err:
    import logging as _lf_logging
    _lf_logging.getLogger("langfuse").warning("Langfuse decorators unavailable: %s", _lf_err)
    observe = lambda **kw: lambda f: f
    langfuse_context = None

logger = logging.getLogger("app")

INTENT_RECOGNITION_PROMPT = """Ты — диспетчер запросов для бизнес-платформы Pitchy.
Проанализируй запрос пользователя на основе контекста активного узла Интерактивной дорожной карты (Smart Roadmap) и истории чата.
Выдели один из следующих интентов:
1. 'finance' — расчет юнит-экономики, LTV, CAC, выручки, объемов рынка (TAM/SAM/SOM).
2. 'search' — поиск внешней информации, конкурентов на рынке, трендов, новостей.
3. 'roadmap' — изменение структуры дорожной карты, добавление новых гипотез, пересмотр бизнес-модели, ПРОПУСК текущего шага или переход к следующему.
4. 'chat' — общие вопросы, объяснение терминов, дружелюбное общение или уточнение деталей (с учетом активного узла).
5. 'presentation' — СОЗДАНИЕ, ГЕНЕРАЦИЯ или показ презентации, слайдов, питч-дека. Если пользователь просит "сделай", "сгенерируй", "покажи" презентацию/слайды — это ВСЕГДА 'presentation'.

Активный узел Roadmap: {node_label} (тип: {node_type}, описание: {node_desc})
История чата (последние сообщения):
{chat_history}

Запрос пользователя: "{user_message}"

Верни СТРОГО JSON: {{"intent": "finance" | "search" | "roadmap" | "chat" | "legal" | "presentation", "reason": "краткое пояснение"}}
Используй "legal" для вопросов о российском законодательстве, налогах РФ, ООО/ИП и нормативных требованиях.
"""

ROLE_PROMPTS = {
    "project_description": """Ты — опытный product-менеджер и эксперт по стартапам. 
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Использование китайских иероглифов или любых других языков КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО.
Твоя роль: Анализ идеи продукта и бизнес-модели.

Помогай пользователю оценивать жизнеспособность концепции, проблематику, решение, конкурентов и UVP в рамках Интерактивной дорожной карты (Smart Roadmap).
ВАЖНЫЕ ПРАВИЛА:
1. ДЕТАЛИЗАЦИЯ: На вопросы по валидации идеи отвечай подробно и структурированно. 
2. ГРАНИЦЫ: Если запрос касается финансов или сегментации ЦА, дай краткий ответ и направь в соответствующий раздел дорожной карты.""",

    "target_audience": """Ты — маркетолог-исследователь. 
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Использование китайских иероглифов или любых других языков КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО.
Твоя роль: Анализ целевой аудитории (ЦА).

Помогай сегментировать рынок, составлять портреты пользователей, выявлять боли, потребности и паттерны (JTBD) для Smart Roadmap.
ВАЖНЫЕ ПРАВИЛА:
1. ДЕТАЛИЗАЦИЯ: На вопросы о пользователях и сегментации отвечай максимально глубоко.
2. ГРАНИЦЫ: Если запрос касается экономики или концепции продукта, дай краткий ответ и направь в нужный раздел дорожной карты.""",

    "unit_economics": """Ты — финансовый директор (CFO) и эксперт по метрикам. 
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Использование китайских иероглифов или любых других языков КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО.
Твоя роль: Расчет юнит-экономики.

Помогай считать CAC, LTV, ROI и другие метрики для Smart Roadmap. Приводи формулы и пошаговые вычисления.
ВАЖНЫЕ ПРАВИЛА:
1. ДЕТАЛИЗАЦИЯ: На финансовые вопросы отвечай максимально подробно с цифрами.
2. ГРАНИЦЫ: Если запрос про идею или маркетинг без цифр, дай краткий ответ и направь в нужный раздел дорожной карты."""
}

FINANCE_PROMPT = """Ты — финансовый эксперт. 
ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Использование китайских иероглифов КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО.

Твоя задача: помогать пользователю с финансами и метриками в рамках Smart Roadmap.
Если запрос не по теме финансов, направь пользователя в нужный раздел.

Верни ответ с пояснениями и JSON-блоком в конце.

Контекст блока: {node_context}
Текущие метрики дорожной карты: {tree_metrics}
Сообщение пользователя: {user_message}

В конце добавь:
---JSON_START---
{{ "metrics": {{ ... }} }}
---JSON_END---
"""

class ChatOrchestrator:
    def __init__(self, tree_id: int, user_id: int, db_session: Any):
        self.tree_id = tree_id
        self.user_id = user_id
        self.db = db_session
        self.redis = get_redis()
        self.state_key = f"user:{user_id}:tree:{tree_id}:state"

    def _get_chat_key(self, node_id: Optional[str] = None) -> str:
        """Generate Redis key for chat history. Global if node_id is None."""
        if node_id:
            return f"user:{self.user_id}:tree:{self.tree_id}:node:{node_id}:chat"
        return f"user:{self.user_id}:tree:{self.tree_id}:chat"

    async def load_state(self) -> dict:
        """Load state from Redis (Hot) or fallback to Postgres (Cold)."""
        if self.redis:
            cached = self.redis.get(self.state_key)
            if cached:
                return json.loads(cached)

        # Fallback to DB
        tree = self.db.query(ProjectTree).filter(ProjectTree.id == self.tree_id).first()
        if not tree:
            return {"nodes": [], "readiness_index": 0}

        state = {
            "nodes": tree.tree_data.get("nodes", []),
            "readiness_index": tree.readiness_index,
            "title": tree.title,
            "status": tree.status
        }

        if self.redis:
            self.redis.setex(self.state_key, 86400, json.dumps(state))
        
        return state

    async def save_state(self, state: dict):
        """Save state to Redis."""
        if self.redis:
            self.redis.setex(self.state_key, 86400, json.dumps(state))
        # Note: PG sync is handled by background worker

    async def get_chat_history(self, node_id: Optional[str] = None, limit: int = 20) -> list:
        """Get recent chat history from Redis with PG fallback."""
        if self.redis:
            chat_key = self._get_chat_key(node_id)
            history = self.redis.lrange(chat_key, 0, limit - 1)
            if history:
                return [json.loads(m) for m in history][::-1] 

        # PostgreSQL Fallback
        if self.db:
            from models import TreeChatHistory
            query = self.db.query(TreeChatHistory).filter(TreeChatHistory.project_id == self.tree_id)
            if node_id:
                query = query.filter(TreeChatHistory.node_id == node_id)
            else:
                query = query.filter(TreeChatHistory.node_id == None)
            
            history_msgs = query.order_by(TreeChatHistory.timestamp.desc()).limit(limit).all()
            return [
                {
                    "role": m.role,
                    "content": m.message,
                    "thoughts": m.thoughts,
                    "model_used": m.model_used,
                    "timestamp": m.timestamp.isoformat(),
                    "client_id": m.client_id
                }
                for m in reversed(history_msgs)
            ]
        
        return []

    async def add_chat_message(self, role: str, content: str, thoughts: Optional[str] = None, node_id: Optional[str] = None, model_used: str = None, client_id: str = None, sources: list[dict] = None):
        """Add message to Redis list and PostgreSQL."""
        msg = {
            "role": role,
            "content": content,
            "thoughts": thoughts,
            "model_used": model_used,
            "timestamp": datetime.now().isoformat(),
            "client_id": client_id,
            "sources": sources
        }
        
        # 1. Perspective: Redis (Hot)
        if self.redis:
            chat_key = self._get_chat_key(node_id)
            self.redis.lpush(chat_key, json.dumps(msg))
            self.redis.ltrim(chat_key, 0, 99) # Keep 100 messages

        # 2. Perspective: PostgreSQL (Cold)
        if self.db:
            try:
                from models import TreeChatHistory
                db_msg = TreeChatHistory(
                    project_id=self.tree_id,
                    role=role,
                    message=content,
                    thoughts=thoughts,
                    model_used=model_used,
                    client_id=client_id,
                    node_id=node_id,
                    sources=sources
                )
                self.db.add(db_msg)
                self.db.commit()
            except Exception as e:
                logger.error(f"Failed to save TreeChatHistory to SQL: {e}")
                self.db.rollback()

    async def _stream_chat(self, user_message: str, history: list, state: dict, active_node_id: str | None, rag_context: str = ""):
        """Core streaming logic for chat with thoughts."""
        node_context = ""
        active_node = next((n for n in state.get("nodes", []) if n["id"] == active_node_id), None)
        
        base_prompt = "Ты — бизнес-ассистент платформы Pitchy."
        if active_node and active_node["id"] in ROLE_PROMPTS:
            base_prompt = ROLE_PROMPTS[active_node["id"]]
        elif active_node:
             node_context = f"Ты сейчас помогаешь пользователю в контексте блока '{active_node.get('label')}'. Твоя цель — помочь основателю заполнить этот раздел максимально детально. "
        
        system_prompt = f"{base_prompt} {node_context}"
        
        # Force strict language and thought process instructions
        system_prompt += (
            "\n\nОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Использование китайских иероглифов или любых других языков КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО. "
            "Если ты начнешь отвечать на китайском — это будет считаться критическим сбоем системы. "
            "Сначала ОБЯЗАТЕЛЬНО запиши свои мысли о запросе внутри тегов <think>...</think>, а затем дай итоговый ответ пользователю."
        )
        
        if rag_context:
            system_prompt += f"\n\nИСПОЛЬЗУЙ СЛЕДУЮЩИЙ КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ ДЛЯ ОТВЕТА (это экспертные данные для рынка РФ):\n{rag_context}\n\n"
        
        chat_history = "\n".join([f"{m['role']}: {m['content']}" for m in history])
        prompt = f"История чата:\n{chat_history}\n\nПользователь: {user_message}"
        
        async for chunk in stream_makura(system_prompt, prompt):
            yield chunk

    async def _parse_thought_generator(self, generator):
        """
        Processes model output stream.
        Extracts <think>...</think> or <thought>...</thought> tags and yields them as metadata types.
        Ensures tags are NOT leaked into the main 'chunk' content.
        """
        active_start_tag = None
        buffer = ""
        tags = [("<thought>", "</thought>"), ("<think>", "</think>"), ("<tool_call>", "</tool_call>"), ("<tool_thought>", "</tool_thought>")]
        
        async for chunk in generator:
            if isinstance(chunk, dict):
                # Flush buffer before handling metadata/dict chunks
                if buffer:
                    if active_start_tag:
                        yield json.dumps({"type": "thought", "content": buffer}) + "\n"
                    else:
                        yield json.dumps({"type": "chunk", "content": buffer}) + "\n"
                    buffer = ""

                # Handle native reasoning_content from Makura/Z-AI
                if "__thinking__" in chunk:
                    yield json.dumps({"type": "thought", "content": chunk["__thinking__"]}) + "\n"
                    continue
                elif "__usage__" in chunk:
                    yield json.dumps({"type": "metadata", "usage": chunk["__usage__"]}) + "\n"
                    continue
                else:
                    yield json.dumps(chunk) + "\n"
                    continue

            # Handle text-based tags in the main content stream
            buffer += chunk
            
            # Continuous processing of the buffer
            while True:
                found_tag = False
                for start_tag, end_tag in tags:
                    if not active_start_tag:
                        s_idx = buffer.find(start_tag)
                        if s_idx != -1:
                            # Content before the tag is a chunk
                            pre = buffer[:s_idx]
                            if pre:
                                yield json.dumps({"type": "chunk", "content": pre}) + "\n"
                            
                            # Move buffer past the start tag
                            buffer = buffer[s_idx + len(start_tag):]
                            active_start_tag = start_tag
                            found_tag = True
                            break
                    else:
                        # Only look for the end_tag corresponding to the current active_start_tag
                        # though 'tags' loop iterates over all, we only care if we match the one we started.
                        # For simplicity, if we find ANY closing tag that matches OUR opening tag:
                        if start_tag == active_start_tag:
                            e_idx = buffer.find(end_tag)
                            if e_idx != -1:
                                # Content inside tags is a thought
                                thought_content = buffer[:e_idx]
                                if thought_content:
                                    yield json.dumps({"type": "thought", "content": thought_content}) + "\n"
                                
                                # Move buffer past the end tag
                                buffer = buffer[e_idx + len(end_tag):]
                                active_start_tag = None
                                found_tag = True
                                break
                
                if not found_tag:
                    # If no complete tag found, yield what we can but keep a small buffer
                    # to avoid splitting a tag that might be coming in the next chunk.
                    max_tag_len = 12
                    if not active_start_tag:
                        if len(buffer) > max_tag_len:
                            to_yield = buffer[:-max_tag_len]
                            buffer = buffer[-max_tag_len:]
                            yield json.dumps({"type": "chunk", "content": to_yield}) + "\n"
                    else:
                        if len(buffer) > max_tag_len:
                            to_yield = buffer[:-max_tag_len]
                            buffer = buffer[-max_tag_len:]
                            yield json.dumps({"type": "thought", "content": to_yield}) + "\n"
                    break
                        
        if buffer:
            # Clean up residual tags from final buffer
            final_content = buffer
            for start_tag, end_tag in tags:
                final_content = final_content.replace(start_tag, "").replace(end_tag, "")
            
            if final_content.strip():
                # FALLBACK: If we are at the end of the stream and still have an active_start_tag,
                # we decide whether to hide it or leak it.
                is_pure_thought = active_start_tag in ["<think>", "<thought>"]
                yield json.dumps({"type": "thought" if is_pure_thought else "chunk", "content": final_content}) + "\n"

    @observe(name="orchestrator_process_message")
    async def process_message(self, user_message: str, active_node_id: str = None, client_id: str = None, assistant_client_id: str = None, use_deep_search: bool = False, use_research: bool = False):
        """Main entry point for chat orchestration. Yields JSON chunks."""
        
        # Step 0: Fast Path (Semantic Cache)
        # Data isolation: cache is scoped to the specific project_id
        cached_response = await semantic_cache.get(query=user_message, project_id=str(self.tree_id))
        if cached_response and not use_deep_search and not use_research:
            yield json.dumps({"type": "chunk", "content": cached_response}) + "\n"
            yield json.dumps({"type": "metadata", "model": "Semantic Cache (Hit)"}) + "\n"
            yield json.dumps({"type": "final", "readiness_index": 0}) + "\n"
            return

        # Step 1: Parallel Execution (asyncio.gather)
        # Concurrent Intent Discovery, RAG Retrieval, and State Loading
        intent_task = asyncio.create_task(dispatch_intent(user_message))
        rag_task = asyncio.to_thread(rag.get_relevant_chunks, user_message, top_k=5)
        state_task = asyncio.create_task(self.load_state())
        
        # return_exceptions=True prevents 500 error if one of the tasks fails
        results = await asyncio.gather(intent_task, rag_task, state_task, return_exceptions=True)
        
        intent_data = results[0] if not isinstance(results[0], Exception) else IntentClassification(intent="chat", reasoning="Fallback due to error", confidence=0.0)
        initial_rag_chunks = results[1] if not isinstance(results[1], Exception) else []
        state = results[2] if not isinstance(results[2], Exception) else {"nodes": [], "readiness_index": 0}
        
        history = await self.get_chat_history(node_id=active_node_id)
        
        intent = intent_data.intent if intent_data.intent != "tree" else "roadmap" # Safe mapping
        logger.info(f"Orchestrator: User intent classified as '{intent}' by Qwen 2.5")

        reply_full = ""
        thoughts_full = ""
        model_used = "Makura (GLM-4)"
        enriched_data = {}
        sources_list = []
        usage_data = None  # Token usage tracking
        message_saved = False  # Track if the message was successfully saved

        if langfuse_context:
            langfuse_context.update_current_observation(
                name=f"chat_orchestrator_{intent}",
                user_id=str(self.user_id),
                session_id=str(self.tree_id),
                tags=[intent, "deep_search" if use_deep_search else "basic_search"]
            )

        try:
            if intent == "chat" or intent not in ["roadmap", "finance", "search", "legal", "presentation", "tree"]:
                # Use pre-fetched RAG context
                rag_context = "\n".join([c["text"] if isinstance(c, dict) else c for c in initial_rag_chunks[:3]])
                
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
                start_time = time.time()
                ttft = None
                async for json_chunk in self._parse_thought_generator(self._stream_chat(user_message, history, state, active_node_id, rag_context=rag_context)):
                    # Check for usage sentinel from stream_makura
                    if isinstance(json_chunk, dict):
                        if "__usage__" in json_chunk:
                            usage_data = json_chunk["__usage__"]
                        continue
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk": 
                        if ttft is None:
                            ttft = time.time() - start_time
                        reply_full += data["content"]
                    elif data["type"] == "thought":
                        if ttft is None:
                            ttft = time.time() - start_time
                        thoughts_full += data["content"]
                    yield json_chunk
            
            elif intent in ["roadmap", "tree"]:
                user_obj = self.db.query(User).filter(User.id == self.user_id).first()
                if user_obj and user_obj.subscription_tier == "tester":
                    msg = "Функция работы с интерактивной дорожной картой недоступна в тарифе Tester. Для использования полного функционала оформите полноценную подписку."
                    yield json.dumps({"type": "chunk", "content": msg}) + "\n"
                    return
                
                reply_full, enriched_data = await self._handle_roadmap_edit(user_message, state, active_node_id)
                yield json.dumps({"type": "chunk", "content": reply_full}) + "\n"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
            
            elif intent == "search" or use_research:
                model_used = "Tavily/Agent"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
                
                start_time = time.time()
                ttft = None
                # Logic: Use search handler that yields chunks natively
                async for json_chunk in self._handle_search(user_message, use_deep_search or use_research, use_research):
                    if isinstance(json_chunk, dict):
                        if "__usage__" in json_chunk:
                            usage_data = json_chunk["__usage__"]
                        continue
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk": 
                        if ttft is None:
                            ttft = time.time() - start_time
                        reply_full += data.get("content", "")
                    elif data["type"] == "thought":
                        if ttft is None:
                            ttft = time.time() - start_time
                        thoughts_full += data.get("content", "")
                    elif data["type"] == "sources":
                        sources_list = data.get("data", [])
                    yield json_chunk


            elif intent == "legal":
                # Use pre-fetched context shifted to legal collections if needed, OR just use initial ones to save time
                rag_context = "\n".join([c["text"] if isinstance(c, dict) else c for c in initial_rag_chunks[:3]])
                
                reply_full = await self._handle_legal(user_message, rag_context=rag_context)
                yield json.dumps({"type": "chunk", "content": reply_full}) + "\n"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
            
            elif intent == "finance":
                model_used = "Makura (Finance Expert)"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
                async for json_chunk in self._handle_finance(user_message, state, active_node_id):
                    if isinstance(json_chunk, dict):
                        if "__usage__" in json_chunk:
                            usage_data = json_chunk["__usage__"]
                        continue
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk":
                        reply_full += data.get("content", "")
                    yield json_chunk
            
            elif intent == "presentation":
                user_obj = self.db.query(User).filter(User.id == self.user_id).first()
                if user_obj and user_obj.subscription_tier == "tester":
                    msg = "Генерация презентаций недоступна в тарифе Tester. Для использования полного функционала оформите полноценную подписку."
                    yield json.dumps({"type": "chunk", "content": msg}) + "\n"
                    return
                    
                model_used = "Makura (Presentation Builder)"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
                
                # Start showing generation UI quickly
                yield json.dumps({"type": "chunk", "content": "Начинаю сборку вашей презентации... Пожалуйста, подождите, это займет около 10-15 секунд.\n\n"}) + "\n"
                reply_full += "Начинаю сборку вашей презентации... Пожалуйста, подождите, это займет около 10-15 секунд.\n\n"
                
                yield json.dumps({"type": "status", "content": "Инициализация запроса..."}) + "\n"
                await asyncio.sleep(1)
                yield json.dumps({"type": "status", "content": "Search: Анализ трендов и рынка..."}) + "\n"
                await asyncio.sleep(1.5)
                yield json.dumps({"type": "status", "content": "Image Search: Подбор визуальных метафор..."}) + "\n"
                await asyncio.sleep(1)
                yield json.dumps({"type": "status", "content": "Initialize Design..."}) + "\n"
                await asyncio.sleep(1)
                yield json.dumps({"type": "status", "content": "Вёрстка слайдов..."}) + "\n"
                
                rag_context = "\n".join([c["text"] if isinstance(c, dict) else c for c in initial_rag_chunks[:3]])
                slides, raw_reply, usage_ret = await self._handle_presentation(user_message, state, rag_context)
                
                if usage_ret:
                    usage_data = usage_ret
                
                if slides:
                    yield json.dumps({"type": "presentation", "data": slides}) + "\n"
                    yield json.dumps({"type": "chunk", "content": "Презентация успешно сгенерирована! Открываю панель просмотра."}) + "\n"
                    reply_full += "Презентация успешно сгенерирована! Открываю панель просмотра."
                else:
                    yield json.dumps({"type": "chunk", "content": "К сожалению, не удалось сгенерировать правильный формат презентации. Попробуйте еще раз."}) + "\n"
                    reply_full += "К сожалению, не удалось сгенерировать правильный формат презентации. Попробуйте еще раз."

            
            else:
                # Fallback
                async for json_chunk in self._parse_thought_generator(self._stream_chat(user_message, history, state, active_node_id)):
                    if isinstance(json_chunk, dict):
                        if "__usage__" in json_chunk:
                            usage_data = json_chunk["__usage__"]
                        continue
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk":
                        reply_full += data["content"]
                    elif data["type"] == "thought":
                        thoughts_full += data["content"]
                    yield json_chunk
                    
        finally:
            # Rescue save: if message wasn't saved (e.g. stream aborted), save the partial response
            if not message_saved and (reply_full.strip() or thoughts_full.strip()):
                # use create_task for fire-and-forget saving
                asyncio.create_task(self.add_chat_message(
                    "assistant", 
                    reply_full, 
                    thoughts=thoughts_full.strip() if thoughts_full else None, 
                    node_id=active_node_id, 
                    model_used=model_used, 
                    client_id=assistant_client_id, 
                    sources=sources_list
                ))

            if langfuse_context and (reply_full or thoughts_full):
                try:
                    # Build usage dict for Langfuse
                    lf_usage = {}
                    if usage_data:
                        lf_usage = {
                            "input": usage_data.get("prompt_tokens", 0),
                            "output": usage_data.get("completion_tokens", 0),
                            "total": usage_data.get("total_tokens", 0),
                        }
                    elif reply_full:
                        # Estimate tokens from character count (~4 chars/token for Russian)
                        est_input = len(user_message) // 4
                        est_output = len(reply_full) // 4
                        lf_usage = {"input": est_input, "output": est_output, "total": est_input + est_output}
                    
                    update_params = {
                        "model": model_used,
                        "input": user_message,
                        "output": f"<thought>{thoughts_full}</thought>\n\n{reply_full}" if thoughts_full else reply_full,
                    }
                    if lf_usage:
                        update_params["usage"] = lf_usage
                    if ttft is not None:
                        update_params["metadata"] = {"ttft": ttft}
                    
                    langfuse_context.update_current_observation(**update_params)
                except Exception as e:
                    logger.error(f"Langfuse generation tracking failed: {e}")

        # 3. Merge state if AI returned structured data
        if enriched_data:
            state = self._merge_ai_data_to_state(state, enriched_data)
            await self.save_state(state)
            yield json.dumps({"type": "tree_update", "data": state}) + "\n"

        # 4. Finalize
        message_saved = True # Prevent double-saving in finally block
        await self.add_chat_message("user", user_message, node_id=active_node_id, client_id=client_id)
        await self.add_chat_message("assistant", reply_full, thoughts=thoughts_full.strip() if thoughts_full else None, node_id=active_node_id, model_used=model_used, client_id=assistant_client_id, sources=sources_list)

        # Step 3: Background Cache Save
        # Only cache general chat responses that are successful and not tool-based
        if intent == "chat" and reply_full and not use_deep_search and not use_research:
            asyncio.create_task(semantic_cache.set(query=user_message, response=reply_full, project_id=str(self.tree_id)))

        # Final metadata
        yield json.dumps({
            "type": "final",
            "readiness_index": state.get("readiness_index", 0),
            "hints": self._get_hints(state, active_node_id),
            "assistant_client_id": assistant_client_id
        }) + "\n"

    def _get_hints(self, state: dict, active_node_id: str | None) -> list[str]:
        """Generate contextual suggestions based on node focus."""
        hints = ["Что мне делать дальше?", "Покажи примеры"]
        if not active_node_id:
            return hints
            
        node = next((n for n in state.get("nodes", []) if n["id"] == active_node_id), None)
        if not node:
            return hints
            
        label = node.get("label", "")
        inputs = node.get("data", {}).get("inputs", [])
        missing = [i for i in inputs if not i.get("value")]
        
        if missing:
            hints.insert(0, f"Помоги заполнить '{missing[0]['label']}'")
            hints.append("Наведи порядок в данных")
            
        if any(w in label for w in ["Рынок", "Финансы", "Экономика", "Цены"]):
            hints.append("Рассчитай юнит-экономику")
            hints.append("Какой у меня будет LTV?")
        elif "Конкурент" in label:
            hints.append("Найди моих конкурентов в сети")
        elif "Маркетинг" in label or "Канал" in label:
            hints.append("Какие каналы продвижения лучше?")
            
        return list(set(hints))[:5] # Unique top 5


    async def _handle_finance(self, user_message: str, state: dict, active_node_id: str):
        """Handle financial calculations via Makura with streaming."""
        node_info = next((n for n in state["nodes"] if n["id"] == active_node_id), {})
        tree_metrics = {}
        for n in state["nodes"]:
            for inp in n.get("data", {}).get("inputs", []):
                if inp.get("value"):
                    tree_metrics[inp["field"]] = inp["value"]

        # Run RAG and Search in parallel to reduce latency
        rag_task = asyncio.to_thread(rag.get_relevant_chunks, user_message, top_k=3)
        from search_agent import async_search_with_sources
        search_task = async_search_with_sources(user_message, use_deep_search=False)
        
        rag_context_list, (sources, search_context) = await asyncio.gather(rag_task, search_task)
        
        rag_context = "\n".join([c["text"] for c in rag_context_list])
        full_context = f"ДАННЫЕ ИЗ БАЗЫ ЗНАНИЙ:\n{rag_context}\n\nДАННЫЕ ИЗ ИНТЕРНЕТА:\n{search_context}"
        
        prompt = FINANCE_PROMPT.format(
            node_context=json.dumps(node_info),
            tree_metrics=json.dumps(tree_metrics),
            user_message=user_message
        )
        system_prompt = f"Ты финансовый эксперт Pitchy. На основе предоставленного контекста ответь пользователю:\n{full_context}"
        
        # Use stream_makura for immediate feedback
        async for chunk in stream_makura(prompt, system_prompt=system_prompt):
            if isinstance(chunk, dict):
                continue  # Skip usage sentinel
            yield json.dumps({"type": "chunk", "content": chunk}) + "\n"

    async def _handle_search(self, user_message: str, use_deep_search: bool = False, use_research: bool = False):
        """Handle internet search intent by calling Tavily streaming research or basic search."""
        if use_research:
            from search_agent import stream_deep_research
            async for chunk in stream_deep_research(user_message):
                yield json.dumps(chunk) + "\n"
            return

        from search_agent import async_search_with_sources
        
        # 1. Inform client that we are starting basic/deep search (non-agentic)
        yield json.dumps({"type": "thought", "content": "Ищу информацию в интернете..."}) + "\n"
        
        sources, search_context = await async_search_with_sources(user_message, use_deep_search)
        
        if sources:
            yield json.dumps({"type": "sources", "data": sources}) + "\n"
        
        prompt = (
            "Ты — бизнес-аналитик. Пользователь задал вопрос, требующий поиска в интернете.\n\n"
            f"Найденная информация из сети:\n{search_context}\n\n"
            f"Вопрос пользователя: {user_message}\n\n"
            "Дай развернутый ответ на основе интернета. Можешь сослаться на источники по номерам, но не выводи ссылки."
        )
        system = "Ты — эксперт по поиску и сводке информации. Сначала напиши свои мысли в <thought>...</thought>, а затем ответ."
        
        async for chunk in self._parse_thought_generator(stream_makura(system, prompt)):
            yield chunk

    async def _handle_legal(self, user_message: str, rag_context: str = "") -> str:
        """Handle legal questions via Makura (specialized for RU law) + RAG."""
        system_prompt = "Ты — квалифицированный юрист по российскому законодательству. Отвечай на вопросы о налогах, праве и регистрации бизнеса в РФ."
        if rag_context:
            system_prompt += f"\nИспользуй следующие выдержки из нормативных документов для подготовки ответа:\n{rag_context}"
            
        try:
            reply, _, _ = await call_makura(system_prompt, user_message)
            return reply or "Юридический помощник временно недоступен."
        except Exception as e:
            logger.error(f"Legal call failed: {e}")
            return "Извините, не удалось получить юридическую консультацию."

    async def _handle_roadmap_edit(self, user_message: str, state: dict, active_node_id: str = None) -> tuple[str, dict]:
        """Handle roadmap modifications via Instructor and Qwen 2.5."""
        active_node = next((n for n in state.get("nodes", []) if n["id"] == active_node_id), None)
        node_context = f"Активный узел Roadmap: {active_node['label']} (id: {active_node_id})" if active_node else "Глобальный контекст"
        
        project_context = f"Активный узел: {node_context}. Текущая структура Roadmap: {json.dumps(state['nodes'])}"
        
        try:
            edit_response: RoadmapEditResponse = await request_roadmap_edit(user_message, project_context)
            
            # Map Pydantic model back to the expected dict structure for backward compatibility
            enriched = {
                "action": edit_response.action,
                "node_id": edit_response.node_id,
                "node_content": edit_response.node_content,
                "priority": edit_response.priority,
                "justification": edit_response.justification
            }
            
            return f"Интерактивная дорожная карта обновлена: {edit_response.justification}", enriched
        except Exception as e:
            logger.error(f"Roadmap edit extraction failed: {e}")
            return "Извините, не удалось обработать изменение дорожной карты.", {}

    async def _handle_chat(self, user_message: str, chat_history: str = "", active_node: dict = None) -> str:
        """Handle general chat via Makura (GLM-5)."""
        node_context = ""
        
        base_prompt = "Ты — бизнес-ассистент платформы Pitchy."
        if active_node and active_node.get("id") in ROLE_PROMPTS:
            base_prompt = ROLE_PROMPTS[active_node["id"]]
        elif active_node:
            node_context = f"Ты сейчас помогаешь пользователю в контексте узла '{active_node.get('label')}' (описание: {active_node.get('data', {}).get('description')}). "
        
        system_prompt = f"{base_prompt} {node_context}Отвечай на русском языке. Сначала запиши свои мысли/размышления о запросе внутри тегов <thought>...</thought>, а затем дай итоговый ответ пользователю."
        prompt = f"История чата:\n{chat_history}\n\nПользователь: {user_message}"
        
        provider = os.getenv("PRIMARY_PROVIDER", "makura")
        if provider == "makura":
            reply, json_metrics, _ = await call_makura(system_prompt, prompt)
        else:
            reply, json_metrics, _ = await call_makura(system_prompt, prompt)
        
        if json_metrics:
            # Assuming _save_metrics_from_json is defined elsewhere or will be added
            # self._save_metrics_from_json(json_metrics) 
            pass # Placeholder as _save_metrics_from_json is not provided in the diff
            
        return reply or "Извините, сейчас я не могу ответить."

    async def _handle_presentation(self, user_message: str, state: dict, rag_context: str = "") -> tuple[list, str, dict]:
        """Handle presentation generation via Makura."""
        tree_metadata = json.dumps(state.get("nodes", []), ensure_ascii=False)
        
        system_prompt = "Ты — эксперт по созданию презентаций (pitch decks) для стартапов."
        prompt = (
            f"Пользователь запросил: {user_message}\n\n"
            f"Текущие данные проекта:\n{tree_metadata}\n\n"
            f"Контекст из базы знаний (рынок, конкуренты):\n{rag_context}\n\n"
            "Твоя задача — сгенерировать КОНТЕНТ и ВЕРСТКУ для слайдов инвесторской презентации.\n"
            "Верни СТРОГО JSON-массив из 5-10 объектов. Ничего кроме JSON возвращать не нужно.\n"
            "Допустимые 'type' слайдов: 'Hero', 'Problem', 'Solution', 'Market', 'BusinessModel', 'Team', 'CallToAction'.\n"
            "У каждого слайда должны быть поля 'type', 'title' и 'html'.\n"
            "В поле 'html' должен быть валидный HTML-код с классами TailwindCSS для темной темы (bg-[#131313] text-white). Используй flex, grid, gap, градиенты текста (bg-gradient-to-r) для создания премиального дизайна.\n"
            "Пример ответа:\n"
            "[\n"
            "  {\"type\": \"Hero\", \"title\": \"Название\", \"html\": \"<div class='flex flex-col items-center justify-center p-12 h-full bg-gradient-to-b from-[#1a1a2e] to-[#131313] relative'><h1 class='text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-6'>AppName</h1><p class='text-2xl text-white/80'>Слоган</p></div>\"},\n"
            "  {\"type\": \"Problem\", \"title\": \"Проблема\", \"html\": \"<div class='flex flex-col justify-center p-12 h-full'><h2 class='text-4xl font-bold border-l-4 border-red-500 pl-4 mb-8'>Проблема</h2><div class='space-y-4'><div class='p-6 bg-white/5 rounded-xl border border-white/10'><p class='text-xl text-white/90'>Боль 1</p></div><div class='p-6 bg-white/5 rounded-xl border border-white/10'><p class='text-xl text-white/90'>Боль 2</p></div></div></div>\"}\n"
            "]\n"
        )
        
        reply, _, usage_data = await call_makura(system_prompt, prompt, model=os.getenv("MAKURA_MODEL", "glm-5"))
        
        if not reply:
            return [], "", {}
            
        try:
            # Clean up potential markdown formatting
            cleaned = reply.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
                
            cleaned = cleaned.strip()
            slides = json.loads(cleaned)
            
            if not isinstance(slides, list):
                if isinstance(slides, dict) and "slides" in slides:
                    slides = slides["slides"]
                else:
                    slides = []
            return slides, reply, usage_data
        except Exception as e:
            logger.error(f"Failed to parse presentation JSON: {e}\nRaw reply: {reply}")
            return [], reply, usage_data

    def _merge_ai_data_to_state(self, state: dict, enriched_data: dict) -> dict:
        """Update existing nodes with new values from AI."""
        nodes = state["nodes"]
        # Handle direct node status updates (e.g. skipped)
        if "node_id" in enriched_data and "status" in enriched_data:
            target_id = enriched_data["node_id"]
            for node in nodes:
                if node["id"] == target_id:
                    node["status"] = enriched_data["status"]
                    break

        # Handle field-level extraction
        data_to_map = enriched_data.get("extracted_data", {})
        if not data_to_map and not enriched_data.get("node_id"):
            # Fallback if AI returned flat dict
            data_to_map = enriched_data

        for node in nodes:
            inputs = node.get("data", {}).get("inputs", [])
            filled_fields = []
            for inp in inputs:
                field = inp.get("field")
                if field in data_to_map:
                    inp["value"] = data_to_map[field]
                    if node["status"] != "skipped":
                        inp["status"] = "completed"
                
                if inp.get("value") is not None:
                    label = inp.get("label", field)
                    filled_fields.append(f"{label}: {inp['value']}")
            
            # Generate summary for visual display if filled
            if filled_fields:
                node["data"]["summary"] = " • ".join(filled_fields[:3]) # Show top 3 fields
                if len(filled_fields) > 3:
                    node["data"]["summary"] += "..."
        
        # Recalculate readiness
        total = len(nodes)
        completed = sum(1 for n in nodes if n.get("status") in ["completed", "skipped"])
        state["readiness_index"] = int((completed / max(total, 1)) * 100)
        
        return state
