import json
import logging
import copy
from typing import Any, Optional
from datetime import datetime

from redis_client import get_redis
from routerai_client import call_routerai, stream_routerai
from makura_client import call_makura, stream_makura
from tree_orchestrator import _normalize_tree_data
from search_agent import execute_search_agent
from yandex_gpt_client import async_call_yandex_gpt
from core_tree import CORE_SKELETON
from models import TreeChatHistory

logger = logging.getLogger("app")

INTENT_RECOGNITION_PROMPT = """Ты — диспетчер запросов для бизнес-платформы Pitchy.
Проанализируй запрос пользователя на основе контекста активного узла и истории чата.
Выдели один из следующих интентов:
1. 'finance' — расчет юнит-экономики, LTV, CAC, выручки, объемов рынка (TAM/SAM/SOM).
2. 'search' — поиск внешней информации, конкурентов на рынке, трендов, новостей.
3. 'tree' — изменение структуры проекта, добавление новых гипотез, пересмотр бизнес-модели, ПРОПУСК текущего шага или переход к следующему.
4. 'chat' — общие вопросы, объяснение терминов, дружелюбное общение или уточнение деталей (с учетом активного узла).

Активный узел: {node_label} (тип: {node_type}, описание: {node_desc})
История чата (последние сообщения):
{chat_history}

Запрос пользователя: "{user_message}"

Верни СТРОГО JSON: {{"intent": "finance" | "search" | "tree" | "chat" | "legal", "reason": "краткое пояснение"}}
Используй "legal" для вопросов о российском законодательстве, налогах РФ, ООО/ИП и нормативных требованиях.
"""

