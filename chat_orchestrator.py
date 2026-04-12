import json
import logging
import copy
import os
import asyncio
from typing import Any, Optional
from datetime import datetime

from redis_client import get_redis
from makura_client import call_makura, stream_makura
from tree_orchestrator import _normalize_tree_data
from search_agent import execute_search_agent
from yandex_gpt_client import async_call_yandex_gpt
from core_tree import CORE_SKELETON
import rag

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
Проанализируй запрос пользователя на основе контекста активного узла и истории чата.
Выдели один из следующих интентов:
1. 'finance' — расчет юнит-экономики, LTV, CAC, выручки, объемов рынка (TAM/SAM/SOM).
2. 'search' — поиск внешней информации, конкурентов на рынке, трендов, новостей.
3. 'tree' — изменение структуры проекта, добавление новых гипотез, пересмотр бизнес-модели, ПРОПУСК текущего шага или переход к следующему.
4. 'chat' — общие вопросы, объяснение терминов, дружелюбное общение или уточнение деталей (с учетом активного узла).
5. 'presentation' — создание, генерация или показ презентации, слайдов, питч-дека.

Активный узел: {node_label} (тип: {node_type}, описание: {node_desc})
История чата (последние сообщения):
{chat_history}

Запрос пользователя: "{user_message}"

Верни СТРОГО JSON: {{"intent": "finance" | "search" | "tree" | "chat" | "legal" | "presentation", "reason": "краткое пояснение"}}
Используй "legal" для вопросов о российском законодательстве, налогах РФ, ООО/ИП и нормативных требованиях.
"""

ROLE_PROMPTS = {
    "project_description": """Ты — опытный product-менеджер и эксперт по валидации стартапов. 
Твоя текущая роль и единственная функция в этом чате: **Анализ идеи продукта или бизнеса**.

Твоя задача: помогать пользователю оценивать жизнеспособность концепции, проблематику, предлагаемое решение, анализировать конкурентов, формулировать уникальное ценностное предложение (UVP) и общую бизнес-модель.

ВАЖНЫЕ ПРАВИЛА ВЗАИМОДЕЙСТВИЯ:
1. ДЕТАЛИЗАЦИЯ ПО ТЕМЕ: На любые вопросы, напрямую связанные с валидацией, концепцией и анализом идеи, отвечай максимально подробно, глубоко и структурированно. Задавай наводящие вопросы для улучшения идеи.
2. ЖЕСТКИЕ ГРАНИЦЫ: В нашей системе есть отдельные функции для "Расчета Юнит-экономики" и "Анализа Целевой Аудитории (ЦА)". Если запрос пользователя касается этих тем или других вопросов вне "Анализа идеи", дай ПРЕДЕЛЬНО КРАТКИЙ ответ (1-2 предложения максимум) и вежливо направь его использовать соответствующий раздел сайта для глубокого анализа. Не делай финансовых расчетов и не расписывай детальные портреты ЦА в этом чате.""",

    "target_audience": """Ты — опытный маркетолог-исследователь и product-менеджер. 
Твоя текущая роль и единственная функция в этом чате: **Анализ целевой аудитории (ЦА)**.

Твоя задача: помогать пользователю сегментировать рынок, составлять подробные, глубокие портреты пользователей, выявлять их боли, потребности, страхи, JTBD (Job-to-be-Done) и поведенческие паттерны.

ВАЖНЫЕ ПРАВИЛА ВЗАИМОДЕЙСТВИЯ:
1. ДЕТАЛИЗАЦИЯ ПО ТЕМЕ: На любые вопросы, связанные с пользователями, мотивацией покупок, сегментацией (B2B/B2C) и психографикой, отвечай максимально подробно. Разворачивай каждый портрет в деталях с инсайтами.
2. ЖЕСТКИЕ ГРАНИЦЫ: В нашей системе есть отдельные функции для "Анализа идеи" (оценка концепции продукта) и "Расчета Юнит-экономики" (финансовых метрик). Если запрос пользователя касается финансов (расчет метрик CAC/LTV), технической валидации идеи или других тем вне ЦА, дай ПРЕДЕЛЬНО КРАТКИЙ ответ (1-2 предложения максимум) и вежливо направь его использовать соответствующий раздел сайта для глубокого анализа. Не делай финансовых расчетов в этом чате.""",

    "unit_economics": """Ты — финансовый директор (CFO) и эксперт по стартап-метрикам. 
Твоя текущая роль и единственная функция в этом чате: **Расчет юнит-экономики**.

