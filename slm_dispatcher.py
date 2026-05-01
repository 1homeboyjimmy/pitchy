import os
import json
import logging
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from dotenv import load_dotenv

try:
    from langfuse.decorators import observe, langfuse_context
except ImportError:
    def observe(*args, **kwargs):
        return lambda f: f
    langfuse_context = None

load_dotenv()

logger = logging.getLogger("slm_dispatcher")

class SLMClient:
    """
    Unified client for Small Language Models (SLM) used for structural tasks:
    - RAG routing
    - Web search intent detection
    - Chat title generation
    - Chunk classification for Smart Ingestion
    """
    def __init__(self):
        api_key = os.getenv("ROUTERAI_API_KEY") or os.getenv("MAKURA_API_KEY")
        base_url = os.getenv("SLM_API_BASE", "https://routerai.ru/api/v1")
        self.model = os.getenv("SLM_MODEL", "qwen/qwen-2.5-7b-instruct")
        
        if not api_key:
            logger.warning("No API key found for SLM dispatcher (ROUTERAI_API_KEY or MAKURA_API_KEY)")
            
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )

    @observe(name="slm_call")
    async def _call_json(self, system_prompt: str, user_prompt: str) -> Dict[str, Any]:
        """Calls the SLM and enforces JSON response format."""
        content = None
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=1000
            )
            content = response.choices[0].message.content or ""
            
            # Robust JSON extraction
            try:
                # First try direct parse
                return json.loads(content)
            except json.JSONDecodeError:
                # Fallback: extract from text
                start = content.find("{")
                end = content.rfind("}")
                if start != -1 and end != -1:
                    return json.loads(content[start:end+1])
                raise
        except Exception as e:
            logger.error(f"SLM call failed: {e}. Raw content: {content}")
            return {}

    @observe(name="classify_query_intent")
    async def classify_query_intent(self, query: str) -> Dict[str, Any]:
        """Determines RAG categories, web search requirement, and finance context."""
        system_prompt = (
            "You are a routing assistant. Determine the most relevant categories for the user's query.\n"
            "Categories: market_analysis, target_audience, unit_economics, pitching_tips, grants_and_funds, legal_regulations, platform_manual.\n"
            "Also determine if a real-time web search is required (`is_deep_search`).\n"
            "And determine if the query relates to finance/unit economics (`is_finance`).\n"
            "Return JSON: {\"categories\": [\"category1\", ...], \"is_deep_search\": false, \"is_finance\": false}"
        )
        data = await self._call_json(system_prompt, f"Query: {query}")
        return {
            "categories": data.get("categories", ["platform_manual"]),
            "is_deep_search": data.get("is_deep_search", False),
            "is_finance": data.get("is_finance", False)
        }

    @observe(name="generate_chat_title")
    async def generate_chat_title(self, first_message: str) -> str:
        """Generates a concise 2-4 word title for the chat."""
        system_prompt = (
            "Generate a short (2-4 words) Russian title for this chat based on the first message.\n"
            "Return JSON: {\"title\": \"...\"}"
        )
        data = await self._call_json(system_prompt, f"Message: {first_message}")
        return data.get("title", "Новый диалог")

    @observe(name="classify_chunks_batch")
    async def classify_chunks_batch(self, chunks: List[str]) -> List[str]:
        """Classifies a batch of document chunks for Smart Ingestion."""
        if not chunks:
            return []
            
        system_prompt = (
            "You are an expert document classifier. Categorize each provided text chunk into one of the following:\n"
            "1. market_analysis: Сухие продуктовые метрики, описание проблемы и решения. Только факты.\n"
            "2. target_audience: ЦА, сегменты, CustDev.\n"
            "3. unit_economics: Новая база: финмодели, метрики CAC/LTV, формулы.\n"
            "4. pitching_tips: Структуры презентаций, выступления.\n"
            "5. grants_and_funds: Акселераторы, фонды, гранты.\n"
            "6. legal_regulations: Законы, налоги, оферты.\n"
            "7. platform_manual: Инструкции по платформе Pitchy и Интерактивной дорожной карте.\n"
            "8. junk: Юридическая вода в футерах, контакты, визитки людей, поиск партнеров, HR-объявления (найм), просьбы о фидбеке, призывы к сотрудничеству и любой нетворкинг.\n\n"
            "Return JSON: {\"results\": [\"category\", ...]} in the same order as input."
        )
        
        # Format chunks for the prompt
        user_prompt = "Classify these chunks:\n" + "\n---\n".join([f"{i}: {c[:300]}" for i, c in enumerate(chunks)])
        
        data = await self._call_json(system_prompt, user_prompt)
        results = data.get("results", [])
        
        # Pad with 'platform_manual' if SLM returns fewer results than chunks
        while len(results) < len(chunks):
            results.append("platform_manual")
            
        return results[:len(chunks)]

slm_dispatcher = SLMClient()
