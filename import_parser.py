import re
import json
import logging
from typing import Optional
from schemas import ProjectContext
from makura_client import call_makura

logger = logging.getLogger("app")

class ImportParser:
    """
    Utility to parse imported chat contexts.
    Attempts to extract JSON locally, then falls back to an LLM.
    """
    
    SYSTEM_PROMPT = """Ты — опытный бизнес-аналитик Pitchy.
Твоя задача — проанализировать историю переписки или сырой текст и извлечь структурированную информацию о стартапе.
Верни результат СТРОГО в формате JSON без markdown и пояснений. 
Если какой-то информации нет в тексте, используй null или пустой список.
Ожидаемая структура:
{
  "project_name": "Название проекта (если есть)",
  "problem": "Какую проблему решает",
  "solution": "Как именно решает (суть решения)",
  "target_audience": "Кто целевая аудитория",
  "features": ["Ключевая функция 1", "Функция 2"]
}"""

    @classmethod
    async def parse(cls, raw_text: str) -> tuple[Optional[ProjectContext], str]:
        """
        Parses raw text. Returns (ProjectContext, default_message_if_none).
        """
        # 1. Try to extract JSON directly via Regex
        extracted = cls._extract_json(raw_text)
        
        # 2. Fallback to LLM
        if not extracted:
            logger.info("ImportParser: Valid JSON not found, falling back to LLM.")
            try:
                ai_reply, _, _ = await call_makura(
                    system_prompt=cls.SYSTEM_PROMPT,
                    user_message=f"Извлеки данные из следующего текста:\n\n{raw_text}"
                )
                if ai_reply:
                    extracted = cls._extract_json(ai_reply)
            except Exception as e:
                logger.error(f"ImportParser: LLM fallback failed - {e}")
        
        # 3. Create model
        if extracted:
            try:
                if isinstance(extracted, dict):
                    context = ProjectContext(**extracted)
                    context.raw_text = raw_text # Store original text for RAG
                    return context, "Успешно разобрано."
            except Exception as e:
                logger.error(f"ImportParser: Validation failed - {e}")
                
        # Even if extraction failed, we keep the raw text to save it to RAG
        fallback_context = ProjectContext(raw_text=raw_text)
        return fallback_context, "Структурированные данные не найдены, но полный текст сохранен в базу знаний проекта."

    @staticmethod
    def _extract_json(text: str) -> Optional[dict]:
        try:
            # Match content between ```json and ```
            match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
            if match:
                return json.loads(match.group(1))
            
            # Match any curly braces pattern
            match = re.search(r"(\{.*?\})", text, re.DOTALL)
            if match:
                return json.loads(match.group(1))
        except Exception:
            pass
        return None
