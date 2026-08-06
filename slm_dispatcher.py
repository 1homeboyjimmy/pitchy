import os
import json
import logging
import re
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

# Режимы ответа основного чата. Разделение нужно, чтобы справочный вопрос
# («сколько сейчас МСП в РФ») не проходил через рамку разбора проекта и не
# упирался в «мне не хватает данных о вашем бизнесе».
CHAT_MODE_FACT = "fact"        # факт, цифра, определение, перечень
CHAT_MODE_CONSULT = "consult"  # совет, подход, объяснение «как делать»
CHAT_MODE_REVIEW = "review"    # критический разбор проекта пользователя
CHAT_MODES = (CHAT_MODE_FACT, CHAT_MODE_CONSULT, CHAT_MODE_REVIEW)

# «Мой/наш проект» — сигнал, что речь о бизнесе пользователя, а не о рынке
# вообще. Без него вопрос со словом «сколько» почти всегда справочный.
_OWN_PROJECT_RE = re.compile(
    r"\b(мо[йяеёюи]\w*|наш\w*|у меня|у нас|мне|нам|нас)\b.{0,40}"
    r"(проект|стартап|иде[яию]|продукт|бизнес|компани|сервис|приложени|метрик|экономик|команд|питч|презентац)"
    r"|(проект|стартап|иде[яию]|продукт|бизнес|компани|сервис|приложени|метрик|экономик|команд|питч|презентац)\w*"
    r".{0,20}\b(мо[йяеёюи]\w*|наш\w*)",
    re.IGNORECASE | re.UNICODE,
)

# Прямая просьба оценить/разобрать.
_REVIEW_VERB_RE = re.compile(
    r"\b(оцени|оценит[ье]|разбер[ии]|разобрат[ь]|критик|покритик|проанализируй|"
    r"что дума[ею]шь|что скажешь|как теб[еи]|найди слабы|найди дыр|"
    r"стоит ли (мне|нам)|взлетит|жизнеспособн)",
    re.IGNORECASE | re.UNICODE,
)

# Справочные зачины. Проверяем начало запроса: «сколько сейчас МСП в РФ»,
# «что такое CAC», «какие гранты есть для IT».
_FACT_START_RE = re.compile(
    r"^\W*(скольк|что тако|кто тако|что значит|что означает|как[оа][йея]\s+(объ[её]м|размер|доля|ставка|курс|срок)|"
    r"когда\s|где\s|назови|перечисли|дай список|каки[ем]\s+(есть|существуют|бывают|гранты|льготы|программы|законы))",
    re.IGNORECASE | re.UNICODE,
)


