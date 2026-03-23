import json
import logging
import copy
from typing import Any, Optional
from datetime import datetime

from redis_client import get_redis
from zai_client import call_zai
from tree_orchestrator import _call_claude, _call_gigachat, _normalize_tree_data
from search_agent import execute_search_agent
from perplexity_client import call_perplexity
from core_tree import CORE_SKELETON

logger = logging.getLogger("app")

INTENT_RECOGNITION_PROMPT = """Ты — диспетчер запросов для бизнес-платформы Pitchy.
Проанализируй запрос пользователя на основе контекста активного узла и истории чата.
Выдели один из следующих интентов:
1. 'finance' — расчет юнит-экономики, LTV, CAC, выручки, объемов рынка (TAM/SAM/SOM).
2. 'search' — поиск внешней информации, конкурентов на рынке, трендов, новостей.
3. 'tree' — изменение структуры проекта, добавление новых гипотез, пересмотр бизнес-модели.
4. 'chat' — общие вопросы, объяснение терминов, дружелюбное общение или уточнение деталей.

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
        self.chat_key = f"user:{user_id}:tree:{tree_id}:chat"

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

    async def get_chat_history(self, limit: int = 10) -> list:
        """Get recent chat history from Redis."""
        if self.redis:
            history = self.redis.lrange(self.chat_key, 0, limit - 1)
            return [json.loads(m) for m in history][::-1] # Reverse to chronological
        return []

    async def add_chat_message(self, role: str, content: str, model_used: str = None):
        """Add message to Redis list."""
        msg = {
            "role": role,
            "content": content,
            "model_used": model_used,
            "timestamp": datetime.utcnow().isoformat()
        }
        if self.redis:
            self.redis.lpush(self.chat_key, json.dumps(msg))
            self.redis.ltrim(self.chat_key, 0, 99) # Keep 100 messages

    async def process_message(self, user_message: str, active_node_id: str = None) -> dict:
        """Main entry point for chat orchestration."""
        state = await self.load_state()
        history = await self.get_chat_history()
        
        # 1. Intent Recognition (0.2s via YandexGPT or fast-path)
        intent = await self._classify_intent(user_message, state, history, active_node_id)
        logger.info(f"Orchestrator: User intent classified as '{intent['intent']}'")

        # 2. Route and Execute
        # Initialize result
        reply = ""
        model_used = ""
        enriched_data = {}

        if intent['intent'] == "finance":
            model_used = "GigaChat"
            reply, enriched_data = await self._handle_finance(user_message, state, active_node_id)
        elif intent['intent'] == "search":
            model_used = "Perplexity/Agent"
            reply = await self._handle_search(user_message)
        elif intent['intent'] == "legal":
            model_used = "YandexGPT (Юрист)"
            reply = await self._handle_legal(user_message)
        elif intent['intent'] == "tree":
            model_used = "Claude"
            reply, enriched_data = await self._handle_tree_edit(user_message, state)
        elif intent['intent'] == "chat": # chat
            model_used = "Z AI (GLM-5)"
            history_str = "\n".join([f"{m['role']}: {m['content']}" for m in history[-5:]])
            reply = await self._handle_chat(user_message, history_str)
        else:
            # Fallback for unhandled intents
            model_used = "Z AI (GLM-5)"
            history_str = "\n".join([f"{m['role']}: {m['content']}" for m in history[-5:]])
            reply = await self._handle_chat(user_message, history_str)


        # 3. Merge state if AI returned structured data
        if enriched_data:
            state = self._merge_ai_data_to_state(state, enriched_data)
            await self.save_state(state)

        # 4. Finalize
        await self.add_chat_message("user", user_message)
        await self.add_chat_message("assistant", reply, model_used)

        return {
            "reply": reply,
            "model": model_used,
            "tree_data": state,
            "readiness_index": state.get("readiness_index", 0),
            "hints": self._get_hints(state, active_node_id)
        }

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
            # Quick classification using Z AI
            reply, _ = await call_zai("Ты — диспетчер интентов.", prompt)
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
            # Fallback to Z AI for calculations if GigaChat fails or not configured
            raw, _ = await call_zai("Ты — финансовый аналитик.", prompt)

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
        # Use Perplexity via Zveno
        reply, _ = await call_zai("Ты — эксперт по глубокому анализу рынков.", user_message, model="perplexity/sonar-pro")
        if reply:
            return reply

        # Fallback to local search agent
        context = execute_search_agent(user_message)
        prompt = f"На основе данных из поиска ответь пользователю на русском языке:\n\n{context}\n\nВопрос: {user_message}"
        reply, _ = await call_zai("Ты — помощник с доступом в интернет.", prompt, model="zhipu/glm-4")
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

    async def _handle_tree_edit(self, user_message: str, state: dict) -> tuple[str, dict]:
        """Handle tree modifications via Claude."""
        # Reuse _normalize_tree_data logic but in enrichment mode
        prompt = f"Пользователь хочет изменить дерево проекта. Текущее дерево: {json.dumps(state['nodes'])}. Запрос: {user_message}. Верни JSON только с измененными полями в формате extracted_data: {{ ключ: значение }}."
        raw = await _call_claude(prompt)
        extracted = self._extract_json_block(raw)
        return "Я обновил структуру проекта на основе ваших пожеланий.", extracted.get("extracted_data", {})

    async def _handle_chat(self, user_message: str, chat_history: str = "") -> str:
        """Handle general chat via Z AI (GLM-5)."""
        prompt = f"История чата:\n{chat_history}\n\nПользователь: {user_message}"
        # Using zhipu/glm-4 as a standard name, or zhipu/glm-5 if confirmed
        reply, json_metrics = await call_zai("Ты — ассистент платформы Pitchy. Отвечай на русском языке.", prompt, model="zhipu/glm-4")
        
        if json_metrics:
            # Assuming _save_metrics_from_json is defined elsewhere or will be added
            # self._save_metrics_from_json(json_metrics) 
            pass # Placeholder as _save_metrics_from_json is not provided in the diff
            
        return reply or "Извините, Z AI сейчас недоступен."

    def _merge_ai_data_to_state(self, state: dict, enriched_data: dict) -> dict:
        """Update existing nodes with new values from AI."""
        # Reuse _normalize_tree_data-like logic
        nodes = state["nodes"]
        for node in nodes:
            inputs = node.get("data", {}).get("inputs", [])
            for inp in inputs:
                field = inp.get("field")
                if field in enriched_data:
                    inp["value"] = enriched_data[field]
                    inp["status"] = "completed"
        
        # Recalculate readiness
        total = len(nodes)
        completed = sum(1 for n in nodes if n.get("status") == "completed")
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