FINANCE_PROMPT = """Ты — финансовый эксперт GigaChat. Произведи расчеты для стартапа на основе предоставленных данных.
Верни ответ в свободном стиле с пояснениями, но ОБЯЗАТЕЛЬНО включи JSON-блок в конце с обновленными метриками.

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
        """Get recent chat history from Redis."""
        if self.redis:
            chat_key = self._get_chat_key(node_id)
            history = self.redis.lrange(chat_key, 0, limit - 1)
            return [json.loads(m) for m in history][::-1] # Reverse to chronological
        return []

    async def add_chat_message(self, role: str, content: str, node_id: Optional[str] = None, model_used: str = None, client_id: str = None):
        """Add message to Redis list and PostgreSQL."""
        msg = {
            "role": role,
            "content": content,
            "model_used": model_used,
            "timestamp": datetime.now().isoformat(),
            "client_id": client_id
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
                    model_used=model_used,
                    client_id=client_id
                )
                self.db.add(db_msg)
                self.db.commit()
            except Exception as e:
                logger.error(f"Failed to save TreeChatHistory to SQL: {e}")
                self.db.rollback()

    async def _stream_chat(self, user_message: str, history: list, state: dict, active_node_id: str | None):
        """Core streaming logic for chat with thoughts."""
        node_context = ""
        active_node = next((n for n in state.get("nodes", []) if n["id"] == active_node_id), None)
        if active_node:
             node_context = f"Ты сейчас помогаешь пользователю в контексте узла '{active_node.get('label')}' (описание: {active_node.get('data', {}).get('description')}). "
        
        system_prompt = f"Ты — ассистент платформы Pitchy. {node_context}Отвечай на русском языке. Сначала запиши свои мысли/размышления о запросе внутри тегов <thought>...</thought>, а затем дай итоговый ответ пользователю."
        
        chat_history = "\n".join([f"{m['role']}: {m['content']}" for m in history])
        prompt = f"История чата:\n{chat_history}\n\nПользователь: {user_message}"
        
        provider = os.getenv("PRIMARY_PROVIDER", "routerai")
        if provider == "makura":
            async for chunk in stream_makura(system_prompt, prompt):
                yield chunk
        else:
            async for chunk in stream_routerai(system_prompt, prompt):
                yield chunk

    async def _parse_thought_generator(self, generator):
        """Utility to split stream into thought and chunk JSONs."""
        inside_thought = False
        buffer = ""
        async for chunk in generator:
            if not chunk: continue
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

    async def process_message(self, user_message: str, active_node_id: str = None, client_id: str = None, assistant_client_id: str = None):
        """Main entry point for chat orchestration. Yields JSON chunks."""
        state = await self.load_state()
        history = await self.get_chat_history(node_id=active_node_id)
        
        intent_data = await self._classify_intent(user_message, state, history, active_node_id)
        intent = intent_data.get('intent', 'chat')
        logger.info(f"Orchestrator: User intent classified as '{intent}'")

        reply_full = ""
        model_used = "RouterAI (GLM-5)"
        enriched_data = {}

        if intent == "chat" or intent not in ["tree", "finance", "search", "legal"]:
            yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
            async for json_chunk in self._parse_thought_generator(self._stream_chat(user_message, history, state, active_node_id)):
                data = json.loads(json_chunk.strip())
                if data["type"] == "chunk": reply_full += data["content"]
                yield json_chunk
        
        elif intent == "tree":
            reply_full, enriched_data = await self._handle_tree_edit(user_message, state, active_node_id)
            yield json.dumps({"type": "chunk", "content": reply_full}) + "\n"
            yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
        
        elif intent == "search":
            model_used = "Perplexity/Agent"
            reply_full = await self._handle_search(user_message)
            yield json.dumps({"type": "chunk", "content": reply_full}) + "\n"
            yield json.dumps({"type": "metadata", "model": model_used}) + "\n"

        elif intent == "legal":
            model_used = "YandexGPT (Юрист)"
            reply_full = await self._handle_legal(user_message)
            yield json.dumps({"type": "chunk", "content": reply_full}) + "\n"
            yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
        
        elif intent == "finance":
            model_used = "GigaChat"
            reply_full, enriched_data = await self._handle_finance(user_message, state, active_node_id)
            yield json.dumps({"type": "chunk", "content": reply_full}) + "\n"
            yield json.dumps({"type": "metadata", "model": model_used}) + "\n"
        
        else:
            # Fallback
            async for chunk in self._stream_chat(user_message, history, state, active_node_id):
                reply_full += chunk
                yield json.dumps({"type": "chunk", "content": chunk}) + "\n"

        # 3. Merge state if AI returned structured data
        if enriched_data:
            state = self._merge_ai_data_to_state(state, enriched_data)
            await self.save_state(state)
            yield json.dumps({"type": "tree_update", "data": state}) + "\n"

        # 4. Finalize
        await self.add_chat_message("user", user_message, node_id=active_node_id, client_id=client_id)
        await self.add_chat_message("assistant", reply_full, node_id=active_node_id, model_used=model_used, client_id=assistant_client_id)

        # Final metadata
        yield json.dumps({
            "type": "final",
            "readiness_index": state.get("readiness_index", 0),
            "hints": self._get_hints(state, active_node_id)
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

    async def _handle_finance(self, user_message: str, state: dict, active_node_id: str) -> tuple[str, dict]:
        """Handle financial calculations via GigaChat."""
        node_info = next((n for n in state["nodes"] if n["id"] == active_node_id), {})
        tree_metrics = {} # Actually nodes inputs/outputs
        for n in state["nodes"]:
            for inp in n.get("data", {}).get("inputs", []):
                if inp.get("value"):
                    tree_metrics[inp["field"]] = inp["value"]

        prompt = FINANCE_PROMPT.format(
            node_context=json.dumps(node_info),
            tree_metrics=json.dumps(tree_metrics),
            user_message=user_message
        )

        raw = await _call_gigachat(prompt)
        if not raw:
            # Fallback to RouterAI for calculations if GigaChat fails or not configured
            raw, _ = await call_routerai("Ты — финансовый аналитик.", prompt)

        # Extract JSON metrics block
        reply = raw
        metrics = {}
        if "---JSON_START---" in raw:
            try:
                parts = raw.split("---JSON_START---")[1].split("---JSON_END---")
                metrics = json.loads(parts[0])["metrics"]
                reply = raw.split("---JSON_START---")[0].strip()
            except:
                pass
        
        return reply, metrics

    async def _handle_search(self, user_message: str) -> str:
        """Handle search queries via Perplexity or a local agent."""
        # Use Perplexity via RouterAI (Perplexity Sonar might be available, for now using GLM-5 as fallback or keeping ZAI for Perplexity if needed)
        # However, RouterAI also supports perplexity. Let's try to keep it consistent if RouterAI has sonar.
        # For now, let's keep search on call_zai if we are unsure about RouterAI sonar ID, or use GLM-5.
        # The user specifically mentioned GLM is faster on RouterAI.
        reply, _ = await call_routerai("Ты — эксперт по глубокому анализу рынков.", user_message)
        if reply:
            return reply

        # Fallback to local search agent
        context = execute_search_agent(user_message)
        prompt = f"На основе данных из поиска ответь пользователю на русском языке:\n\n{context}\n\nВопрос: {user_message}"
        reply, _ = await call_routerai("Ты — помощник с доступом в интернет.", prompt)
        return reply or "Не удалось обработать результаты поиска."

    async def _handle_legal(self, user_message: str) -> str:
        """Handle legal questions via YandexGPT (specialized for RU law)."""
        from yandex_gpt_client import call_yandex_gpt
        system_prompt = "Ты — квалифицированный юрист по российскому законодательству. Отвечай на вопросы о налогах, праве и регистрации бизнеса в РФ."
        try:
            reply, _ = call_yandex_gpt(system_prompt, user_message)
            return reply or "Юридический помощник временно недоступен."
        except Exception as e:
            logger.error(f"YandexGPT legal call failed: {e}")
            return "Извините, не удалось получить юридическую консультацию."

    async def _handle_tree_edit(self, user_message: str, state: dict, active_node_id: str = None) -> tuple[str, dict]:
        """Handle tree modifications via RouterAI (GLM-5)."""
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
        provider = os.getenv("PRIMARY_PROVIDER", "routerai")
        if provider == "makura":
            raw, _ = await call_makura("Ты — бизнес-аналитик. Извлекай данные СТРОГО в формате JSON.", prompt)
        else:
            raw, _ = await call_routerai("Ты — бизнес-аналитик. Извлекай данные СТРОГО в формате JSON.", prompt)
            
        extracted = self._extract_json_block(raw)
        return "Я обновил структуру проекта на основе ваших пожеланий.", extracted

    async def _handle_chat(self, user_message: str, chat_history: str = "", active_node: dict = None) -> str:
        """Handle general chat via RouterAI (GLM-5)."""
        node_context = ""
        if active_node:
            node_context = f"Ты сейчас помогаешь пользователю в контексте узла '{active_node.get('label')}' (описание: {active_node.get('data', {}).get('description')}). "
        
        system_prompt = f"Ты — ассистент платформы Pitchy. {node_context}Отвечай на русском языке. Сначала запиши свои мысли/размышления о запросе внутри тегов <thought>...</thought>, а затем дай итоговый ответ пользователю."
        prompt = f"История чата:\n{chat_history}\n\nПользователь: {user_message}"
        
        provider = os.getenv("PRIMARY_PROVIDER", "routerai")
        if provider == "makura":
            reply, json_metrics = await call_makura(system_prompt, prompt)
        else:
            reply, json_metrics = await call_routerai(system_prompt, prompt)
        
        if json_metrics:
            # Assuming _save_metrics_from_json is defined elsewhere or will be added
            # self._save_metrics_from_json(json_metrics) 
            pass # Placeholder as _save_metrics_from_json is not provided in the diff
            
        return reply or "Извините, сейчас я не могу ответить."

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