def resolve_chat_mode(
    query: str,
    slm_mode: Optional[str] = None,
    has_attachments: bool = False,
) -> str:
    """Итоговый режим ответа: эвристики поверх решения SLM.

    Чистая функция без сети — эвристики страхуют классификатор, когда тот
    недоступен или ошибся. Порядок: явная просьба разобрать проект → явно
    справочный зачин → мнение SLM → consult (нейтральный дефолт, который
    ничего не требует от пользователя).
    """
    text = (query or "").strip()
    if not text:
        return slm_mode if slm_mode in CHAT_MODES else CHAT_MODE_CONSULT

    about_own_project = bool(_OWN_PROJECT_RE.search(text))
    asks_for_review = bool(_REVIEW_VERB_RE.search(text))

    # «Оцени мою идею», «разбери нашу экономику», а также «разбери» с
    # приложенным файлом — это всегда разбор.
    if asks_for_review and (about_own_project or has_attachments):
        return CHAT_MODE_REVIEW

    # Справочный зачин без упоминания своего бизнеса — факт, даже если SLM
    # решил иначе: это как раз тот случай, который ломался.
    if _FACT_START_RE.search(text) and not about_own_project and not asks_for_review:
        return CHAT_MODE_FACT

    if slm_mode in CHAT_MODES:
        return slm_mode

    return CHAT_MODE_REVIEW if (about_own_project and asks_for_review) else CHAT_MODE_CONSULT


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
        # qwen/qwen3-30b-a3b: MoE, ~750ms p50 on RouterAI, supports JSON mode.
        # The older `qwen/qwen-2.5-7b-instruct` is upstream-rejected when
        # response_format=json_object is requested (Provider error 400),
        # which is the entire reason we use SLM here — so don't fall back.
        self.model = os.getenv("SLM_MODEL", "qwen/qwen3-30b-a3b")
        
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
            
            # Robust JSON extraction. The SLM occasionally returns a JSON
            # primitive (number, string, list) even with response_format=
            # json_object — callers then do data.get(...) which blows up
            # with "'float' object has no attribute 'get'". Enforce dict
            # here so every call site can safely use .get().
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                start = content.find("{")
                end = content.rfind("}")
                if start == -1 or end == -1:
                    raise
                parsed = json.loads(content[start:end+1])
            return parsed if isinstance(parsed, dict) else {}
        except Exception as e:
            logger.error(f"SLM call failed: {e}. Raw content: {content}")
            return {}

    @observe(name="classify_query_intent")
    async def classify_query_intent(self, query: str) -> Dict[str, Any]:
        """Determines RAG categories, web search requirement, finance context
        and the answer mode (fact / consult / review)."""
        system_prompt = (
            "You are a routing assistant. Determine the most relevant categories for the user's query.\n"
            "Categories: market_analysis, target_audience, unit_economics, pitching_tips, grants_and_funds, legal_regulations, platform_manual.\n"
            "Also determine if a real-time web search is required (`is_deep_search`).\n"
            "And determine if the query relates to finance/unit economics (`is_finance`).\n"
            "Finally determine the answer `mode`:\n"
            "  - \"fact\": the user wants a fact, a number, a definition or a list of "
            "existing things (market size, statistics, what a term means, which grants exist). "
            "Nothing about their own business is being evaluated.\n"
            "  - \"consult\": the user wants advice, an approach or an explanation of how to do "
            "something (how to acquire first users, which channel to pick, how to compute CAC).\n"
            "  - \"review\": the user asks to evaluate, critique or analyse THEIR OWN project, "
            "idea, numbers, pitch or documents.\n"
            "Return JSON: {\"categories\": [\"category1\", ...], \"is_deep_search\": false, "
            "\"is_finance\": false, \"mode\": \"fact\" | \"consult\" | \"review\"}"
        )
        data = await self._call_json(system_prompt, f"Query: {query}")
        mode = data.get("mode")
        return {
            "categories": data.get("categories", ["platform_manual"]),
            "is_deep_search": data.get("is_deep_search", False),
            "is_finance": data.get("is_finance", False),
            "mode": mode if mode in CHAT_MODES else None,
        }

    @observe(name="detect_search_intent")
    async def detect_search_intent(self, query: str) -> Dict[str, Any]:
        """Determines if a web search is required for the given query."""
        system_prompt = (
            "You are a search assistant. Determine if a real-time web search is required to answer the query accurately.\n"
            "Return JSON: {\"needs_search\": true/false, \"search_query\": \"refined search query\"}"
        )
        data = await self._call_json(system_prompt, f"Query: {query}")
        return {
            "needs_search": data.get("needs_search", False),
            "search_query": data.get("search_query", query)
        }

    @observe(name="extract_project_facts")
    async def extract_project_facts(self, user_text: str, assistant_text: str) -> Dict[str, Any]:
        """Извлекает из одной пары реплик (user+assistant) устойчивые факты о
        проекте для активной памяти паспорта.

        Возвращает:
          {
            "facts": [{"kind": "fact|decision|metric|risk|persona",
                       "content": "...", "confidence": 0.0-1.0}],
            "passport": {"core.problem": "...", "metrics.mrr": 200000}  # плоская карта
          }

        Жёсткие правила в промпте: только факты о ПРОЕКТЕ (не о платформе, не
        болтовня), короткие формулировки, пустой результат — это норма.
        """
        system_prompt = (
            "Ты извлекаешь устойчивые факты о СТАРТАП-ПРОЕКТЕ пользователя из диалога "
            "для долговременной памяти. Извлекай ТОЛЬКО конкретику о самом проекте: "
            "проблема, решение, аудитория, бизнес-модель, метрики, конкуренты, риски, "
            "решения команды, персоны custdev, юр. форма.\n"
            "НЕ извлекай: вопросы пользователя, рассуждения ассистента, общие советы, "
            "инструкции по платформе, вежливость. Если фактов нет — верни пустые списки.\n"
            "Формулируй факты коротко (одна фраза), на русском.\n"
            "Для passport используй плоские ключи из набора: "
            "core.name, core.problem, core.solution, core.target_audience, core.stage, "
            "core.business_model, core.geo, market.size, metrics.mrr, metrics.users, "
            "metrics.cac, legal.entity_type. Заполняй passport-ключ только если значение "
            "явно и уверенно прозвучало.\n"
            "Верни JSON: {\"facts\": [{\"kind\": \"fact\", \"content\": \"...\", "
            "\"confidence\": 0.8}], \"passport\": {\"core.problem\": \"...\"}}"
        )
        user_prompt = (
            f"СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:\n{user_text[:2000]}\n\n"
            f"ОТВЕТ АССИСТЕНТА:\n{assistant_text[:2000]}"
        )
        data = await self._call_json(system_prompt, user_prompt)
        facts = data.get("facts") or []
        passport = data.get("passport") or {}
        # Защита от мусора: оставляем только валидные записи.
        clean_facts = []
        allowed_kinds = {"fact", "decision", "metric", "risk", "persona"}
        for f in facts if isinstance(facts, list) else []:
            if not isinstance(f, dict):
                continue
            content = (f.get("content") or "").strip()
            if not content:
                continue
            kind = f.get("kind") if f.get("kind") in allowed_kinds else "fact"
            try:
                conf = float(f.get("confidence", 0.5))
            except (TypeError, ValueError):
                conf = 0.5
            clean_facts.append({"kind": kind, "content": content[:500],
                                "confidence": max(0.0, min(1.0, conf))})
        clean_passport = passport if isinstance(passport, dict) else {}
        return {"facts": clean_facts[:5], "passport": clean_passport}

    @observe(name="draft_passport_from_idea")
    async def draft_passport_from_idea(self, idea: str) -> Dict[str, Any]:
        """Черновик паспорта из короткого описания идеи — для онбординга
        «2 минуты до матча».

        Возвращает {"name": str, "summary": str, "passport": {flat keys}}.
        Заполняет только то, что явно следует из описания; не выдумывает
        метрики и цифры. Все значения паспорта — строки (source=ai на стороне
        вызывающего, поэтому пользователь сможет их поправить).
        """
        system_prompt = (
            "Ты — аналитик стартапов. По короткому описанию идеи составь ЧЕРНОВИК "
            "паспорта проекта для подбора грантов. НЕ выдумывай метрики, выручку и "
            "цифры, которых нет в тексте — заполняй только то, что явно сказано или "
            "однозначно выводится.\n"
            "Ключи passport (плоские, значения — строки): core.name, core.problem, "
            "core.solution, core.target_audience, core.stage, core.business_model, "
            "core.geo, market.size, legal.entity_type.\n"
            "core.stage выбери из: идея, прототип, первые продажи, рост. "
            "core.geo по умолчанию 'Россия', если не указано иное.\n"
            "Также верни: name — короткое название (2–4 слова); summary — 2–3 "
            "предложения: что это, сильная сторона и на что обратить внимание при "
            "подаче на гранты. Всё на русском.\n"
            "Верни JSON: {\"name\": \"...\", \"summary\": \"...\", "
            "\"passport\": {\"core.problem\": \"...\"}}"
        )
        data = await self._call_json(system_prompt, f"ОПИСАНИЕ ИДЕИ:\n{idea[:3000]}")
        name = (data.get("name") or "").strip()
        summary = (data.get("summary") or "").strip()
        raw = data.get("passport")
        passport = raw if isinstance(raw, dict) else {}
        allowed = {
            "core.name", "core.problem", "core.solution", "core.target_audience",
            "core.stage", "core.business_model", "core.geo", "market.size",
            "legal.entity_type",
        }
        clean: Dict[str, Any] = {}
        for k, v in passport.items():
            if k in allowed and isinstance(v, str) and v.strip():
                clean[k] = v.strip()[:1000]
        return {"name": name[:120], "summary": summary[:600], "passport": clean}

    @observe(name="generate_chat_title")
    async def generate_chat_title(self, context_text: str) -> str:
        """Название чата по репликам пользователя — как в Claude/ChatGPT.

        `context_text` — либо одна первая реплика, либо дайджест реплик,
        разделённых '---' (см. _build_chat_title_context в main.py).

        Возвращает "" при сбое SLM или когда внятной темы нет: вызывающий код
        в этом случае оставляет текущее название, и генерация повторится со
        следующей репликой пользователя.
        """
        if len((context_text or "").strip()) < 10:
            # Одно «привет» темы не задаёт — SLM дёргать не за чем.
            return ""
        system_prompt = (
            "Придумай название чата по репликам пользователя — как автоназвания "
            "диалогов в Claude или ChatGPT. Реплики разделены '---': первая — "
            "с чего начали, последние — что обсуждают сейчас.\n"
            "Правила:\n"
            "- 3-6 слов: конкретный предмет разговора и задача/вопрос по нему\n"
            "- сохраняй ключевые термины, аббревиатуры (ФОТ, CAC, MVP…), "
            "названия компаний и города из реплик — они и делают название узнаваемым\n"
            "- если реплики о разном, называй по теме, к которой пришёл разговор\n"
            "- тот же язык, что у реплик (обычно русский)\n"
            "- никаких размытых слов: «пример», «информация», «помощь», «отчёт», "
            "«вопрос», «обсуждение», «работа», «данные» — если это не сам предмет разговора\n"
            "- без кавычек, эмодзи и точки в конце\n"
            "Хорошие названия: «ФОТ кофейни в Казани», «Юнит-экономика доставки еды», "
            "«Питч-дек для посевного раунда», «Регистрация ООО для маркетплейса».\n"
            "Плохие названия: «Пример бизнеса», «Помощь с проектом», «Отчёт по работе».\n"
            "Если внятной темы нет (приветствие, пара слов ни о чём) — верни null.\n"
            "Верни JSON: {\"title\": \"...\"} или {\"title\": null}"
        )
        data = await self._call_json(system_prompt, f"Реплики пользователя:\n{context_text[:2000]}")
        raw = data.get("title")
        title = raw.strip() if isinstance(raw, str) else ""
        # SLM иногда оборачивает название в кавычки или добавляет точку.
        title = title.strip("\"'«»").rstrip(".").strip()
        if title.lower() in ("null", "none"):
            return ""
        return title[:80]

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

    @observe(name="extract_event_details")
    async def extract_event_details(self, source_text: str, aggregator_text: str = "") -> Dict[str, Any]:
        """Extract rich event fields from a canonical page with aggregator fallback.

        This intentionally lives in the SLM layer: the task is bounded JSON
        extraction, not open-ended synthesis. Callers must still validate URLs
        and prefer deterministic values parsed from the aggregator HTML.
        """
        system_prompt = (
            "Ты извлекаешь факты о мероприятии из двух документов. Первый — "
            "официальный первоисточник, второй — карточка агрегатора. Не выдумывай "
            "и не сокращай полезные детали. При конфликте предпочитай первоисточник. "
            "Верни JSON: {\"organization\": string|null, \"description\": string|null, "
            "\"event_format\": \"online\"|\"offline\"|\"hybrid\"|null, "
            "\"location\": string|null, \"agenda\": [string], "
            "\"speakers\": [{\"name\": string, \"role\": string|null, "
            "\"organization\": string|null, \"bio\": string|null}], "
            "\"participation_terms\": string|null, \"registration_url\": string|null}. "
            "Описание должно сохранять суть, аудиторию и пользу; пункты программы "
            "возвращай раздельно. Только факты из документов."
        )
        user_prompt = (
            f"ПЕРВОИСТОЧНИК:\n{source_text[:14000]}\n\n"
            f"КАРТОЧКА АГРЕГАТОРА:\n{aggregator_text[:8000]}"
        )
        return await self._call_json(system_prompt, user_prompt)

slm_dispatcher = SLMClient()
