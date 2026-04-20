import os
import json
import logging
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from dotenv import load_dotenv

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

    async def classify_query_intent(self, query: str) -> List[str]:
        """Determines which RAG collections to search based on user question."""
        system_prompt = (
            "You are a routing assistant. Determine the most relevant categories for the user's query.\n"
            "Categories: market_analysis, project_profiles, legal_regulations, pitching_tips, general.\n"
            "Return JSON: {\"categories\": [\"category1\", ...]}"
        )
        data = await self._call_json(system_prompt, f"Query: {query}")
        return data.get("categories", ["general"])

    async def detect_search_intent(self, query: str) -> bool:
        """Determines if a web search is required."""
        system_prompt = (
            "Decide if the query requires a real-time web search for fresh data.\n"
            "Return JSON: {\"requires_web\": true/false}"
        )
        data = await self._call_json(system_prompt, f"Query: {query}")
        return data.get("requires_web", False)

    async def generate_chat_title(self, first_message: str) -> str:
        """Generates a concise 2-4 word title for the chat."""
        system_prompt = (
            "Generate a short (2-4 words) Russian title for this chat based on the first message.\n"
            "Return JSON: {\"title\": \"...\"}"
        )
        data = await self._call_json(system_prompt, f"Message: {first_message}")
        return data.get("title", "Новый диалог")

    async def classify_chunks_batch(self, chunks: List[str]) -> List[str]:
        """Classifies a batch of document chunks for Smart Ingestion."""
        if not chunks:
            return []
            
        system_prompt = (
            "You are an expert document classifier. Categorize each provided text chunk into one of the following:\n"
            "1. market_analysis: Market trends, reports, statistics, industry data.\n"
            "2. project_profiles: Team bios, contact info, owner details, founder social links.\n"
            "3. legal_regulations: Laws, taxes, TOS, legal documents, regulations.\n"
            "4. pitching_tips: Unit economics, pitch deck advice, investor relations, methodology.\n"
            "5. general: General startup knowledge, generic advice.\n"
            "6. junk: Boilerplate, broken text, menus, footers, irrelevant spam.\n\n"
            "Return JSON: {\"results\": [\"category\", ...]} in the same order as input."
        )
        
        # Format chunks for the prompt
        user_prompt = "Classify these chunks:\n" + "\n---\n".join([f"{i}: {c[:300]}" for i, c in enumerate(chunks)])
        
        data = await self._call_json(system_prompt, user_prompt)
        results = data.get("results", [])
        
        # Pad with 'general' if SLM returns fewer results than chunks
        while len(results) < len(chunks):
            results.append("general")
            
        return results[:len(chunks)]

slm_dispatcher = SLMClient()