Твоя задача: помогать пользователю строить финансовую модель, рассчитывать ключевые метрики (CAC, LTV, ARPU, ARPPU, Margin, ROI, CPA и т.д.), оценивать точку безубыточности, анализировать постоянные/переменные расходы и доходы.

ВАЖНЫЕ ПРАВИЛА ВЗАИМОДЕЙСТВИЯ:
1. ДЕТАЛИЗАЦИЯ ПО ТЕМЕ: На вопросы, касающиеся расчетов, финансов, ценообразования и метрик, отвечай максимально подробно. Приводи формулы, пошаговые вычисления и развернутые объяснения математических моделей.
2. ЖЕСТКИЕ ГРАНИЦЫ: В нашей системе есть отдельные функции для "Анализа идеи" и "Анализа Целевой Аудитории (ЦА)". Если запрос пользователя касается бизнес-концепции, маркетингового анализа сегментов ЦА или других общих бизнес-вопросов вне темы "Юнит-экономики", дай ПРЕДЕЛЬНО КРАТКИЙ ответ (1-2 предложения максимум) и вежливо направь его использовать соответствующий раздел сайта для глубокого анализа."""
}

FINANCE_PROMPT = """Ты — финансовый директор (CFO) и эксперт по стартап-метрикам. 
Твоя текущая роль: **Расчет юнит-экономики**.
Твоя задача: помогать пользователю строить финансовую модель, рассчитывать ключевые метрики, оценивать точку безубыточности.

ЖЕСТКИЕ ГРАНИЦЫ: Если текущий контекст узла (node_context) НЕ ОТНОСИТСЯ к финансам или экономике (например, это Анализ Идеи или Анализ ЦА), и пользователь задает вопросы не по теме узла, дай ПРЕДЕЛЬНО КРАТКИЙ ответ (1-2 предложения) и вежливо направь его в раздел Юнит-экономики.

Верни ответ в свободном стиле с пояснениями, но ОБЯЗАТЕЛЬНО включи JSON-блок в конце с обновленными метриками (если производил финансовые расчеты).

Контекст узла: {node_context}
Текущие метрики дерева: {tree_metrics}
Сообщение пользователя: {user_message}

В конце ответа добавь блок:
---JSON_START---
{{
  "metrics": {{ "field_name": value, ... }}
}}
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
        from models import ProjectTree
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
        
        system_prompt = f"{base_prompt} {node_context}Отвечай на русском языке. "
        if rag_context:
            system_prompt += f"\n\nИСПОЛЬЗУЙ СЛЕДУЮЩИЙ КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ ДЛЯ ОТВЕТА (это экспертные данные для рынка РФ):\n{rag_context}\n\n"
        
        system_prompt += "Сначала запиши свои мысли/размышления о запросе внутри тегов <thought>...</thought>, а затем дай итоговый ответ пользователю."
        
        chat_history = "\n".join([f"{m['role']}: {m['content']}" for m in history])
        prompt = f"История чата:\n{chat_history}\n\nПользователь: {user_message}"
        
        provider = os.getenv("PRIMARY_PROVIDER", "makura")
        if provider == "makura":
            async for chunk in stream_makura(system_prompt, prompt):
                yield chunk
        else:
            async for chunk in stream_makura(system_prompt, prompt):
                yield chunk

    async def _parse_thought_generator(self, generator):
        """Utility to split stream into thought and chunk JSONs."""
        inside_thought = False
        buffer = ""
        async for chunk in generator:
            if not chunk: continue
            # Pass through usage sentinel dicts without parsing
            if isinstance(chunk, dict):
                yield chunk
                continue
            buffer += chunk
            while True:
                if not inside_thought:
                    if "<thought>" in buffer:
                        pre, post = buffer.split("<thought>", 1)
                        if pre: yield json.dumps({"type": "chunk", "content": pre}) + "\n"
                        inside_thought = True
                        buffer = post
                    else:
                        if len(buffer) > 10:
                            to_yield = buffer[:-9]; buffer = buffer[-9:]
                            yield json.dumps({"type": "chunk", "content": to_yield}) + "\n"
                        break
                else:
                    if "</thought>" in buffer:
                        content, post = buffer.split("</thought>", 1)
                        yield json.dumps({"type": "thought", "content": content}) + "\n"
                        inside_thought = False
                        buffer = post
                    else:
                        if len(buffer) > 11:
                            to_yield = buffer[:-10]; buffer = buffer[-10:]
                            yield json.dumps({"type": "thought", "content": to_yield}) + "\n"
                        break
        if buffer:
            yield json.dumps({"type": "thought" if inside_thought else "chunk", "content": buffer}) + "\n"

    @observe(name="orchestrator_process_message")
    async def process_message(self, user_message: str, active_node_id: str = None, client_id: str = None, assistant_client_id: str = None, use_deep_search: bool = False, use_research: bool = False):
        """Main entry point for chat orchestration. Yields JSON chunks."""
        state = await self.load_state()
        history = await self.get_chat_history(node_id=active_node_id)
        
        # Identify intent and initial RAG context in parallel to save 1-3 seconds
        intent_task = asyncio.create_task(self._classify_intent(user_message, state, history, active_node_id))
        rag_task = asyncio.to_thread(rag.get_relevant_chunks, user_message, top_k=5)
        
        intent_data, initial_rag_chunks = await asyncio.gather(intent_task, rag_task)
        intent = intent_data.get('intent', 'chat')
        logger.info(f"Orchestrator: User intent classified as '{intent}'")

        reply_full = ""
        thoughts_full = ""
        model_used = "Makura (GLM-5)"
        enriched_data = {}
        sources_list = []
        usage_data = None  # Token usage tracking

        if langfuse_context:
            langfuse_context.update_current_observation(
                name=f"chat_orchestrator_{intent}",
                user_id=str(self.user_id),
                session_id=str(self.session_id),
                tags=[intent, "deep_search" if use_deep_search else "basic_search"]
            )

        try:
            if intent == "chat" or intent not in ["tree", "finance", "search", "legal", "presentation"]:
                # Use pre-fetched RAG context
                rag_context = "\n".join([c["text"] if isinstance(c, dict) else c for c in initial_rag_chunks[:3]])
                
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
                start_time = time.time()
                ttft = None
                async for json_chunk in self._parse_thought_generator(self._stream_chat(user_message, history, state, active_node_id, rag_context=rag_context)):
                    # Check for usage sentinel from stream_makura
                    if isinstance(json_chunk, dict) and "__usage__" in json_chunk:
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
            
            elif intent == "tree":
                reply_full, enriched_data = await self._handle_tree_edit(user_message, state, active_node_id)
                yield json.dumps({"type": "chunk", "content": reply_full}) + "\n"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
            
            elif intent == "search" or use_research:
                model_used = "Tavily/Agent"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
                
                start_time = time.time()
                ttft = None
                # Logic: Use search handler that yields chunks natively
                async for json_chunk in self._handle_search(user_message, use_deep_search or use_research, use_research):
                    if isinstance(json_chunk, dict) and "__usage__" in json_chunk:
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
                    data = json.loads(json_chunk.strip())
                    if data["type"] == "chunk":
                        reply_full += data.get("content", "")
                    yield json_chunk
            
            elif intent == "presentation":
                model_used = "Makura (Presentation Builder)"
                yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
                
                # Start showing generation UI quickly
                yield json.dumps({"type": "chunk", "content": "Начинаю сборку вашей презентации... Пожалуйста, подождите, это займет около 10-15 секунд.\n\n"}) + "\n"
                reply_full += "Начинаю сборку вашей презентации... Пожалуйста, подождите, это займет около 10-15 секунд.\n\n"
                
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
                async for chunk in self._stream_chat(user_message, history, state, active_node_id):
                    if isinstance(chunk, dict):
                        if "__usage__" in chunk:
                            usage_data = chunk["__usage__"]
                        continue
                    reply_full += chunk
                    yield json.dumps({"type": "chunk", "content": chunk}) + "\n"
                    
        finally:
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
        await self.add_chat_message("user", user_message, node_id=active_node_id, client_id=client_id)
        await self.add_chat_message("assistant", reply_full, thoughts=thoughts_full.strip() if thoughts_full else None, node_id=active_node_id, model_used=model_used, client_id=assistant_client_id, sources=sources_list)

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

    async def _classify_intent(self, user_message: str, state: dict, history: list, active_node_id: str) -> dict:
        """Determine what the user wants."""
        # Find active node info
        node_label = "Не выбран"
        node_type = "N/A"
        node_desc = ""
        for n in state.get("nodes", []):
            if n["id"] == active_node_id:
                node_label = n["label"]
                node_type = n.get("type", "core")
                node_desc = n.get("data", {}).get("description", "")
                break

        history_str = "\n".join([f"{m['role']}: {m['content'][:100]}" for m in history[-5:]])
        
        prompt = INTENT_RECOGNITION_PROMPT.format(
            node_label=node_label,
            node_type=node_type,
            node_desc=node_desc,
            chat_history=history_str,
            user_message=user_message
        )

        try:
            # For intent recognition, use YandexGPT Lite as it is the fastest
            folder_id = os.getenv("YC_FOLDER_ID")
            lite_model_uri = f"gpt://{folder_id}/yandexgpt-lite/latest" if folder_id else None
            
            reply, _ = await async_call_yandex_gpt(
                "Ты — диспетчер интентов.", 
                prompt,
                model_uri=lite_model_uri,
                timeout=10
            )
            
            if reply:
                data = self._extract_json_block(reply)
                return data
        except Exception as e:
            logger.error(f"Intent classification failed: {e}")
            
        return {"intent": "chat", "reason": "Default fallback"}

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
        """Handle legal questions via YandexGPT (specialized for RU law) + RAG."""
        from yandex_gpt_client import call_yandex_gpt
        
        system_prompt = "Ты — квалифицированный юрист по российскому законодательству. Отвечай на вопросы о налогах, праве и регистрации бизнеса в РФ."
        if rag_context:
            system_prompt += f"\nИспользуй следующие выдержки из нормативных документов для подготовки ответа:\n{rag_context}"
            
        try:
            reply, _ = call_yandex_gpt(system_prompt, user_message)
            return reply or "Юридический помощник временно недоступен."
        except Exception as e:
            logger.error(f"YandexGPT legal call failed: {e}")
            return "Извините, не удалось получить юридическую консультацию."

    async def _handle_tree_edit(self, user_message: str, state: dict, active_node_id: str = None) -> tuple[str, dict]:
        """Handle tree modifications via Makura (GLM-5)."""
        active_node = next((n for n in state.get("nodes", []) if n["id"] == active_node_id), None)
        node_context = f"Активный узел: {active_node['label']} (id: {active_node_id})" if active_node else ""
        
        prompt = (
            f"Пользователь хочет изменить дерево проекта. {node_context}. "
            f"Текущая структура: {json.dumps(state['nodes'])}. "
            f"Запрос: {user_message}. "
            "Твоя задача — извлечь изменения. Если пользователь хочет ПРОПУСТИТЬ шаг, верни {'node_id': '...', 'status': 'skipped'}. "
            "Если пользователь дает данные, верни их в формате extracted_data: { field_name: value }."
            "Верни СТРОГО JSON."
        )
        provider = os.getenv("PRIMARY_PROVIDER", "makura")
        if provider == "makura":
            raw, _, _ = await call_makura("Ты — бизнес-аналитик. Извлекай данные СТРОГО в формате JSON.", prompt)
        else:
            raw, _, _ = await call_makura("Ты — бизнес-аналитик. Извлекай данные СТРОГО в формате JSON.", prompt)
            
        extracted = self._extract_json_block(raw)
        return "Я обновил структуру проекта на основе ваших пожеланий.", extracted

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
            "Верни СТРОГО JSON-массив из 5-10 объектов. Ничего кроме JSON возвращать не нужно.\n"
            "Допустимые 'type' слайдов: 'Hero', 'Problem', 'Solution', 'Market', 'BusinessModel', 'Team', 'CallToAction'.\n"
            "У каждого слайда должны быть поля 'title', 'content', и (если применимо) 'subtitle'. 'content' можно делать массивом строк.\n"
            "Пример ответа:\n"
            "[\n"
            "  {\"type\": \"Hero\", \"title\": \"AppName\", \"subtitle\": \"Слоган...\", \"content\": \"Доп инфо\"},\n"
            "  {\"type\": \"Problem\", \"title\": \"Проблема\", \"content\": [\"Боль 1\", \"Боль 2\"]}\n"
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
    def _extract_json_block(self, text: str) -> dict:
        """Utility to extract JSON from AI response wrapped in markdown or tags."""
        try:
            if "---JSON_START---" in text:
                content = text.split("---JSON_START---")[1].split("---JSON_END---")[0].strip()
                return json.loads(content)
            
            if "```json" in text:
                content = text.split("```json")[1].split("```")[0].strip()
                return json.loads(content)
            
            start = text.find('{')
            end = text.rfind('}')
            if start != -1 and end != -1:
                return json.loads(text[start:end+1])
        except Exception as e:
            logger.warning(f"Failed to extract JSON from TEXT: {e}")
        return {}
