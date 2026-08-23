from contextlib import asynccontextmanager
from typing import Any
import asyncio
import json
import os
import logging
import time
import random
import secrets
from datetime import datetime, timedelta, date, timezone

import urllib.parse
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile, File, BackgroundTasks, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.responses import StreamingResponse, FileResponse
from sse_starlette.sse import EventSourceResponse

def format_sse(data) -> dict:
    if isinstance(data, dict):
        return {"event": data.get("type", "message"), "data": json.dumps(data, ensure_ascii=False)}
    return {"event": "message", "data": json.dumps(data, ensure_ascii=False)}


async def _with_heartbeat(gen, interval: float = 5.0):
    """Wrap an SSE generator and inject ping events when no data flows for `interval` seconds.

    Keeps the frontend 20s watchdog alive during slow upstream operations
    (LLM TTFB, deep research, swarm processing) without requiring every
    callsite to remember to emit pings. The ping is a real `data:` event
    (not an SSE comment), so it reaches the frontend's `for await` loop
    and resets the watchdog. The frontend already skips `type === "ping"`.
    """
    import asyncio as _asyncio
    queue: _asyncio.Queue = _asyncio.Queue()

    async def _pump():
        try:
            async for item in gen:
                await queue.put(("item", item))
        except BaseException as exc:
            await queue.put(("error", exc))
            return
        await queue.put(("done", None))

    task = _asyncio.create_task(_pump())
    try:
        while True:
            try:
                kind, payload = await _asyncio.wait_for(queue.get(), timeout=interval)
            except _asyncio.TimeoutError:
                yield format_sse({"type": "ping"})
                continue
            if kind == "done":
                return
            if kind == "error":
                raise payload
            yield payload
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except BaseException:
                pass

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.concurrency import run_in_threadpool
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, EmailStr, Field, ValidationError
from sqlalchemy.orm import Session
from sqlalchemy import text
from dotenv import load_dotenv
load_dotenv()

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=1.0,
        profiles_sample_rate=1.0,
        environment=os.getenv("APP_ENV", "production"),
    )

if os.getenv("LANGFUSE_BASE_URL") and not os.getenv("LANGFUSE_HOST"):
    os.environ["LANGFUSE_HOST"] = os.environ["LANGFUSE_BASE_URL"]

try:
    from langfuse.decorators import observe, langfuse_context
except Exception as _lf_err:
    observe = lambda **kw: lambda f: f
    langfuse_context = None

import rag
from scraper import scrape_and_save, extract_text_from_pdf
from lockbox import lockbox
from metrics import ERROR_COUNT, REQUEST_COUNT, REQUEST_LATENCY
from observability import configure_logging
import uuid
import ipaddress
from redis_client import get_redis
from slm_dispatcher import slm_dispatcher
from makura_client import call_makura, stream_makura
from routerai_client import stream_routerai
from search_agent import execute_search_agent, execute_deep_research, async_search_with_sources, get_exa_proxy
from db import SessionLocal, get_db, engine
from db_async import get_async_db
from swarm_agent import run_analytical_swarm
from sqlalchemy.ext.asyncio import AsyncSession
from models import (
    Analysis, ChatMessage as DbChatMessage, ChatSession, ErrorLog,
    User, PromoCampaign, PromoCode, PromoRedemption, Payment, RagLog, ToolResult, SocialAccount, ProjectTree,
    AdminAuditLog, Project, ResearchJob,
)
import passport as passport_lib
from sqlalchemy import select, func as sa_func
from sqlalchemy.exc import IntegrityError
from schemas import (
    AnalysisCreateRequest,
    AnalysisResponse,
    ChatMessageCreateRequest,
    ChatMessageResponse,
    ChatSessionCreateRequest,
    ChatSessionResponse,
    ChatSessionDetailResponse,
    EmailVerifyRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
    UserUpdateRequest,
    PasswordChangeInitRequest,
    PasswordChangeConfirmRequest,
    EmailCodeVerifyRequest,
    PromoCodeCreate,
    PromoCodeResponse,
    PromoCampaignCreate,
    PromoCampaignUpdate,
    PromoCodesGenerateRequest,
    PaymentResponse,
    PaymentResponse,
    SubscriptionResponse,
    IntentCreateRequest,
    IntentResponse,
    ChatSessionFromIntentRequest,
    ChatSessionAutoRequest,
    RagSearchRequest,
    RagSearchResponse,
    RagChunk,
    ToolResultResponse,
    ToolSearchRequest,
    ToolResearchRequest,
    ImportContextRequest,
    ImportContextResponse,
)
from import_parser import ImportParser
from email_utils import get_dev_emails, send_email
from sso import yandex_sso, github_sso, google_sso

# Admin Visualization Imports
try:
    from ops.admin.visualize_full_rag import visualize_rag, STATUS_FILE, DEFAULT_OUTPUT
except ImportError:
    visualize_rag = None
    DEFAULT_OUTPUT = os.path.join("admin_docs", "rag_visualization.html")
    STATUS_FILE = os.path.join("admin_docs", "rag_viz.lock")
import billing
from auth import (
    create_access_token,
    get_access_token_cookie_name,
    get_access_token_max_age,
    get_current_user,
    get_user_id_from_token,
    generate_token,
    hash_token,
    hash_password,
    require_admin,
    verify_password,
    verify_token,
    get_async_current_user,
    require_async_admin,
)

def extract_json_zai(text: str) -> dict:
    """Safe JSON extraction for AI responses."""
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return json.loads(text[start : end + 1])
        return json.loads(text)
    except Exception:
        return {}

async def classify_intent(user_message: str) -> list[str]:
    """Router LLM: Determines which RAG collections to search based on the user's intent."""
    try:
        # Use SLM for fast routing
        res = await slm_dispatcher.classify_query_intent(user_message)
        categories = res.get("categories", ["platform_manual"])
        logger.info(f"SLM Router determined categories: {categories}")
        return categories
    except Exception as e:
        logger.error(f"Router SLM failed: {e}")
        return ["platform_manual"]


logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты — эксперт по венчурным инвестициям в России. Проанализируй стартап с учётом "
    "российского рынка: регуляторики, конкуренции, поведения потребителей, каналов "
    "продвижения и требований инвесторов (РВК, бизнес-ангелы). Используй только "
    "достоверные данные из контекста. Отвечай строго в формате JSON без пояснений."
)
SYSTEM_CHAT_PROMPT = (
    "Ты — аналитическая система Pitchy для проверки стартапов и бизнес-гипотез на российском рынке. "
    "ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Использование китайских иероглифов или любых других языков (кроме общепринятых английских терминов) КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО. "
    "Если ты начнешь отвечать на китайском — это будет считаться системной ошибкой. "
    "Твоя задача — проводить строгий инвестиционный скрининг, а не поддерживать пользователя или продавать ему его идею. "
    "Будь жёстким, конкретным и профессиональным критиком, но не груби. Не смягчай вывод ради вежливости, не хвали идею без доказательств и не придумывай сильные стороны для баланса. "
    "Если гипотеза противоречива, вторична, не имеет платёжеспособного спроса, защищаемого преимущества, реалистичной экономики или законного способа реализации — прямо напиши, что в текущем виде она нежизнеспособна, и перечисли причины по степени критичности. "
    "В разборе обязательно укажи: критические противоречия; неподтверждённые допущения; стоп-факторы; какие данные опровергнут или подтвердят вывод; минимальный дешёвый тест. Итоговое суждение давай ТОЛЬКО в самом конце ответа, после разбора, и обычными словами: где идея стоит сейчас, что её ломает, что нужно проверить в первую очередь. Вердикт в начале ЗАПРЕЩЁН. Ярлыки-приговоры («ОТКЛОНИТЬ», «ПРИНЯТЬ», «ОДОБРЕНО», «НУЖНА ПРОВЕРКА», «МОЖНО ТЕСТИРОВАТЬ») и любые их аналоги капслоком или в заголовке — ЗАПРЕЩЕНЫ где бы то ни было в ответе. "
    "Отделяй факты из источников от предположений и расчётных оценок. Не выдавай отсутствие данных за положительный сигнал. Нехватка данных — не повод отказаться от разбора: разбирай то, что есть, недостающее закрывай явно помеченным допущением или отраслевым бенчмарком и показывай, как вывод меняется в диапазоне. "
    "Любые цифры проверяй на арифметическую и экономическую согласованность. Явно отмечай взаимоисключающие заявления пользователя, нереалистичные сроки, скрытые зависимости, регуляторные ограничения и бесплатные альтернативы. "
    "НИКОГДА не выдумывай CAC, LTV, retention, средний чек, готовность платить, размер рынка, экономию, маржу или долю клиентов. Если числа не даны пользователем и не подтверждены релевантным источником, пиши «нет данных», давай формулу и список данных для расчёта. Не переноси отраслевые цифры из нерелевантного кейса на проект пользователя. "
    "Ссылка [KBn] допустима только когда соответствующий фрагмент прямо подтверждает конкретное утверждение. Общие советы из базы знаний не являются доказательством спроса, цены или экономики данного проекта. "
    "Не считай названное число интервью подтверждением спроса само по себе — важно, что именно выяснили: как часто возникает проблема, чем её решают сейчас, сколько теряют, есть ли бюджет, кто принимает решение. "
    "ВАЖНО ПРО КАСТДЕВ: платформа работает со стадией ДО кастдева, поэтому проведённые интервью, предзаказы, пилоты и письма о намерениях НЕЛЬЗЯ требовать и нельзя делать условием разбора. Их отсутствие — нормальное состояние проекта, а не стоп-фактор и не блокер. Упомянуть кастдев можно только как следующий шаг проверки («это проверяется десятком разговоров с X»), но вывод об идее строй на том, что можно оценить без него: логика проблемы, размер и доступность сегмента, экономика, альтернативы, регуляторика, техническая осуществимость. "
    "Если непонятно, что именно продаётся, кому и как работает продукт, не фантазируй сегменты и выгоды: разбирай под явно названными допущениями, а уточняющие вопросы (не больше пяти) задавай в конце, после разбора, а не вместо него. "
    "Не предлагай пивот только ради конструктивного финала. Пивот допустим лишь если он сохраняет подтверждённый актив или инсайт команды и устраняет названные стоп-факторы; иначе честно рекомендуй прекратить работу над гипотезой. "
    "Не заканчивай шаблонным «Хотите, я помогу…». Завершай конкретным следующим тестом, перечнем требуемых данных либо решением остановить гипотезу. "
    "Не советуй покупать, продавать или держать конкретные финансовые инструменты и не подстраивай финансовые советы под личный риск-профиль пользователя. Материалы должны оставаться информационно-аналитическими. "
    "Твоя роль — проверка аргументов, а не источник авторитета: НИКОГДА не называй себя экспертом, инвестиционным советником, аналитиком с опытом или представителем венчурного фонда. "
    "НИКОГДА не подписывай ответ: не добавляй в конце «Pitchy», «команда Pitchy», должность, роль, имя или подпись в любом оформлении. Не используй формулировку «Pitchy, эксперт по венчурным инвестициям» ни при каких обстоятельствах. "
    "Давай глубокий, структурированный и визуально чистый анализ проектов для российского рынка. "
    "ВАЖНО: всё перечисленное выше — правила РАЗБОРА проекта. К тебе приходят и с другими запросами: справочный вопрос (нужна цифра, определение, перечень) и консультация (как решать задачу). "
    "Тип текущего запроса определён системой и передан ниже отдельным блоком — следуй ему. На справочный вопрос отвечай по существу и не переводи разговор на проверку бизнеса пользователя. "
    "Отвечай сразу полноценным итоговым ответом в формате чистого Markdown (жирный текст, списки, таблицы). "
    "НИКОГДА не используй теги <think>, <thought> или подобные — пиши ответ напрямую. "
    "Никогда не упоминай в ответе названия моделей, провайдеров или технологий бэкенда (Qwen, GLM, Makura, Exa, ChromaDB и т.п.). "
    "Учитывай специфику РФ: регуляторику, конкуренцию, поведение потребителей и требования инвесторов."
)

# ===========================================================================
# Режимы основного чата (см. slm_dispatcher.resolve_chat_mode).
#
# Раньше на любое сообщение навешивалась рамка «дай глубокий анализ проекта».
# Из-за неё справочный вопрос («сколько сейчас МСП в РФ») упирался в ответ
# «мне не хватает данных о вашем бизнесе», а разбор всегда открывался
# вердиктом. Теперь тон и структура выбираются по режиму.
# ===========================================================================

# Общая калибровка критичности для consult/review. Смысл: жёсткость — это
# качество возражений, а не количество данных, которые требуют у пользователя.
CRITIQUE_CORE_PROMPT = """
[КАК ТЫ ОЦЕНИВАЕШЬ]
Ты критичен, но конструктивен. Критичность — это качество возражений, а НЕ количество данных, которые ты требуешь у пользователя.
- Работай с тем, что есть. Недостающее закрывай рыночным бенчмарком и явно помечай: «допущение: …». Отказ вида «для анализа мне нужно больше данных» — ЗАПРЕЩЁН.
- Не хвали. Обороты «отличная идея», «звучит перспективно», «хороший вопрос», «вы молодец» — ЗАПРЕЩЕНЫ. Сильные стороны называй фактами: не «сильная команда», а «двое из трёх уже делали похожий продукт в X».
- Каждое возражение должно быть адресным и проверяемым. Не «рынок конкурентный», а «X и Y уже закрывают эту боль; заявленное отличие по Z ничем не подтверждено».
- Ранжируй проблемы: сначала то, что ломает бизнес-модель, потом то, что чинится по ходу. Не сваливай мелочи в одну кучу с фатальным — иначе мелочь читается как приговор.
- Не соглашайся из вежливости. Если пользователь возражает — реагируй на аргумент, а не на тон: сильный контраргумент принимай прямо, слабый разбирай.
- Уточняющие вопросы задавай ТОЛЬКО в самом конце, после полезного ответа. Никогда не задавай вопрос вместо ответа.
"""

MODE_PROMPT_FACT = """
[ТИП ЗАПРОСА: СПРАВКА]
Пользователю нужен факт, цифра, определение или перечень — а не разбор его бизнеса.
- Начинай сразу с ответа. Цифры давай с источником и периодом («по данным X на март 2026»).
- Точной цифры нет в контексте — дай ближайшую известную с оговоркой о её давности. Отказ отвечать — ЗАПРЕЩЁН.
- НЕ оценивай проект пользователя, НЕ разбирай его бизнес, НЕ предлагай заполнить паспорт проекта, НЕ задавай встречных вопросов.
- Длина по вопросу: короткий вопрос — короткий ответ. Не раздувай структуру ради структуры.
- Если известна сфера пользователя и она реально относится к делу — в САМОМ КОНЦЕ добавь одну фразу-привязку («в вашем сегменте B2B-логистики из этого объёма релевантна доля X»). Это подсказка, а не разбор: одна фраза, и только если она уместна.
"""

MODE_PROMPT_CONSULT = """
[ТИП ЗАПРОСА: КОНСУЛЬТАЦИЯ]
Пользователь спрашивает, как решать бизнес-задачу. Отвечай как практик, а не как методичка.
- Давай конкретные варианты с условиями применимости («работает, если чек выше X»), а не список абстракций.
- Прямо говори, что не работает и почему, называй типичные грабли.
- Не подстраивайся под пользователя: если его подход слабее альтернативы — скажи это прямо и объясни, чем именно.
- Уточняющих вопросов — не больше 2–3 и только в конце: здесь у тебя спросили про подход, а не про проект.
- Разбор его проекта здесь не нужен: он спросил про подход. Контекст проекта используй только чтобы сделать совет точнее.
"""

MODE_PROMPT_REVIEW = """
[ТИП ЗАПРОСА: РАЗБОР ПРОЕКТА]
Пользователь просит разобрать его проект, идею, цифры или документы.

СТРУКТУРА ОТВЕТА (строго в этом порядке):
1. Что я понял о проекте — 2–4 строки фактуры, без оценок.
2. Сильные стороны — с конкретикой, каждая подкреплена фактом или цифрой.
3. Слабые места и риски — по убыванию критичности, начиная с того, что ломает бизнес-модель.
4. Допущения и цифры, на которых держится разбор — что взято из данных пользователя, а что из бенчмарков.
5. Что делать дальше — 3–5 конкретных проверяемых шагов.
6. Итог — 2–3 фразы в САМОМ КОНЦЕ ответа, обычными словами, без баллов, светофоров и ярлыков-приговоров.
7. Вопросы для валидации — до 5 штук, самых важных, в самом конце.

ТВОЯ ЗАДАЧА — ВАЛИДИРОВАТЬ ИДЕЮ, а не только раскритиковать её. Поэтому:
- Сначала разбор на том, что есть, потом вопросы. Вопрос никогда не заменяет разбор.
- Спрашивай ровно то, что реально меняет вывод: чем закрывают проблему сейчас, откуда возьмётся первый платящий сегмент, из чего складывается цена и себестоимость, что мешает скопировать решение, какие ограничения (регуляторные, технические) ты не смог проверить. Максимум 5 вопросов, каждый — с пояснением, что именно он проверяет.
- НЕ требуй результатов кастдева, интервью, предзаказов и пилотов: платформа работает со стадией ДО них. Их отсутствие — не стоп-фактор. Упомянуть их как будущий шаг проверки можно, требовать как условие вывода — нельзя.

ЗАПРЕЩЕНО начинать ответ со слов «Вердикт», «Резюме», «Итог», «Краткий вывод», «Оценка», а также с балльной оценки или общего суждения о проекте. Сначала фактура и разбор — итог только в конце. Ярлыки «ОТКЛОНИТЬ», «ПРИНЯТЬ», «ОДОБРЕНО» и подобные приговоры запрещены в любом месте ответа: итог формулируй нормальным текстом.
"""

CHAT_MODE_PROMPTS = {
    "fact": MODE_PROMPT_FACT,
    "consult": CRITIQUE_CORE_PROMPT + MODE_PROMPT_CONSULT,
    "review": CRITIQUE_CORE_PROMPT + MODE_PROMPT_REVIEW,
}


def build_chat_system_prompt(mode: str, today: str) -> str:
    """Системный промпт основного чата: общая персона + блок режима."""
    parts = [
        SYSTEM_CHAT_PROMPT,
        f"\n\nСегодня {today}. Указывай в ответе только эту актуальную дату; "
        "НЕ пиши устаревшие даты (например «декабрь 2024») — твои внутренние знания "
        "устарели, но текущая дата задана системой и является истиной.",
        "\n" + CHAT_MODE_PROMPTS.get(mode, CHAT_MODE_PROMPTS["consult"]),
    ]
    return "".join(parts)


class AnalyzeRequest(BaseModel):
    description: str = Field(..., min_length=10)


class AnalyzeResponse(BaseModel):
    investment_score: int
    strengths: list[str]
    weaknesses: list[str]
    recommendations: list[str]
    market_summary: str


class ChatMessage(BaseModel):
    role: str
    content: str = Field(..., min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    reply: str


load_dotenv()

# Inject Lockbox secrets into environment if they exist
try:
    _lb_secrets = lockbox.get_secrets()
    for k, v in _lb_secrets.items():
        if k not in os.environ:
            os.environ[k] = v
except Exception as e:
    logging.getLogger("app").warning(f"Failed to load Lockbox secrets on startup: {e}")

configure_logging()
logger = logging.getLogger("app")

# Langfuse SDK logs "No trace found in the current context" at WARNING for
# every span created outside a trace — harmless but ~160 lines/day of noise
# that buries real warnings. Lift its threshold to ERROR.
logging.getLogger("langfuse").setLevel(logging.ERROR)


async def sync_redis_to_pg():
    """Background task to sync hot Redis state to PostgreSQL every 5 mins."""
    from db import SessionLocal
    from models import ProjectTree
    import json
    
    while True:
        await asyncio.sleep(300) # 5 minutes
        redis = get_redis()
        if not redis:
            continue
            
        try:
            keys = redis.keys("user:*:tree:*:state")
            for key in keys:
                state_raw = redis.get(key)
                if not state_raw:
                    continue
                state = json.loads(state_raw)
                
                # Extract ids from key: user:{uid}:tree:{tid}:state
                parts = key.split(":")
                u_id = int(parts[1])
                t_id = int(parts[3])
                
                with SessionLocal() as db:
                    tree = db.query(ProjectTree).filter(ProjectTree.id == t_id, ProjectTree.user_id == u_id).first()
                    if tree:
                        # Extract nodes and readiness effectively
                        nodes = state.get("nodes", [])
                        tree.tree_data = {"nodes": nodes}
                        tree.readiness_index = state.get("readiness_index", 0)
                        # Updated timestamp handled by SQLAlchemy onupdate
                        db.commit()
            logger.info(f"Background Sync: Synchronized {len(keys)} trees from Redis to PG.")
        except Exception as e:
            logger.error(f"Background Sync Error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background sync
    asyncio.create_task(sync_redis_to_pg())
    from research_service import resume_pending_research_jobs
    asyncio.create_task(resume_pending_research_jobs())
    
    # Start RAG initialization in background task so server starts immediately
    async def _init_rag_bg():
        import asyncio
        max_retries = 3
        for attempt in range(max_retries):
            try:
                await rag.init_rag()
                logger.info("RAG initialized successfully in background.")
                # Keep the embedding endpoint connection warm — the first
                # call after an idle gap was ~30s on prod, which would
                # stall the first chat query of a session.
                asyncio.create_task(rag.run_embedding_keepwarm_loop())
                return
            except Exception as e:
                logger.warning(f"RAG init failed (attempt {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(5)
        logger.error("RAG init failed permanently after retries.")

    asyncio.create_task(_init_rag_bg())

    # IMAP → Telegram bridge for support@/hello@/billing@/noreply@ mailboxes.
    # The module no-ops gracefully if the relevant env vars are missing,
    # so this is safe to call unconditionally on every startup.
    from mail_to_telegram import run_mail_bridge
    asyncio.create_task(run_mail_bridge())

    # Daily-ish job: notify users whose subscription expires in ~3 days.
    # Dedup via Redis (per user+expiry). Disabled cleanly if Redis is down.
    from subscription_notices import run_subscription_notices_loop
    asyncio.create_task(run_subscription_notices_loop())

    # Durable accelerator notifications: retry the outbox and generate one
    # idempotent reminder when a homework deadline enters the 24-hour window.
    from accelerator_notification_service import run_accelerator_notifications_loop
    asyncio.create_task(run_accelerator_notifications_loop())

    # Грантовый каталог: каждый час закрываем истёкшие программы, раз в сутки
    # обновляем доверенные фиды и обходим добавленные админом источники.
    from grants_autodiscover import run_autodiscovery_loop
    asyncio.create_task(run_autodiscovery_loop())

    yield
    # Shutdown logic
    try:
        from langfuse import Langfuse
        langfuse_client = Langfuse()
        logger.info("Flushing Langfuse events before shutdown...")
        langfuse_client.flush()
    except Exception as e:
        logger.warning(f"Failed to flush Langfuse on shutdown: {e}")


class AdminRAGRequest(BaseModel):
    url: str

class AdminRAGCrawlRequest(BaseModel):
    url: str
    is_sitemap: bool = False
    max_pages: int = 50

class AdminRAGResponse(BaseModel):
    success: bool
    message: str
    chunks_added: int = 0
    file_path: str | None = None

class RagLogResponse(BaseModel):
    id: int
    source_url: str
    source_type: str
    status: str
    chunks_added: int
    error_message: str | None
    created_at: datetime

    class Config:
        from_attributes = True

def background_crawl(url: str, is_sitemap: bool, max_pages: int, delay: float):
    from crawler import parse_sitemap, crawl_website, append_to_rag
    import logging
    log = logging.getLogger("app")
    
    try:
        if is_sitemap:
            urls_to_scrape = parse_sitemap(url)
            if len(urls_to_scrape) > max_pages:
                urls_to_scrape = urls_to_scrape[:max_pages]
        else:
            urls_to_scrape = crawl_website(url, max_pages)
            
        log.info(f"Background task starting crawl of {len(urls_to_scrape)} URLs from {url}")
        for idx, u in enumerate(urls_to_scrape):
            log.info(f"Crawling {idx+1}/{len(urls_to_scrape)}: {u}")
            append_to_rag(u, delay)
        log.info(f"Background crawl from {url} finished.")
    except Exception as e:
        log.error(f"Background crawl failed: {e}")

app = FastAPI(title="Startup Analyzer", lifespan=lifespan)
app.include_router(billing.router)

import tree_router
app.include_router(tree_router.router)

import projects_router
app.include_router(projects_router.router)

import grants_router
app.include_router(grants_router.router)

from routers import contact as contact_router
app.include_router(contact_router.router)

from routers import auth as auth_router
app.include_router(auth_router.router)

from routers import research as research_router
app.include_router(research_router.router)

from routers import accelerators as accelerators_router
app.include_router(accelerators_router.router)


allowed_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id
    start = time.perf_counter()
    raw_path = request.url.path
    method = request.method
    path = raw_path
    try:
        response = await call_next(request)
        route = request.scope.get("route")
        route_path = getattr(route, "path", None)
        if route_path:
            path = route_path
    except Exception:
        duration = time.perf_counter() - start
        REQUEST_LATENCY.labels(method=method, path=path).observe(duration)
        REQUEST_COUNT.labels(method=method, path=path, status="500").inc()
        ERROR_COUNT.labels(method=method, path=path, status="500").inc()
        logger.exception(
            "request_failed",
            extra={
                "method": method,
                "path": path,
                "status_code": 500,
                "latency_ms": int(duration * 1000),
            },
        )
        raise

    duration = time.perf_counter() - start
    status_code = str(response.status_code)
    REQUEST_LATENCY.labels(method=method, path=path).observe(duration)
    REQUEST_COUNT.labels(method=method, path=path, status=status_code).inc()
    if response.status_code >= 400:
        ERROR_COUNT.labels(method=method, path=path, status=status_code).inc()

    # Security headers (CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy)
    # are set by the Caddy reverse proxy — see Caddyfile. Setting them here too produced
    # duplicate headers (and an X-Frame-Options conflict: SAMEORIGIN vs DENY).

    logger.info(
        "request_complete",
        extra={
            "method": method,
            "path": path,
            "status_code": response.status_code,
            "latency_ms": int(duration * 1000),
            "request_id": request_id,
        },
    )
    response.headers["X-Request-ID"] = request_id
    return response

AUTH_RATE_LIMIT = {}
AUTH_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_RATE_WINDOW_SECONDS", "600"))
AUTH_RATE_MAX = int(os.getenv("AUTH_RATE_MAX", "10"))


def get_client_ip(request: Request) -> str:
    """Return the real client IP when the request came through our proxy.

    Caddy overwrites X-Real-IP/X-Forwarded-For before forwarding to FastAPI.
    Trust those headers only from private/loopback peers; direct public clients
    cannot forge them into the backend because the backend is not exposed.
    """
    peer = request.client.host if request.client else "unknown"
    try:
        peer_ip = ipaddress.ip_address(peer)
        trusted_peer = peer_ip.is_private or peer_ip.is_loopback
    except ValueError:
        trusted_peer = False
    if trusted_peer:
        forwarded = request.headers.get("x-real-ip")
        if not forwarded:
            forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            try:
                ipaddress.ip_address(forwarded)
                return forwarded
            except ValueError:
                pass
    return peer

def _check_rate_limit(ip: str) -> None:
    now = datetime.utcnow().timestamp()
    redis_client = get_redis()
    if redis_client:
        window = AUTH_RATE_WINDOW_SECONDS
        key = f"rate:auth:{ip}:{int(now // window)}"
        try:
            count = int(redis_client.incr(key))
            if count == 1:
                redis_client.expire(key, window)
            if count > AUTH_RATE_MAX:
                raise HTTPException(status_code=429, detail="Too many requests")
            return
        except HTTPException:
            raise
        except Exception:
            pass

    timestamps = AUTH_RATE_LIMIT.get(ip, [])
    timestamps = [t for t in timestamps if now - t < AUTH_RATE_WINDOW_SECONDS]
    timestamps.append(now)
    AUTH_RATE_LIMIT[ip] = timestamps
    if len(timestamps) > AUTH_RATE_MAX:
        raise HTTPException(status_code=429, detail="Too many requests")

def _check_registration_rate_limit(ip: str) -> None:
    """Strict rate limit for registration: 3 per hour."""
    now = datetime.utcnow().timestamp()
    redis_client = get_redis()
    limit = 3
    window = 3600  # 1 hour
    
    if redis_client:
        key = f"rate:register:{ip}"
        try:
            count = int(redis_client.incr(key))
            if count == 1:
                redis_client.expire(key, window)
            if count > limit:
                raise HTTPException(status_code=429, detail="Registration limit reached (3 per hour)")
            return
        except HTTPException:
            raise
        except Exception:
            pass
    # Fallback in-memory rate limit using TTLCache to prevent memory leak
    if not hasattr(_check_registration_rate_limit, "_limits"):
        from cachetools import TTLCache
        _check_registration_rate_limit._limits = TTLCache(maxsize=1000, ttl=window)
    
    limits = _check_registration_rate_limit._limits
    timestamps = [t for t in limits.get(ip, []) if now - t < window]
    if len(timestamps) >= limit:
         raise HTTPException(status_code=429, detail="Registration limit reached (3 per hour)")
    timestamps.append(now)
    limits[ip] = timestamps


def _log_error(
    request: Request,
    status_code: int,
    detail: str,
) -> None:
    try:
        auth_header = request.headers.get("authorization", "")
        token = auth_header.replace("Bearer ", "") if auth_header else ""
        if not token:
            token = request.cookies.get(get_access_token_cookie_name(), "")
        user_id = get_user_id_from_token(token) if token else None
        with SessionLocal() as db:
            db.add(
                ErrorLog(
                    user_id=user_id,
                    path=str(request.url.path),
                    method=request.method,
                    status_code=status_code,
                    detail=detail,
                )
            )
            db.commit()
    except Exception:
        pass


def _db_healthcheck() -> bool:
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _redis_healthcheck() -> bool | None:
    if not os.getenv("REDIS_URL"):
        return None
    client = get_redis()
    if not client:
        return False
    try:
        client.ping()
        return True
    except Exception:
        return False


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code >= 400:
        _log_error(request, exc.status_code, str(exc.detail))
    response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    error_details = traceback.format_exc()
    logger.error(f"GLOBAL ERROR: {str(exc)}\n{error_details}", extra={
        "path": request.url.path,
        "method": request.method,
    })
    _log_error(request, 500, str(exc))
    response = JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера. Мы уже работаем над исправлением."}
    )
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


def _build_user_prompt(description: str, context_chunks: list[dict]) -> str:
    context_block = "\n".join(
        [f"{idx + 1}. {chunk['text'] if isinstance(chunk, dict) else chunk}" for idx, chunk in enumerate(context_chunks)]
    )
    return (
        "Описание стартапа:\n"
        f"{description}\n\n"
        "Контекст:\n"
        f"{context_block}\n\n"
        "Верни строго один JSON-объект без пояснений и без текста вне JSON.\n"
        "Используй только эти ключи и типы:\n"
        '{\n'
        '  "investment_score": 1-10,\n'
        '  "strengths": ["..."],\n'
        '  "weaknesses": ["..."],\n'
        '  "recommendations": ["..."],\n'
        '  "market_summary": "..." \n'
        '}\n'
        "Не добавляй другие ключи и не локализуй названия полей."
    )


def _normalize_analyze_data(data: dict) -> dict:
    def _to_list_of_str(value) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if str(item).strip()]

    try:
        score = int(data.get("investment_score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(1, min(score, 10))

    normalized = {
        "investment_score": score,
        "strengths": _to_list_of_str(data.get("strengths")),
        "weaknesses": _to_list_of_str(data.get("weaknesses")),
        "recommendations": _to_list_of_str(data.get("recommendations")),
        "market_summary": str(data.get("market_summary", "")).strip(),
    }
    if not normalized["market_summary"]:
        normalized["market_summary"] = "Анализ завершен, но модель вернула неполный summary."
    return normalized


def _format_chat_history(messages: list[ChatMessage], limit: int = 10) -> str:
    filtered = [m for m in messages if m.role in {"user", "assistant"}]
    recent = filtered[-limit:]
    lines = []
    for item in recent:
        label = "Пользователь" if item.role == "user" else "Ассистент"
        lines.append(f"{label}: {item.content}")
    return "\n".join(lines)


def _build_chat_prompt(messages: list[ChatMessage], context_chunks: list[Any]) -> str:
    history = _format_chat_history(messages)
    
    # Extract text from chunks and filter empty ones
    valid_chunks = []
    for c in context_chunks:
        text = c["text"] if isinstance(c, dict) else str(c)
        if text and text.strip():
            valid_chunks.append(text.strip())
            
    context_block = "\n\n".join(valid_chunks)

    return (
        f"{context_block}\n\n"
        "[ИСТОРИЯ ДИАЛОГА]:\n"
        f"{history}\n\n"
        "Опираясь на предоставленный контекст и факты, продолжи диалог и ответь на последнюю реплику."
    )


@app.get("/")
def index() -> dict:
    return {"status": "ok"}


from auth import get_access_token_cookie_name, get_user_id_from_token

@app.middleware("http")
async def langfuse_observability_middleware(request: Request, call_next):
    # Try to get user_id for Langfuse tracing
    user_id = None
    token = request.cookies.get(get_access_token_cookie_name())
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    
    if token:
        user_id = get_user_id_from_token(token)
    
    # Process request
    response = await call_next(request)
    
    # If we have a user_id and langfuse context is active, update trace
    if user_id and langfuse_context:
        try:
            langfuse_context.update_current_trace(
                user_id=str(user_id),
                tags=[os.getenv("APP_ENV", "production")]
            )
        except Exception:
             pass # Don't break request if Langfuse fails
             
    return response

def _classify_http_state(status_code: int) -> str:
    """3-level classification of an HTTP probe result."""
    if 200 <= status_code < 400:
        return "healthy"
    if 400 <= status_code < 500:
        return "warning"  # service reachable, but says no (auth, geoblock, missing endpoint)
    return "down"


async def _check_http(url: str, headers: dict | None = None, timeout: float = 3.0,
                       method: str = "HEAD") -> dict:
    """HTTP probe used by /health. Always returns a dict; never raises.

    State levels:
        healthy   2xx / 3xx — service alive and happy
        warning   4xx       — reachable, but rejecting our probe (auth/geo/etc)
        down      5xx / timeout / connection error
    """
    import time
    t0 = time.time()
    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as c:
            r = await c.request(method, url, headers=headers or {})
        state = _classify_http_state(r.status_code)
        return {
            "state": state,
            "ok": state == "healthy",
            "status_code": r.status_code,
            "latency_ms": int((time.time() - t0) * 1000),
        }
    except Exception as e:
        return {
            "state": "down",
            "ok": False,
            "error": type(e).__name__,
            "latency_ms": int((time.time() - t0) * 1000),
        }


async def _check_tcp(host: str, port: int, timeout: float = 5.0) -> dict:
    """TCP connect probe — for SMTP / DB sockets where we don't speak the protocol."""
    import time
    import socket
    t0 = time.time()
    try:
        fut = asyncio.get_running_loop().run_in_executor(
            None,
            lambda: socket.create_connection((host, port), timeout=timeout).close(),
        )
        await asyncio.wait_for(fut, timeout=timeout + 0.5)
        return {"state": "healthy", "ok": True, "latency_ms": int((time.time() - t0) * 1000)}
    except Exception as e:
        return {
            "state": "down",
            "ok": False,
            "error": type(e).__name__,
            "latency_ms": int((time.time() - t0) * 1000),
        }


async def _gather_health() -> dict:
    """Gather all health checks. Pure data — both /health (JSON) and the
    HTML view share this builder.

    Every synchronous probe (DB / Redis / RAG / alembic / /proc reads) is
    dispatched to a worker thread via asyncio.to_thread. Running them
    inline would block the uvicorn event loop for the 2-3s the checks
    take — and since the HTML view auto-refreshes every 30s, that froze
    the whole site on a 30s cadence.
    """

    health_started = time.time()

    # --- alembic revision matches HEAD? ---
    def _alembic_state() -> dict:
        try:
            with SessionLocal() as session:
                row = session.execute(text("SELECT version_num FROM alembic_version")).first()
            current = row[0] if row else None
            # Compare against HEAD on disk
            from alembic.config import Config as AlembicConfig
            from alembic.script import ScriptDirectory
            cfg = AlembicConfig("alembic.ini")
            head = ScriptDirectory.from_config(cfg).get_current_head()
            return {"ok": current == head, "current": current, "head": head}
        except Exception as e:
            return {"ok": False, "error": type(e).__name__}

    # --- system snapshot ---
    def _system_info() -> dict:
        import platform
        info: dict = {
            "environment": os.getenv("APP_ENV", "unknown"),
            "python": platform.python_version(),
            "cpu_count": os.cpu_count() or 0,
        }
        try:
            import shutil
            total, used, free = shutil.disk_usage("/")
            info["disk_free_gb"] = round(free / (1024 ** 3), 1)
            info["disk_used_pct"] = round(used * 100 / total)
        except Exception:
            pass
        try:
            with open("/proc/meminfo") as f:
                meminfo = {line.split(":")[0]: line.split(":")[1].strip().split()[0]
                           for line in f if ":" in line}
            mem_total = int(meminfo.get("MemTotal", 0)) // 1024
            mem_avail = int(meminfo.get("MemAvailable", 0)) // 1024
            if mem_total:
                info["mem_total_mb"] = mem_total
                info["mem_available_mb"] = mem_avail
                info["mem_used_pct"] = round((mem_total - mem_avail) * 100 / mem_total)
        except Exception:
            pass
        try:
            with open("/proc/loadavg") as f:
                la = f.read().split()
            info["load_1m"] = float(la[0])
            info["load_5m"] = float(la[1])
            info["load_15m"] = float(la[2])
        except Exception:
            pass
        try:
            with open("/proc/uptime") as f:
                info["host_uptime_hours"] = round(float(f.read().split()[0]) / 3600, 1)
        except Exception:
            pass
        return info

    def _db_details() -> dict:
        t0 = time.time()
        try:
            with SessionLocal() as session:
                session.execute(text("SELECT 1"))
            pool = engine.pool
            return {
                "state": "healthy",
                "ok": True,
                "latency_ms": int((time.time() - t0) * 1000),
                "pool_size": pool.size() if hasattr(pool, "size") else None,
                "pool_checked_out": pool.checkedout() if hasattr(pool, "checkedout") else None,
                "pool_overflow": pool.overflow() if hasattr(pool, "overflow") else None,
            }
        except Exception as e:
            return {"state": "down", "ok": False, "error": type(e).__name__,
                    "latency_ms": int((time.time() - t0) * 1000)}

    def _redis_details() -> dict:
        t0 = time.time()
        if not os.getenv("REDIS_URL"):
            return {"state": "skipped", "ok": False, "note": "REDIS_URL not configured"}
        try:
            client = get_redis()
            if not client:
                raise RuntimeError("client unavailable")
            client.ping()
            info = client.info("memory")
            return {
                "state": "healthy",
                "ok": True,
                "latency_ms": int((time.time() - t0) * 1000),
                "used_memory_mb": round(float(info.get("used_memory", 0)) / 1024 / 1024, 1),
                "maxmemory_mb": round(float(info.get("maxmemory", 0)) / 1024 / 1024, 1),
            }
        except Exception as e:
            return {"state": "down", "ok": False, "error": type(e).__name__,
                    "latency_ms": int((time.time() - t0) * 1000)}

    def _research_details() -> dict:
        try:
            from models import ResearchJob
            with SessionLocal() as session:
                active = session.execute(
                    select(ResearchJob).where(ResearchJob.status.in_(["queued", "running", "cancelling"]))
                ).scalars().all()
                failed_24h = session.execute(
                    select(sa_func.count()).select_from(ResearchJob).where(
                        ResearchJob.status == "failed",
                        ResearchJob.completed_at >= datetime.utcnow() - timedelta(hours=24),
                    )
                ).scalar() or 0
            oldest = min((job.updated_at or job.created_at for job in active), default=None)
            stale_minutes = round((datetime.utcnow() - oldest).total_seconds() / 60, 1) if oldest else 0
            state = "warning" if active and stale_minutes > 15 else "healthy"
            return {
                "state": state,
                "ok": state == "healthy",
                "active_jobs": len(active),
                "oldest_update_minutes": stale_minutes,
                "failed_24h": int(failed_24h),
                "note": "active job has not reached a checkpoint for over 15 minutes" if state == "warning" else None,
            }
        except Exception as e:
            return {"state": "warning", "ok": False, "error": type(e).__name__}

    # --- external probes, run in parallel ---
    makura_key = os.getenv("MAKURA_API_KEY", "")
    routerai_key = os.getenv("ROUTERAI_API_KEY", "")
    routerai_base_url = os.getenv("ROUTERAI_BASE_URL", "https://routerai.ru/api/v1").rstrip("/")
    exa_key = os.getenv("EXA_API_KEY", "")
    langfuse_url = os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com").rstrip("/")
    langfuse_configured = bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"))
    # Search egress: api.exa.ai is Cloudflare-blocked from our RU IP, so when a
    # proxy is configured the real dependency is the proxy, not Exa directly —
    # probe whatever the search agent will actually dial.
    exa_proxy = get_exa_proxy()
    exa_probe_host, exa_probe_port = "api.exa.ai", 443
    if exa_proxy:
        from urllib.parse import urlparse
        _p = urlparse(exa_proxy)
        if _p.hostname:
            exa_probe_host, exa_probe_port = _p.hostname, (_p.port or 8080)
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "0") or 0)

    smtp_probe = (_check_tcp(smtp_host, smtp_port, timeout=5.0)
                  if (smtp_host and smtp_port)
                  else asyncio.sleep(0, result={"state": "skipped", "ok": False,
                                                "note": "SMTP_HOST/PORT not configured"}))

    # Sync checks run in worker threads; async probes run as coroutines.
    # Everything is awaited together so /health never blocks the loop.
    async def _safe_thread(fn, default):
        try:
            return await asyncio.to_thread(fn)
        except Exception as e:
            logger.warning(f"health check {getattr(fn,'__name__',fn)} failed: {e}")
            return default

    (db_check, redis_check, rag_ok, alembic_check, sys_info, research_check,
     makura_check, routerai_check, exa_check, smtp_check,
     chroma_check, frontend_check, loki_check, grafana_check, crowdsec_check,
     langfuse_check) = await asyncio.gather(
        _safe_thread(_db_details, {"state": "down", "ok": False, "error": "timeout"}),
        _safe_thread(_redis_details, {"state": "down", "ok": False, "error": "timeout"}),
        _safe_thread(rag.healthcheck, False),
        _safe_thread(_alembic_state, {"ok": False, "error": "timeout"}),
        _safe_thread(_system_info, {}),
        _safe_thread(_research_details, {"state": "warning", "ok": False, "error": "timeout"}),
        _check_http("https://api.makura.ai/v1/models",
                    headers={"Authorization": f"Bearer {makura_key}"} if makura_key else None,
                    method="GET"),
        _check_http(f"{routerai_base_url}/models",
                    headers={"Authorization": f"Bearer {routerai_key}"} if routerai_key else None,
                    method="GET"),
        _check_tcp(exa_probe_host, exa_probe_port, timeout=5.0),
        smtp_probe,
        _check_http("http://chroma:8000/api/v2/heartbeat", method="GET"),
        _check_http("http://frontend:3000", method="GET"),
        _check_http("http://loki:3100/ready", method="GET"),
        _check_http("http://grafana:3000/api/health", method="GET"),
        _check_http("http://crowdsec:8080/health", method="GET"),
        _check_http(langfuse_url, method="GET"),
        return_exceptions=False,
    )
    db_ok = bool(db_check.get("ok"))
    redis_ok = bool(redis_check.get("ok"))

    # Friendlier annotations for known states ----
    # exa: TCP-only probe — validates reachability without burning the search
    # balance. Target is the egress proxy when one is configured (that's the hop
    # that can actually break), otherwise api.exa.ai:443 directly. If the key
    # isn't set, we still report reachability but mark configured: false.
    if exa_check.get("ok"):
        exa_check["state"] = "healthy"
        exa_check["note"] = (
            f"TCP reachable via proxy {exa_probe_host}:{exa_probe_port}"
            if exa_proxy else "TCP reachable (direct — Cloudflare may still 403)"
        ) + ("" if exa_key else " (no key configured)")
    if not exa_key:
        exa_check.setdefault("note", "EXA_API_KEY not set")
    # makura "configured: false" if no key
    if not makura_key:
        makura_check["state"] = "skipped"
        makura_check["note"] = "MAKURA_API_KEY not set"
    if not routerai_key:
        routerai_check["state"] = "skipped"
        routerai_check["note"] = "ROUTERAI_API_KEY not set"
    from rag_reranker import RERANKER_MODEL
    routerai_check["reranker_model"] = RERANKER_MODEL
    routerai_check["reranker_endpoint"] = f"{routerai_base_url}/rerank"
    routerai_check["note"] = (
        (routerai_check.get("note") + "; ") if routerai_check.get("note") else ""
    ) + "health probe checks RouterAI reachability; chat uses the dedicated rerank endpoint"
    if not langfuse_configured:
        langfuse_check["state"] = "skipped"
        langfuse_check["note"] = "Langfuse credentials not configured"

    # alembic_check + sys_info were already computed in the gather above.
    if "state" not in alembic_check:
        alembic_check["state"] = "healthy" if alembic_check.get("ok") else "warning"

    core_checks = [db_check, redis_check, {"ok": rag_ok}, frontend_check, chroma_check]
    status = "ok" if all(check.get("ok") for check in core_checks) else "degraded"

    def _core_state(ok: bool) -> str:
        return "healthy" if ok else "down"

    checks = {
        "db":      db_check,
        "redis":   redis_check,
        "rag":     {"state": _core_state(rag_ok), "ok": rag_ok,
                    "note": None if rag_ok else "indexing in background or not ready"},
        "chroma":  chroma_check,
        "alembic": alembic_check,
        "frontend": frontend_check,
        "research": research_check,
        "smtp":    {**smtp_check, "host": smtp_host, "port": smtp_port},
        "makura":  {**makura_check, "configured": bool(makura_key)},
        "routerai": {**routerai_check, "configured": bool(routerai_key)},
        "exa":     {**exa_check, "configured": bool(exa_key)},
        "langfuse": {**langfuse_check, "configured": langfuse_configured},
        "loki": loki_check,
        "grafana": grafana_check,
        "crowdsec": crowdsec_check,
        "system":  sys_info,
    }
    state_counts = {"healthy": 0, "warning": 0, "down": 0, "skipped": 0}
    for name, check in checks.items():
        if name == "system":
            continue
        state = check.get("state", "healthy" if check.get("ok") else "down")
        state_counts[state] = state_counts.get(state, 0) + 1

    return {
        "status": status,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "duration_ms": int((time.time() - health_started) * 1000),
        "summary": state_counts,
        # Backward-compatible top-level booleans
        "db": db_ok,
        "redis": redis_ok,
        "rag": rag_ok,
        "chromadb": rag_ok,
        "checks": checks,
    }


def _render_health_html(data: dict) -> str:
    """Render the same health dict as a human-readable page.

    Tiny inline CSS so the page is self-contained (no fonts/CDNs).
    Auto-refreshes every 30 s so you can leave it open as a dashboard.
    """
    state_color = {
        "healthy": "#10b981",   # emerald
        "warning": "#f59e0b",   # amber
        "down":    "#ef4444",   # red
        "skipped": "#6b7280",   # gray
    }
    state_label = {
        "healthy": "OK",
        "warning": "WARN",
        "down":    "DOWN",
        "skipped": "OFF",
    }

    def card(name: str, check: dict) -> str:
        st = check.get("state", "healthy" if check.get("ok") else "down")
        color = state_color.get(st, "#6b7280")
        label = state_label.get(st, "?")
        # Build a small key-value table of all interesting fields, skipping
        # the ones we already render in the header.
        skip = {"state", "ok", "note"}
        rows = []
        for k, v in check.items():
            if k in skip or v is None:
                continue
            if isinstance(v, bool):
                v = "yes" if v else "no"
            rows.append(f'<div class="kv"><span class="k">{k}</span>'
                        f'<span class="v">{v}</span></div>')
        note = check.get("note")
        note_html = f'<div class="note">{note}</div>' if note else ""
        return f"""
        <div class="card">
          <div class="card-head">
            <span class="name">{name}</span>
            <span class="badge" style="background:{color}">{label}</span>
          </div>
          {note_html}
          <div class="kvs">{''.join(rows)}</div>
        </div>"""

    checks = dict(data.get("checks", {}))
    # System info gets its own larger card at the bottom
    sys_info = checks.pop("system", {})
    ordered = [
        "db", "redis", "chroma", "rag", "alembic", "frontend", "research",
        "smtp", "makura", "routerai", "exa", "langfuse",
        "loki", "grafana", "crowdsec",
    ]
    cards_html = "".join(card(k, checks[k]) for k in ordered if k in checks)

    sys_rows = "".join(
        f'<div class="kv"><span class="k">{k}</span><span class="v">{v}</span></div>'
        for k, v in sys_info.items()
    )

    top_status = data.get("status", "?")
    top_color = state_color["healthy"] if top_status == "ok" else state_color["down"]
    top_label = "OK" if top_status == "ok" else "DEGRADED"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pitchy · health</title>
<meta http-equiv="refresh" content="30">
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;background:#0a0a0a;color:#e5e5e5;
       font-family:ui-sans-serif,system-ui,sans-serif;padding:32px}}
  h1{{margin:0 0 8px;font-weight:600;font-size:20px;letter-spacing:.5px}}
  .sub{{color:#9ca3af;font-size:12px;margin-bottom:24px}}
  .grid{{display:grid;gap:12px;
        grid-template-columns:repeat(auto-fill,minmax(240px,1fr));max-width:1100px}}
  .card{{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px 16px}}
  .card-head{{display:flex;justify-content:space-between;align-items:center;
             margin-bottom:8px}}
  .name{{font-weight:600;font-size:14px;letter-spacing:.3px}}
  .badge{{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;
         padding:3px 7px;border-radius:4px;color:#0a0a0a;letter-spacing:.5px}}
  .note{{font-size:11px;color:#a3a3a3;margin-bottom:6px;font-style:italic}}
  .kvs{{display:flex;flex-direction:column;gap:2px}}
  .kv{{display:flex;justify-content:space-between;font-family:ui-monospace,Menlo,monospace;
       font-size:11px;color:#9ca3af}}
  .k{{color:#6b7280}}
  .v{{color:#d4d4d4}}
  .top{{display:flex;align-items:center;gap:12px;margin-bottom:24px}}
  .top .badge{{font-size:12px;padding:5px 10px}}
  .sys{{margin-top:18px;background:#141414;border:1px solid #2a2a2a;border-radius:10px;
       padding:14px 16px;max-width:1100px}}
  .sys h2{{margin:0 0 10px;font-size:13px;font-weight:600;color:#9ca3af;
          letter-spacing:.5px;text-transform:uppercase}}
  .sys .kvs{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));
            gap:4px 16px}}
  a{{color:#60a5fa;text-decoration:none}}
</style>
</head>
<body>
  <div class="top">
    <h1>pitchy.pro · system status</h1>
    <span class="badge" style="background:{top_color}">{top_label}</span>
  </div>
  <div class="sub">auto-refresh 30s · generated in {data.get("duration_ms", "?")} ms ·
       healthy {data.get("summary", {}).get("healthy", 0)} · warning {data.get("summary", {}).get("warning", 0)} ·
       down {data.get("summary", {}).get("down", 0)} · raw JSON: <a href="/health" onclick="event.preventDefault();
       fetch('/health',{{headers:{{Accept:'application/json'}}}}).then(r=>r.text()).then(t=>
       document.body.innerHTML='<pre style=padding:24px;white-space:pre-wrap>'+t+'</pre>')">view</a></div>
  <div class="grid">{cards_html}</div>
  <div class="sys">
    <h2>system</h2>
    <div class="kvs">{sys_rows}</div>
  </div>
</body>
</html>"""


@app.get("/live")
async def live() -> dict[str, str]:
    """Cheap liveness probe: the process and event loop are responding."""
    return {"status": "ok"}


@app.get("/ready")
async def ready(db: AsyncSession = Depends(get_async_db)) -> dict[str, str]:
    """Readiness probe used by Docker/Caddy before sending traffic."""
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("Readiness check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Service not ready") from exc
    return {"status": "ok"}


@app.get("/health")
async def health() -> dict:
    """Public, redacted health summary; no infrastructure details."""
    data = await _gather_health()
    return {
        "status": data.get("status", "error"),
        "generated_at": data.get("generated_at"),
        "summary": data.get("summary", {}),
    }


@app.get("/health/details")
async def health_details(
    request: Request,
    user: User = Depends(get_async_current_user),
):
    """Detailed diagnostics for authenticated administrators only."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    """System health endpoint.

    Returns JSON by default. If the request `Accept` header asks for HTML
    (e.g. a browser), returns a small auto-refreshing dashboard page
    that renders the same data more readably. The Caddy / docker
    healthcheck always sees JSON because they don't send Accept: text/html.
    """
    data = await _gather_health()
    accept = request.headers.get("accept", "")
    if "text/html" in accept and "application/json" not in accept:
        return HTMLResponse(_render_health_html(data))
    return data


@app.get("/public/metrics")
async def public_metrics(
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, int]:
    """Small, non-sensitive aggregate counters for public pages."""
    users_result = await db.execute(select(sa_func.count()).select_from(User))
    sessions_result = await db.execute(select(sa_func.count()).select_from(ChatSession))

    response.headers["Cache-Control"] = "public, max-age=300"
    return {
        "users": int(users_result.scalar() or 0),
        "chat_sessions": int(sessions_result.scalar() or 0),
    }


@app.get("/metrics")
def metrics(request: Request):
    # Prometheus-метрики раскрывают внутреннюю кухню — не отдаём публично.
    # Если задан METRICS_TOKEN, требуем его (Bearer или ?token=). Если токен
    # не задан: на проде закрываем наглухо (404), на dev оставляем открытым.
    expected = os.getenv("METRICS_TOKEN")
    if expected:
        auth = request.headers.get("Authorization", "")
        provided = auth[7:] if auth.startswith("Bearer ") else request.query_params.get("token", "")
        if not secrets.compare_digest(provided, expected):
            raise HTTPException(status_code=404, detail="Not found")
    elif os.getenv("APP_ENV", "dev").lower() == "prod":
        raise HTTPException(status_code=404, detail="Not found")
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/dev/emails")
def dev_emails() -> list[dict]:
    if os.getenv("APP_ENV") != "dev":
        raise HTTPException(status_code=404, detail="Not available")
    return get_dev_emails()


# Public contact form lives in routers/contact.py — registered below
# via app.include_router after `app` is fully constructed.


# Auth endpoints (register / login / logout / SSO / password reset)
# now live in routers/auth.py — registered via app.include_router below.


@app.api_route("/me", methods=["GET", "POST"], response_model=UserResponse)
async def me(user: User = Depends(get_async_current_user)) -> UserResponse:
    # Check if user has social accounts
    is_social = len(user.social_accounts) > 0

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        email_verified=user.email_verified,
        created_at=user.created_at,
        is_social=is_social,
        subscription_tier=user.subscription_tier,
        subscription_expires_at=user.subscription_expires_at,
        cookie_consent=user.cookie_consent,
        onboarding_completed_at=user.onboarding_completed_at,
    )


@app.get("/me/payments")
async def me_payments(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Current subscription state + this user's full payment history.

    Powers the self-service section on the account page so users can see
    what they pay for and when it expires without writing to support.
    """
    res = await db.execute(
        select(Payment)
        .where(Payment.user_id == user.id)
        .order_by(Payment.created_at.desc())
    )
    payments = res.scalars().all()
    return {
        "current_subscription": {
            "tier": user.subscription_tier,
            "expires_at": user.subscription_expires_at.isoformat() if user.subscription_expires_at else None,
            "is_admin": user.is_admin,
        },
        "payments": [
            {
                "id": p.id,
                "yookassa_id": p.yookassa_payment_id,
                "amount": float(p.amount) if p.amount is not None else 0.0,
                "currency": p.currency,
                "status": p.status,
                "tier": p.tier,
                "is_annual": p.is_annual,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in payments
        ],
    }


@app.get("/me/usage")
async def me_usage(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Real per-user monthly usage counters + the effective plan limits.

    Counters are scoped to the current calendar month (UTC) so they
    reset on the 1st. Admins get a synthetic "unlimited" view.
    Frontend uses this to render QuotaCard and feature locks.
    """
    from accelerator_service import accelerator_quota_snapshot, entitlement_is_greater
    from subscription_service import get_subscription, is_active, subscription_snapshot

    async def overlay_accelerator_quotas(response: dict) -> dict:
        accelerator_memberships: set[int] = set()
        for resource in ("messages", "roadmaps", "custdev", "grants"):
            snapshot = await accelerator_quota_snapshot(db, user.id, resource)
            if not snapshot:
                continue
            base_limit = int(response["limits"].get(resource, 0))
            if not entitlement_is_greater(snapshot["limit"], base_limit):
                continue
            response["limits"][resource] = snapshot["limit"]
            response["usage"][resource] = snapshot["used"]
            response["remaining"][resource] = snapshot["remaining"]
            accelerator_memberships.add(snapshot["membership"].id)
        if accelerator_memberships:
            response["tier"] = "accelerator"
            response["accelerator_membership_ids"] = sorted(accelerator_memberships)
            response["limits"]["can_use_tree"] = response["limits"].get("roadmaps", 0) != 0
            response["limits"]["can_use_custdev"] = response["limits"].get("custdev", 0) != 0
        return response

    custom_subscription = await get_subscription(db, user.id)
    if is_active(custom_subscription):
        snapshot = subscription_snapshot(custom_subscription)
        custom_limits = {
            **snapshot["current_config"], "search_messages": -1, "deep_research": -1,
            "can_use_deep_search": True, "can_use_research": True,
            "can_use_presentation": True, "can_use_import_context": True,
            "can_use_tree": True, "can_use_custdev": True,
        }
        response = {
            "tier": "custom",
            "limits": custom_limits,
            "usage": {**snapshot["used"], "search_messages": 0, "deep_research": 0},
            "remaining": {**snapshot["remaining"], "search_messages": None, "deep_research": None},
            "period_start": snapshot["current_period_start"],
            "period_end": snapshot["current_period_end"],
            "auto_renew": snapshot["auto_renew"],
            "next_config": snapshot["next_config"],
            "next_price": snapshot["next_price"],
        }
        return await overlay_accelerator_quotas(response)

    from plan_limits import (
        PLAN_LIMITS,
        UNLIMITED,
        get_limits_for,
        resolve_tier,
        limits_as_dict,
        start_of_month_utc,
    )

    tier_name = "pro" if user.is_admin else resolve_tier(user.subscription_tier, user.subscription_expires_at)
    limits = PLAN_LIMITS["pro"] if user.is_admin else get_limits_for(user.subscription_tier, user.subscription_expires_at)
    month_start = start_of_month_utc()

    # Main-chat user messages this month. Search and full-research requests
    # have their own quotas, so subtract them from the regular chat bucket.
    total_user_messages = (await db.execute(
        select(sa_func.count())
        .select_from(DbChatMessage)
        .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
        .where(
            ChatSession.user_id == user.id,
            DbChatMessage.role == "user",
            DbChatMessage.created_at >= month_start,
        )
    )).scalar() or 0

    # CustDev runs = Analysis rows. The external CustDev backend writes
    # into this same table (sessions/analyses are already synced).
    custdev_used = (await db.execute(
        select(sa_func.count())
        .select_from(Analysis)
        .where(Analysis.user_id == user.id, Analysis.created_at >= month_start)
    )).scalar() or 0

    # Roadmaps = ProjectTree rows created this month.
    try:
        roadmaps_used = (await db.execute(
            select(sa_func.count())
            .select_from(ProjectTree)
            .where(ProjectTree.user_id == user.id, ProjectTree.created_at >= month_start)
        )).scalar() or 0
    except Exception:
        roadmaps_used = 0

    # Search messages are chat assistant responses with sources that are not
    # tied to the full-research job pipeline.
    try:
        search_messages_used = (await db.execute(
            select(sa_func.count())
            .select_from(DbChatMessage)
            .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
            .where(
                ChatSession.user_id == user.id,
                DbChatMessage.role == "assistant",
                DbChatMessage.created_at >= month_start,
                DbChatMessage.sources.isnot(None),
                DbChatMessage.research_job_id.is_(None),
            )
        )).scalar() or 0
    except Exception:
        search_messages_used = 0

    try:
        research_jobs_used = (await db.execute(
            select(sa_func.count())
            .select_from(ResearchJob)
            .where(
                ResearchJob.user_id == user.id,
                ResearchJob.created_at >= month_start,
            )
        )).scalar() or 0
    except Exception:
        research_jobs_used = 0

    try:
        tool_research_used = (await db.execute(
            select(sa_func.count())
            .select_from(ToolResult)
            .where(
                ToolResult.user_id == user.id,
                ToolResult.tool_type == "deep-research",
                ToolResult.created_at >= month_start,
            )
        )).scalar() or 0
    except Exception:
        tool_research_used = 0

    research_used = research_jobs_used + tool_research_used
    messages_used = max(0, total_user_messages - search_messages_used - research_jobs_used)

    def remaining(limit_value: int, used: int) -> int | None:
        if limit_value == UNLIMITED:
            return None  # JSON null → frontend treats as unlimited
        return max(0, limit_value - used)

    legacy_grants_limit = UNLIMITED if tier_name not in ("free", "tester") else 0
    response = {
        "tier": tier_name,
        "limits": {**limits_as_dict(limits), "grants": legacy_grants_limit},
        "usage": {
            "messages": messages_used,
            "search_messages": search_messages_used,
            "custdev": custdev_used,
            "roadmaps": roadmaps_used,
            "deep_research": research_used,
            "grants": 0,
        },
        "remaining": {
            "messages": remaining(limits.messages, messages_used),
            "search_messages": remaining(limits.search_messages, search_messages_used),
            "custdev": remaining(limits.custdev, custdev_used),
            "roadmaps": remaining(limits.roadmaps, roadmaps_used),
            "deep_research": remaining(limits.deep_research, research_used),
            "grants": remaining(legacy_grants_limit, 0),
        },
        "period_start": month_start.isoformat() + "Z",
    }
    return await overlay_accelerator_quotas(response)


@app.patch("/me", response_model=UserResponse)
async def update_me(
    payload: UserUpdateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> UserResponse:
    if payload.name:
        user.name = payload.name
        
    if payload.cookie_consent is not None:
        user.cookie_consent = payload.cookie_consent

    if payload.onboarding_completed is True and user.onboarding_completed_at is None:
        user.onboarding_completed_at = datetime.utcnow()

    if payload.email and payload.email != user.email:
        result = await db.execute(select(User).where(User.email == payload.email))
        exists = result.scalar_one_or_none()
        if exists:
            raise HTTPException(status_code=400, detail="Email already registered")

        user.email = payload.email
        user.email_verified = False

        # Generate 6-digit code
        verify_code = "".join([str(random.randint(0, 9)) for _ in range(6)])
        verify_hash = hash_token(verify_code)
        verify_expires = datetime.utcnow() + timedelta(hours=24)

        user.email_verify_token_hash = verify_hash
        user.email_verify_expires_at = verify_expires

        try:
            import email_templates
            subj, body = email_templates.email_change_verification(user.name, verify_code)
            await run_in_threadpool(send_email, payload.email, subj, body)
        except Exception:
            logger.error("Failed to send verification email during update")

    await db.commit()
    await db.refresh(user)

    # Check if user has social accounts
    is_social = len(user.social_accounts) > 0

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        email_verified=user.email_verified,
        created_at=user.created_at,
        is_social=is_social,
        subscription_tier=user.subscription_tier,
        subscription_expires_at=user.subscription_expires_at,
        cookie_consent=user.cookie_consent,
        onboarding_completed_at=user.onboarding_completed_at,
    )


@app.post("/auth/change-password/initiate")
async def initiate_change_password(
    payload: PasswordChangeInitRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="User has no password set (social login?)")

    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid current password")

    # Generate 6-digit code
    code = "".join([str(random.randint(0, 9)) for _ in range(6)])
    code_hash = hash_token(code)
    expires = datetime.utcnow() + timedelta(minutes=10)

    # Reuse password_reset fields for this verification
    user.password_reset_token_hash = code_hash
    user.password_reset_expires_at = expires
    await db.commit()

    try:
        import email_templates
        subj, body = email_templates.password_change_code(user.name, code)
        send_email(user.email, subj, body)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to send verification code")

    return {"status": "ok", "message": "Verification code sent"}


@app.post("/auth/change-password/confirm")
async def confirm_change_password(
    payload: PasswordChangeConfirmRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    if not user.password_reset_token_hash or not user.password_reset_expires_at:
        raise HTTPException(status_code=400, detail="No pending password change request")

    if datetime.utcnow() > user.password_reset_expires_at:
        raise HTTPException(status_code=400, detail="Verification code expired")

    if not verify_token(payload.code, user.password_reset_token_hash):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    user.password_hash = hash_password(payload.new_password)
    # Clear tokens
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    await db.commit()

    try:
        import email_templates
        subj, body = email_templates.password_changed_notice(user.name)
        send_email(user.email, subj, body)
    except Exception:
        pass

    return {"status": "ok"}


@app.post("/auth/resend-verification")
async def resend_verification(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    if user.email_verified:
        return {"status": "ok", "message": "Already verified"}

    # Rate limit check could be here

    # Generate 6-digit code
    verify_code = "".join([str(random.randint(0, 9)) for _ in range(6)])
    verify_hash = hash_token(verify_code)
    verify_expires = datetime.utcnow() + timedelta(hours=24)

    user.email_verify_token_hash = verify_hash
    user.email_verify_expires_at = verify_expires
    await db.commit()

    try:
        import email_templates
        subj, body = email_templates.email_verification(user.name, verify_code)
        send_email(user.email, subj, body)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"status": "ok"}


@app.post("/auth/request-password-reset")
async def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Send a 6-digit password-reset code to the user's email.

    Always returns 200 OK regardless of whether the email exists — never
    leak which addresses are registered. Code expires in 15 minutes and is
    stored hashed (same column as the legacy long-token flow).

    On dev where SMTP is dead, the rendered email is still queued via
    email_utils.send_email and visible at GET /dev/emails — that gives
    QA a way to grab the code without a real inbox.
    """
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    res = await db.execute(
        select(User).where(User.email == payload.email, User.deleted_at.is_(None))
    )
    user = res.scalar_one_or_none()
    if not user:
        return {"status": "ok"}
    code = "".join(str(random.randint(0, 9)) for _ in range(6))
    user.password_reset_token_hash = hash_token(code)
    user.password_reset_expires_at = datetime.utcnow() + timedelta(minutes=15)
    await db.commit()
    try:
        import email_templates
        subj, body = email_templates.password_reset_code(code)
        send_email(payload.email, subj, body)
    except Exception:
        # SMTP may be unavailable on dev — code is still readable from /dev/emails.
        pass
    return {"status": "ok"}


@app.post("/auth/reset-password")
async def reset_password(
    payload: PasswordResetConfirm,
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Confirm a password reset using email + 6-digit code + new password."""
    res = await db.execute(
        select(User).where(User.email == payload.email, User.deleted_at.is_(None))
    )
    user = res.scalar_one_or_none()

    if (
        not user
        or not user.password_reset_token_hash
        or not user.password_reset_expires_at
        or user.password_reset_expires_at < datetime.utcnow()
    ):
        raise HTTPException(status_code=400, detail="Код недействителен или истёк")

    if hash_token(payload.code) != user.password_reset_token_hash:
        raise HTTPException(status_code=400, detail="Код недействителен или истёк")

    user.password_hash = hash_password(payload.new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    await db.commit()
    return {"status": "ok"}


# Legacy POST /auth/verify-email (long-token flow) was removed — superseded
# by the code-based handler in routers/auth.py. Frontend uses the code flow.


security = HTTPBearer()

def verify_rag_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    expected_token = os.getenv("RAG_API_KEY")
    if not expected_token or token != expected_token:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing RAG API Key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token

@app.post("/api/rag/search", response_model=RagSearchResponse)
async def rag_search_endpoint(
    payload: RagSearchRequest,
    token: str = Depends(verify_rag_token),
) -> RagSearchResponse:
    """Cross-service RAG read endpoint.

    Authenticated with a static Bearer token (env: RAG_API_KEY) so a
    separate backend (e.g. CustDev) can read the same knowledge base
    without sharing user credentials. Returns both a pre-joined context
    string and structured chunks with score + metadata.

    Example:
        curl -X POST https://dev.pitchy.pro/api/rag/search \
          -H "Authorization: Bearer $RAG_API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"query":"Какие требования у ФСИ", "top_k": 8}'
    """
    try:
        context_chunks = await asyncio.to_thread(
            rag.get_relevant_chunks,
            payload.query,
            categories=payload.categories,
            top_k=payload.top_k,
        )
    except Exception as e:
        logger.error(f"RAG search error: {e}")
        return RagSearchResponse(context="", chunks=[], count=0)

    structured = [
        RagChunk(
            text=c.get("text", "") if isinstance(c, dict) else str(c),
            score=c.get("score") if isinstance(c, dict) else None,
            metadata=c.get("metadata") if isinstance(c, dict) else None,
        )
        for c in (context_chunks or [])
    ]
    context = "" if payload.chunks_only else "\n\n".join(ch.text for ch in structured if ch.text)
    return RagSearchResponse(context=context, chunks=structured, count=len(structured))


@app.get("/api/rag/projects")
async def rag_list_projects(
    user_id: int,
    token: str = Depends(verify_rag_token),
    db: AsyncSession = Depends(get_async_db),
):
    """Cross-service: список проектов пользователя (для импорта паспорта в CustDev).

    Авторизация — статичный Bearer RAG_API_KEY (как /api/rag/search). user_id
    приходит из общего JWT на стороне CustDev (sub). Возвращает только не
    архивированные папки этого пользователя.
    """
    res = await db.execute(
        select(Project)
        .where(Project.user_id == user_id, Project.status != "archived")
        .order_by(Project.created_at.desc())
    )
    projects = res.scalars().all()
    return {
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "readiness_index": getattr(p, "readiness_index", None),
                "updated_at": p.passport_updated_at.isoformat() if getattr(p, "passport_updated_at", None) else None,
            }
            for p in projects
        ]
    }


@app.get("/api/rag/projects/{project_id}/passport")
async def rag_get_project_passport(
    project_id: int,
    user_id: int,
    token: str = Depends(verify_rag_token),
    db: AsyncSession = Depends(get_async_db),
):
    """Cross-service: паспорт конкретного проекта пользователя (для CustDev)."""
    res = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    passport = project.passport or {}
    return {
        "name": project.name,
        "passport": passport,
        "readiness_index": passport_lib.compute_readiness(passport),
    }


@app.post("/analyze-startup", response_model=AnalyzeResponse)
async def analyze_startup(payload: AnalyzeRequest) -> AnalyzeResponse:
    try:
        context_chunks = rag.get_relevant_chunks(payload.description, top_k=3)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_prompt = _build_user_prompt(payload.description, context_chunks)

    try:
        provider = os.getenv("PRIMARY_PROVIDER", "makura")
        if provider == "makura":
            raw_text, _, usage = await call_makura(SYSTEM_PROMPT, user_prompt)
        else:
            raw_text, _, usage = await call_makura(SYSTEM_PROMPT, user_prompt)
        logger.info(f"AI token usage ({provider} /analyze): {usage}")
        data = extract_json_zai(raw_text)
    except Exception as exc:
        logger.error(f"Analysis error: {exc}")
        raise HTTPException(
            status_code=502, detail="Ошибка при анализе (AI Service Error)"
        ) from exc
    try:
        normalized = _normalize_analyze_data(data)
        return AnalyzeResponse(**normalized)
    except (ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="Некорректный формат ответа от AI"
        ) from exc


def _check_subscription_limits(user: User, db: Session, resource_type: str, session_id: int = None, feature: str = None, is_search: bool = False):
    if user.is_admin:
        return

    tier = "free"
    if user.subscription_tier in ("pro", "premium", "starter", "tester"):
        if not user.subscription_expires_at or user.subscription_expires_at > datetime.utcnow():
            tier = user.subscription_tier

    if tier == "tester":
        if feature in ("custdev", "presentation", "deep_research", "import", "tree"):
            raise HTTPException(
                status_code=403,
                detail="Эта функция недоступна в тарифе Tester. Для использования полного функционала Smart Roadmap (Интерактивной дорожной карты) оформите полноценную подписку.",
            )

    if tier == "premium":
        return
        
    if resource_type == "project":
        if tier == "tester":
             # Tester can create unlimited chat sessions; CustDev analysis is blocked by feature check above
             return
             
        analyses_count = db.query(Analysis).filter(Analysis.user_id == user.id).count()
        chat_sessions_count = db.query(ChatSession).filter(ChatSession.user_id == user.id, ChatSession.analysis_id == None).count()
        total_projects = analyses_count + chat_sessions_count
        
        if tier == "free":
            # Бесплатный тариф: безлимитные чаты, но анализов пусть будет 1
            if feature == "custdev" and analyses_count >= 1:
                raise HTTPException(status_code=403, detail="Free tier limit: maximum 1 analysis project. Please upgrade your subscription.")
        elif tier == "pro" and total_projects >= 5:
            raise HTTPException(status_code=403, detail="Pro tier limit: maximum 5 projects. Please upgrade your subscription.")
            
    elif resource_type == "message":
        if tier == "tester":
            redis = get_redis()
            if redis:
                key = f"tester_limit_{user.id}_{'search' if is_search else 'normal'}"
                count = redis.get(key)
                count = int(count) if count else 0
                max_allowed = 5 if is_search else 20
                if count >= max_allowed:
                    raise HTTPException(
                        status_code=403, 
                        detail=f"Лимит {'поисковых' if is_search else 'обычных'} сообщений тарифа Tester исчерпан ({max_allowed}). Для использования полного функционала оформите полноценную подписку."
                    )
                redis.incr(key)
            else:
                # fallback for missing redis
                total_messages_count = db.query(DbChatMessage).join(ChatSession).filter(
                    ChatSession.user_id == user.id,
                    DbChatMessage.role == "user"
                ).count()
                if total_messages_count >= 25:
                    raise HTTPException(status_code=403, detail="Лимит сообщений тарифа Tester исчерпан (25). Пожалуйста, обновите подписку.")
                
        elif tier == "free" and session_id:
            msg_count = db.query(DbChatMessage).filter(
                DbChatMessage.session_id == session_id,
                DbChatMessage.role == "user"
            ).count()
            if msg_count >= 10:
                raise HTTPException(status_code=403, detail="Free tier limit: maximum 10 messages per chat session. Please upgrade your subscription.")

async def async_check_subscription_limits(
    user: User,
    db: AsyncSession,
    resource_type: str,
    session_id: int = None,
    feature: str = None,
    is_search: bool = False,
    idempotency_key: str | None = None,
):
    """Authorize a user action against their subscription plan.

    resource_type:
        "project"  — creating a new CustDev/Tree project (counted monthly)
        "message"  — sending a main-chat message (counted monthly)
        "feature"  — gating a feature toggle (no counter, just permission)
    feature:
        "custdev" | "tree" | "deep_search" | "research" |
        "presentation" | "import"
    """
    if user.is_admin:
        return

    # New configurable subscriptions use an atomic ledger instead of counting
    # rows heuristically. Legacy plans continue through the old logic below.
    from subscription_service import consume_quota, get_subscription, is_active
    custom_subscription = await get_subscription(db, user.id)
    resource = None
    if resource_type == "message":
        resource = "messages"
    elif resource_type == "project" and feature == "custdev":
        resource = "custdev"
    elif resource_type == "project" and feature in ("tree", "roadmap"):
        resource = "roadmaps"
    if resource:
        handled = await consume_quota(
            db,
            user,
            resource,
            idempotency_key=idempotency_key or f"{resource}:{user.id}:{uuid.uuid4()}",
            reference_type=feature or resource_type,
            reference_id=str(session_id) if session_id is not None else None,
        )
        if handled:
            return
    if is_active(custom_subscription):
        # Chat modes are included in a message; no separate paid resource.
        return

    from plan_limits import (
        PLAN_LIMITS,
        UNLIMITED,
        get_limits_for,
        resolve_tier,
        start_of_month_utc,
    )

    limits = get_limits_for(user.subscription_tier, user.subscription_expires_at)
    tier = resolve_tier(user.subscription_tier, user.subscription_expires_at)
    month_start = start_of_month_utc()

    # --- Feature gates (boolean permission, no usage count) ----------
    feature_map = {
        "custdev": limits.can_use_custdev,
        "tree": limits.can_use_tree,
        "deep_search": limits.can_use_deep_search,
        "research": limits.can_use_research,
        "deep_research": limits.can_use_research,
        "presentation": limits.can_use_presentation,
        "import": limits.can_use_import_context,
    }
    if feature and feature in feature_map and not feature_map[feature]:
        feature_label = {
            "custdev": "глубокий CustDev",
            "tree": "интерактивная дорожная карта",
            "deep_search": "поиск в интернете",
            "research": "глубокое исследование",
            "deep_research": "глубокое исследование",
            "presentation": "генерация презентации",
            "import": "импорт контекста",
        }.get(feature, feature)
        raise HTTPException(
            status_code=403,
            detail=f"upgrade_required: функция «{feature_label}» доступна на тарифах Starter и Pro. Обновите подписку.",
        )

    async def count_search_messages() -> int:
        return (await db.execute(
            select(sa_func.count())
            .select_from(DbChatMessage)
            .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
            .where(
                ChatSession.user_id == user.id,
                DbChatMessage.role == "assistant",
                DbChatMessage.created_at >= month_start,
                DbChatMessage.sources.isnot(None),
                DbChatMessage.research_job_id.is_(None),
            )
        )).scalar() or 0

    async def count_research_jobs() -> int:
        return (await db.execute(
            select(sa_func.count())
            .select_from(ResearchJob)
            .where(ResearchJob.user_id == user.id, ResearchJob.created_at >= month_start)
        )).scalar() or 0

    async def count_deep_research() -> int:
        tool_runs = (await db.execute(
            select(sa_func.count())
            .select_from(ToolResult)
            .where(
                ToolResult.user_id == user.id,
                ToolResult.tool_type == "deep-research",
                ToolResult.created_at >= month_start,
            )
        )).scalar() or 0
        return await count_research_jobs() + tool_runs

    async def count_regular_messages() -> int:
        total = (await db.execute(
            select(sa_func.count())
            .select_from(DbChatMessage)
            .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
            .where(
                ChatSession.user_id == user.id,
                DbChatMessage.role == "user",
                DbChatMessage.created_at >= month_start,
            )
        )).scalar() or 0
        return max(0, total - await count_search_messages() - await count_research_jobs())

    async def enforce_quota(limit_value: int, used: int, label: str) -> None:
        if limit_value == UNLIMITED:
            return
        if used >= limit_value:
            raise HTTPException(
                status_code=403,
                detail=f"quota_exceeded: исчерпан месячный лимит {label} на тарифе {tier} ({limit_value}). Обновите подписку.",
            )

    # --- Standalone tools (monthly counters) -------------------------
    if resource_type == "tool":
        if feature == "deep_research":
            await enforce_quota(limits.deep_research, await count_deep_research(), "глубоких исследований")
            return
        if feature == "deep_search":
            await enforce_quota(limits.search_messages, await count_search_messages(), "поисковых сообщений")
            return
        return

    # --- Project creation (monthly counters) -------------------------
    if resource_type == "project":
        if feature == "custdev":
            if limits.custdev == UNLIMITED:
                return
            used = (await db.execute(
                select(sa_func.count())
                .select_from(Analysis)
                .where(Analysis.user_id == user.id, Analysis.created_at >= month_start)
            )).scalar() or 0
            if used >= limits.custdev:
                raise HTTPException(
                    status_code=403,
                    detail=f"quota_exceeded: исчерпан месячный лимит CustDev на тарифе {tier} ({limits.custdev}). Обновите подписку.",
                )
            return
        if feature == "tree" or feature == "roadmap":
            if limits.roadmaps == UNLIMITED:
                return
            used = (await db.execute(
                select(sa_func.count())
                .select_from(ProjectTree)
                .where(ProjectTree.user_id == user.id, ProjectTree.created_at >= month_start)
            )).scalar() or 0
            if used >= limits.roadmaps:
                raise HTTPException(
                    status_code=403,
                    detail=f"quota_exceeded: исчерпан месячный лимит дорожных карт на тарифе {tier} ({limits.roadmaps}). Обновите подписку.",
                )
            return

    # --- Main chat message (monthly counter) -------------------------
    if resource_type == "message":
        if feature == "research":
            await enforce_quota(limits.deep_research, await count_deep_research(), "глубоких исследований")
            return
        if is_search or feature == "deep_search":
            await enforce_quota(limits.search_messages, await count_search_messages(), "поисковых сообщений")
            return
        await enforce_quota(limits.messages, await count_regular_messages(), "сообщений")


@app.post("/analysis", response_model=AnalysisResponse)
@observe(name="create_analysis")
async def create_analysis(
    payload: AnalysisCreateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> AnalysisResponse:
    if langfuse_context:
        langfuse_context.update_current_trace(
            user_id=str(user.id),
            tags=["analysis", user.subscription_tier or "free"]
        )

    await async_check_subscription_limits(user, db, "project", feature="custdev")

    description_parts = [
        f"Название: {payload.name}",
        f"Категория: {payload.category or '—'}",
        f"Стадия: {payload.stage or '—'}",
        f"Сайт: {payload.url}" if payload.url else None,
        f"Описание: {payload.description}",
    ]
    description = "\n".join([part for part in description_parts if part])

    try:
        context_chunks = rag.get_relevant_chunks(description, top_k=3)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_prompt = _build_user_prompt(description, context_chunks)

    try:
        provider = os.getenv("PRIMARY_PROVIDER", "makura")
        if provider == "makura":
            raw_text, _, usage = await call_makura(SYSTEM_PROMPT, user_prompt)
        else:
            raw_text, _, usage = await call_makura(SYSTEM_PROMPT, user_prompt)
        logger.info(f"AI token usage ({provider} website analysis): {usage}")
        data = extract_json_zai(raw_text)
    except Exception as exc:
        logger.error(f"Analysis error: {exc}")
        raise HTTPException(
            status_code=502, detail="Ошибка при анализе проекта (AI Service Error)"
        ) from exc
    try:
        normalized = _normalize_analyze_data(data)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="Некорректный формат анализа от AI"
        ) from exc

    analysis = Analysis(
        user_id=user.id,
        payload_text=description,
        investment_score=normalized["investment_score"],
        strengths=normalized["strengths"],
        weaknesses=normalized["weaknesses"],
        recommendations=normalized["recommendations"],
        market_summary=normalized["market_summary"],
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)

    return AnalysisResponse(
        id=analysis.id,
        name=payload.name,
        category=payload.category,
        investment_score=analysis.investment_score,
        strengths=analysis.strengths,
        weaknesses=analysis.weaknesses,
        recommendations=analysis.recommendations,
        market_summary=analysis.market_summary,
        created_at=analysis.created_at,
    )


@app.get("/analysis", response_model=list[AnalysisResponse])
async def list_analyses(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[AnalysisResponse]:
    res = await db.execute(
        select(Analysis)
        .where(Analysis.user_id == user.id)
        .order_by(Analysis.created_at.desc())
    )
    analyses = res.scalars().all()

    results = []
    for item in analyses:
        # Extract name and category from payload_text
        name = "Без названия"
        category = None

        if item.payload_text:
            lines = item.payload_text.split("\n")
            # Try to find specific lines
            for line in lines:
                line = line.strip()
                if line.startswith("Название:"):
                    name = line.replace("Название:", "").strip()
                elif line.startswith("Категория:"):
                    cat_val = line.replace("Категория:", "").strip()
                    if cat_val and cat_val != "—":
                        category = cat_val

            # Fallback if name wasn't found in format
            if name == "Без названия" and lines:
                potential_name = lines[0].strip()
                # If first line looks like a title (short enough)
                if len(potential_name) < 100 and not potential_name.startswith("Описание:"):
                    name = potential_name

        results.append(
            AnalysisResponse(
                id=item.id,
                name=name,
                category=category,
                investment_score=item.investment_score,
                strengths=item.strengths,
                weaknesses=item.weaknesses,
                recommendations=item.recommendations,
                market_summary=item.market_summary,
                created_at=item.created_at,
            )
        )
    return results


async def parse_thought_generator(generator):
    """
    Enhanced model output stream processor.
    Extracts <think>...</think> or <thought>...</thought> tags and yields them as metadata types.
    Preserves \n for Markdown tables and strips technical debris (<tool_call>, etc).
    """
    active_start_tag = None
    buffer = ""
    # We also want to strip debris like <tool_call>, <tool_thought>, and technical artifacts like 'IMIZE'
    tags = [("<thought>", "</thought>"), ("<think>", "</think>"), ("<tool_call>", "</tool_call>"), ("<tool_thought>", "</tool_thought>")]
    debris_patterns = ["<tool_call>", "</tool_call>", "<tool_thought>", "</tool_thought>", "IMIZE"]

    async for chunk in generator:
        if chunk is None:
            continue
            
        if isinstance(chunk, dict):
            # Flush buffer before handling metadata/dict chunks
            if buffer:
                if active_start_tag in ["<think>", "<thought>"]:
                    yield format_sse({"type": "thought", "content": buffer})
                else:
                    yield format_sse({"type": "chunk", "content": buffer})
                buffer = ""

            # Handle native reasoning_content 
            if "__thinking__" in chunk:
                yield format_sse({"type": "thought", "content": chunk["__thinking__"]})
                continue
            elif "__usage__" in chunk:
                # Pass usage directly as a wrapped JSON line
                yield format_sse({"type": "metadata", "usage": chunk["__usage__"]})
                continue
            else:
                # Pass through other dict objects (like TTFT signals)
                yield format_sse(chunk)
                continue

        # Handle text-based tags in the main content stream
        buffer += chunk
        
        # Strip technical trash from buffer if not inside a protected tag
        if not active_start_tag:
            for debris in debris_patterns:
                if debris in buffer:
                    buffer = buffer.replace(debris, "")

        while True:
            found_tag = False
            for start_tag, end_tag in tags:
                if not active_start_tag:
                    s_idx = buffer.find(start_tag)
                    if s_idx != -1:
                        # Content before the tag is a normal chunk
                        pre = buffer[:s_idx]
                        if pre:
                            yield format_sse({"type": "chunk", "content": pre})
                        
                        buffer = buffer[s_idx + len(start_tag):]
                        active_start_tag = start_tag
                        found_tag = True
                        break
                else:
                    # Only look for the end_tag corresponding to the current active_start_tag
                    if start_tag == active_start_tag:
                        e_idx = buffer.find(end_tag)
                        if e_idx != -1:
                            # Content inside tags is a thought (or soon-to-be-ignored tool call)
                            content = buffer[:e_idx]
                            is_thought = active_start_tag in ["<think>", "<thought>"]
                            
                            if is_thought and content:
                                yield format_sse({"type": "thought", "content": content})
                            
                            buffer = buffer[e_idx + len(end_tag):]
                            active_start_tag = None
                            found_tag = True
                            break
            
            if not found_tag:
                # If no complete tag found, yield what we can but keep a buffer
                # to avoid splitting a tag that might be coming in the next chunk.
                max_tag_len = 15 
                if not active_start_tag:
                    if len(buffer) > max_tag_len:
                        to_yield = buffer[:-max_tag_len]
                        buffer = buffer[-max_tag_len:]
                        yield format_sse({"type": "chunk", "content": to_yield})
                else:
                    # If we are inside thoughts, we can yield them parts
                    if len(buffer) > max_tag_len:
                        to_yield = buffer[:-max_tag_len]
                        buffer = buffer[-max_tag_len:]
                        if active_start_tag in ["<think>", "<thought>"]:
                            yield format_sse({"type": "thought", "content": to_yield})
                break
                    
    if buffer:
        # Final cleanup
        final_content = buffer
        for start_tag, end_tag in tags:
            final_content = final_content.replace(start_tag, "").replace(end_tag, "")
        
        if final_content:
            is_thought = active_start_tag in ["<think>", "<thought>"]
            yield format_sse({"type": "thought" if is_thought else "chunk", "content": final_content})

def save_assistant_message(session_id: int, content: str, thoughts: str | None = None, client_id: str | None = None, sources: list[dict] | None = None):
    from db import SessionLocal
    from models import ChatMessage as DbChatMessage
    db = SessionLocal()
    try:
        if client_id:
            existing = db.query(DbChatMessage).filter(
                DbChatMessage.session_id == session_id,
                DbChatMessage.client_id == client_id,
            ).first()
            if existing:
                return existing.id
        msg = DbChatMessage(
            session_id=session_id, 
            role="assistant", 
            content=content,
            thoughts=thoughts,
            client_id=client_id,
            sources=sources
        )
        db.add(msg)
        db.commit() # Сразу фиксируем в базе
        db.refresh(msg)
        return msg.id
    finally:
        db.close()


async def async_save_assistant_message(session_id: int, content: str, thoughts: str | None = None, client_id: str | None = None, sources: list[dict] | None = None) -> int:
    from db_async import AsyncSessionLocal
    from models import ChatMessage as DbChatMessage
    async with AsyncSessionLocal() as db:
        if client_id:
            existing_result = await db.execute(select(DbChatMessage).where(
                DbChatMessage.session_id == session_id,
                DbChatMessage.client_id == client_id,
            ))
            existing = existing_result.scalar_one_or_none()
            if existing:
                return existing.id
        msg = DbChatMessage(
            session_id=session_id,
            role="assistant",
            content=content,
            thoughts=thoughts,
            client_id=client_id,
            sources=sources
        )
        db.add(msg)
        # flush before commit so the PK is readable regardless of the
        # session's expire_on_commit setting (export flow needs the id).
        await db.flush()
        new_id = msg.id
        await db.commit()
        return new_id


def replay_chat_message(message: DbChatMessage) -> EventSourceResponse:
    """Replay an already completed idempotent request as a short SSE stream."""
    async def replay_generator():
        yield format_sse({"type": "metadata", "model": "Pitchy (replay)"})
        if message.sources:
            yield format_sse({"type": "sources", "data": message.sources})
        if message.thoughts:
            yield format_sse({"type": "thought", "content": message.thoughts})
        yield format_sse({"type": "chunk", "content": message.content or ""})

    return EventSourceResponse(
        replay_generator(),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/chat", deprecated=True, include_in_schema=False)
async def chat(payload: ChatRequest):
    raise HTTPException(
        status_code=410,
        detail="Legacy chat endpoint retired; use POST /chat/sessions/{session_id}/messages",
    )

    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages is required")

    last_user = next((m.content for m in reversed(payload.messages) if m.role == "user"), "")
    if not last_user:
        raise HTTPException(status_code=400, detail="last user message is required")

    try:
        # Parallel RAG
        context_chunks = await asyncio.to_thread(rag.get_relevant_chunks, last_user, top_k=3)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_prompt = _build_chat_prompt(payload.messages, context_chunks)
    provider = os.getenv("PRIMARY_PROVIDER", "makura")

    async def chat_generator():
        full_response = ""
        try:
            raw_gen = stream_makura(SYSTEM_CHAT_PROMPT, user_prompt)
            async for json_chunk in parse_thought_generator(raw_gen):
                # Usage sentinel passed as dict
                if isinstance(json_chunk, dict):
                    if "__usage__" in json_chunk:
                        usage_data = json_chunk["__usage__"]
                    continue

                data = json.loads(json_chunk.strip())
                if data["type"] == "chunk":
                    full_response += data["content"]
                yield json_chunk
        except Exception as e:
            logger.error(f"Streaming failed: {e}")
            yield format_sse({"type": "error", "content": str(e)})
        finally:
            # We don't have a session_id here for anonymous /chat, 
            # but if this endpoint is ever used with a session, we should save it.
            # Currently /chat is used for the very first message before session exists.
            # So we might not need to save here if the session is created later.
            # However, for consistency with other endpoints:
            pass

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }
    return EventSourceResponse(chat_generator(), headers=headers)


@app.patch("/chat/sessions/{session_id}", response_model=ChatSessionResponse)
async def rename_chat_session(
    session_id: int,
    payload: ChatSessionCreateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ChatSessionResponse:
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user.id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    session.title = payload.title
    await db.commit()
    await db.refresh(session)
    return ChatSessionResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
    )


@app.delete("/chat/sessions/{session_id}")
async def delete_chat_session(
    session_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user.id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    from sqlalchemy import delete
    await db.execute(delete(DbChatMessage).where(DbChatMessage.session_id == session.id))
    await db.delete(session)
    await db.commit()
    return {"status": "ok", "deleted_id": session_id}


@app.get("/chat/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
async def list_chat_messages(
    session_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[ChatMessageResponse]:
    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user.id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    msg_result = await db.execute(
        select(DbChatMessage)
        .where(DbChatMessage.session_id == session.id)
        .order_by(DbChatMessage.created_at.asc())
    )
    messages = msg_result.scalars().all()
    return [ChatMessageResponse.model_validate(m) for m in messages]


@app.post("/chat/messages", deprecated=True, include_in_schema=False)
@observe(name="create_chat_message")
async def create_chat_message(
    payload: ChatMessageCreateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> StreamingResponse:
    raise HTTPException(
        status_code=410,
        detail="Legacy chat endpoint retired; use POST /chat/sessions/{session_id}/messages",
    )

    if langfuse_context:
        langfuse_context.update_current_trace(
            user_id=str(user.id),
            session_id=str(payload.session_id)
        )

    result = await db.execute(select(ChatSession).where(ChatSession.id == payload.session_id, ChatSession.user_id == user.id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    user_message = DbChatMessage(
        session_id=session.id, role="user", content=payload.content, client_id=payload.client_id
    )
    db.add(user_message)
    await db.commit()
    await db.refresh(user_message)

    msg_result = await db.execute(
        select(DbChatMessage)
        .where(DbChatMessage.session_id == session.id)
        .order_by(DbChatMessage.created_at.asc())
    )
    history = msg_result.scalars().all()
    chat_messages = [ChatMessage(role=m.role, content=m.content) for m in history]

    context_chunks = [] # Initialize context_chunks
    try:
        if payload.use_research:
            # New streaming research agent
            logger.info(f"Triggering Streaming Deep Research in chat for session {session.id}")
            
            async def research_generator():
                full_content = ""
                try:
                    async for chunk in stream_deep_research(payload.content):
                        if chunk["type"] == "chunk":
                            full_content += chunk["content"]
                        yield format_sse(chunk)
                finally:
                    # Save assistant message
                    if full_content.strip():
                        async def _save_r_bg():
                            try:
                                await async_save_assistant_message(
                                    session_id=session.id,
                                    content=full_content.strip(),
                                    thoughts="Глубокое исследование завершено.",
                                    client_id=payload.assistant_client_id
                                )
                            except Exception as bg_err:
                                logger.error(f"Background async_save_assistant_message failed: {bg_err}")
                        asyncio.create_task(_save_r_bg())
                    # Report usage to Langfuse if available
                    if langfuse_context:
                        est_tokens = (len(payload.content) + len(full_content)) // 4
                        langfuse_context.update_current_observation(
                            usage={"total": est_tokens},
                            metadata={"type": "deep_research"}
                        )

            return StreamingResponse(
                research_generator(), 
                media_type="text/event-stream",
                headers={
                    "X-Accel-Buffering": "no",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive"
                }
            )

        # --- Synchronized Architecture Transformation ---
        # Instrumentation: Pre-processing (Trace propagation handled by @observe on sub-functions)
        try:
            # 1. Parallel Execution (Intent classification + RAG retrieval)
            si_task = asyncio.create_task(slm_dispatcher.classify_query_intent(payload.content))
            
            # Graceful Degradation: проверяем, прогрета ли база
            if rag.healthcheck():
                ch_task = asyncio.to_thread(rag.get_relevant_chunks, payload.content, top_k=10)
            else:
                async def _skip_rag():
                    logger.warning("RAG is warming up. Skipping vector retrieval.")
                    return []
                ch_task = asyncio.create_task(_skip_rag())
            
            # Wait for parallel tasks to finish
            results = await asyncio.gather(si_task, ch_task, return_exceptions=True)
            
            slm_res = results[0] if not isinstance(results[0], Exception) else {}
            rag_chunks = results[1] if not isinstance(results[1], Exception) else []
        except Exception as e:
            logger.error(f"Preprocessing error: {e}")
            slm_res, rag_chunks = {}, []
        
        is_deep_search = slm_res.get("is_deep_search", False)
        is_finance = slm_res.get("is_finance", False)
        
        # 2. Dynamic Web Search (Exa AI)
        search_context = ""
        sources_list = []
        if is_deep_search:
            # Using high-level async search with sources (decorated with @observe)
            search_sources, exa_context = await async_search_with_sources(payload.content, use_deep_search=False)
            sources_list = search_sources
            search_context = exa_context
            
        # 3. Analytical Swarm (Map-Reduce)
        swarm_facts = ""
        rag_texts = [c["text"] if isinstance(c, dict) else c for c in rag_chunks]
        chunks_to_swarm = rag_texts[:10]
        if search_context:
            chunks_to_swarm.append(search_context)
            
        if chunks_to_swarm:
            try:
                # Analytical Swarm with 5s safety timeout (decorated with @observe)
                swarm_res = await asyncio.wait_for(run_analytical_swarm(chunks_to_swarm), timeout=5.0)
                facts = []
                for item in swarm_res:
                    if getattr(item, 'competitors', []):
                        facts.append("Конкуренты: " + ", ".join(item.competitors))
                    if getattr(item, 'metrics', []):
                        facts.append("Метрики: " + "; ".join(item.metrics))
                
                if facts:
                    swarm_facts = "\n- ".join(set(facts))
            except Exception as swarm_err:
                logger.warning(f"Swarm analysis bypassed: {swarm_err}")

        # Assemble Context
        context_chunks = []
        if search_context:
            context_chunks.append(f"[ДАННЫЕ ИЗ ИНТЕРНЕТА]:\n{search_context}")
        
        if swarm_facts:
            context_chunks.append(f"[ПРОВЕРЕННЫЕ ФАКТЫ ОТ РОЯ АНАЛИТИКОВ]:\n{swarm_facts}")
        elif rag_texts:
            # Fallback: если рой не нашел фактов или упал по таймауту
            context_chunks.append(f"[ДАННЫЕ ИЗ БАЗЫ ЗНАНИЙ]:\n{chr(10).join(rag_texts[:3])}")
        
    except Exception as e:
        logger.error(f"Synchronized preprocessing failed: {e}")
    # -----------------------------------

    user_prompt = _build_chat_prompt(chat_messages, context_chunks)
    provider = os.getenv("PRIMARY_PROVIDER", "makura")

    async def session_chat_generator():
        full_text = ""
        full_thoughts = ""
        ttft = None
        start_time = time.time()
        usage_data = {}
        
        try:
            # Yield initial metadata
            yield format_sse({"type": "metadata", "model": provider})
            if sources_list:
                yield format_sse({"type": "sources", "data": sources_list})

            if provider == "makura":
                raw_gen = stream_makura(SYSTEM_CHAT_PROMPT, user_prompt)
            else:
                raw_gen = stream_makura(SYSTEM_CHAT_PROMPT, user_prompt)
                
            async for json_chunk in parse_thought_generator(raw_gen):
                if isinstance(json_chunk, dict):
                    # Internal metadata from parse_thought_generator
                    if json_chunk.get("type") == "metadata":
                        usage_data = json_chunk.get("usage", {})
                    continue

                if ttft is None:
                    ttft = time.time() - start_time
                
                data = json.loads(json_chunk.strip())
                if data["type"] == "chunk":
                    full_text += data["content"]
                elif data["type"] == "thought":
                    full_thoughts += data["content"]
                yield json_chunk

        except Exception as e:
            logger.error(f"Streaming failed: {e}")
            yield format_sse({"type": "error", "content": str(e)})
        finally:
            if full_text.strip() or full_thoughts.strip():
                # Rescue save logic
                async def _save_bg():
                    try:
                        await async_save_assistant_message( 
                            session_id=session.id, 
                            content=full_text.strip(),
                            thoughts=full_thoughts.strip() if full_thoughts.strip() else None,
                            client_id=payload.assistant_client_id,
                            sources=sources_list if sources_list else None
                        )
                    except Exception as bg_err:
                        logger.error(f"Background async_save_assistant_message failed: {bg_err}")

                asyncio.create_task(_save_bg())

            # Final Langfuse update
            if langfuse_context and (full_text or full_thoughts):
                try:
                    update_params = {
                        "input": payload.content,
                        "output": f"<thought>{full_thoughts}</thought>\n\n{full_text}" if full_thoughts else full_text,
                        "metadata": {"ttft": ttft} if ttft else {}
                    }
                    if usage_data:
                        update_params["usage"] = {
                            "input": usage_data.get("prompt_tokens", 0),
                            "output": usage_data.get("completion_tokens", 0),
                            "total": usage_data.get("total_tokens", 0)
                        }
                    langfuse_context.update_current_observation(**update_params)
                except Exception as lf_err:
                    logger.error(f"Langfuse update failed: {lf_err}")

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }
    return EventSourceResponse(_with_heartbeat(session_chat_generator()), headers=headers)


@app.get("/chat/messages/search")
async def search_chat_messages(
    query: str,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[dict]:
    if not query.strip():
        return []
    result = await db.execute(
        select(DbChatMessage, ChatSession)
        .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
        .where(ChatSession.user_id == user.id)
        .where(DbChatMessage.content.ilike(f"%{query}%"))
        .order_by(DbChatMessage.created_at.desc())
        .limit(50)
    )
    messages = result.all()
    return [
        {
            "id": msg.id,
            "session_id": session.id,
            "title": session.title,
            "role": msg.role,
            "content": msg.content,
            "created_at": msg.created_at,
        }
        for msg, session in messages
    ]


# ——— Tools API (Search & Research) ———

@app.get("/api/tools/history", response_model=list[ToolResultResponse])
async def get_tools_history(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[ToolResultResponse]:
    """Возвращает историю использования инструментов (поиск и исследования)."""
    result = await db.execute(
        select(ToolResult)
        .where(ToolResult.user_id == user.id)
        .order_by(ToolResult.created_at.desc())
    )
    return result.scalars().all()


@app.get("/api/tools/results/{result_id}", response_model=ToolResultResponse)
async def get_tool_result(
    result_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ToolResultResponse:
    """Возвращает конкретный результат из истории."""
    result = await db.execute(select(ToolResult).where(ToolResult.id == result_id, ToolResult.user_id == user.id))
    tool_res = result.scalar_one_or_none()
    if not tool_res:
        raise HTTPException(status_code=404, detail="Result not found")
    return tool_res


@app.delete("/api/tools/results/{result_id}")
async def delete_tool_result(
    result_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Удаляет результат из истории."""
    result = await db.execute(select(ToolResult).where(ToolResult.id == result_id, ToolResult.user_id == user.id))
    tool_res = result.scalar_one_or_none()
    if not tool_res:
        raise HTTPException(status_code=404, detail="Result not found")
    await db.delete(tool_res)
    await db.commit()
    return {"status": "ok"}


@app.post("/api/tools/quick-search", response_model=ToolResultResponse)
async def tool_quick_search(
    payload: ToolSearchRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ToolResultResponse:
    """Запускает быстрый региональный поиск и сохраняет результат в историю."""
    await async_check_subscription_limits(user, db, "tool", feature="deep_search")
    sources, context = await async_search_with_sources(payload.query, use_deep_search=False)
    
    # Store result
    result = ToolResult(
        user_id=user.id,
        query=payload.query,
        tool_type="quick-search",
        content=context,
        sources=sources
    )
    db.add(result)
    await db.commit()
    await db.refresh(result)
    return result


@app.post("/api/tools/deep-research", response_model=ToolResultResponse)
async def tool_deep_research(
    payload: ToolResearchRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ToolResultResponse:
    """Запускает глубокое агентное исследование и сохраняет отчет в историю."""
    await async_check_subscription_limits(user, db, "tool", feature="deep_research")
    content, sources = await execute_deep_research(payload.query)
    
    # Store result
    result = ToolResult(
        user_id=user.id,
        query=payload.query,
        tool_type="deep-research",
        content=content,
        sources=sources
    )
    db.add(result)
    await db.commit()
    await db.refresh(result)
    return result
@app.post("/chat/import-context", response_model=ImportContextResponse)
async def api_import_context(
    payload: ImportContextRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ImportContextResponse:
    """Parses text/json from external LLMs and saves it to RAG & optionally ChatSession."""
    await async_check_subscription_limits(user, db, "tool", feature="import")
    try:
        context, message = await ImportParser.parse(payload.text)
        
        # Save raw_text to RAG
        if context and context.raw_text:
            import asyncio
            await asyncio.to_thread(rag.add_text_to_rag, context.raw_text)
            
        # If session_id is provided, inject a system message
        if payload.session_id:
            res = await db.execute(select(ChatSession).where(
                ChatSession.id == payload.session_id,
                ChatSession.user_id == user.id
            ))
            session = res.scalar_one_or_none()
            if session:
                context_str = context.model_dump_json() if context else "Не удалось структурировать."
                sys_msg = DbChatMessage(
                    session_id=session.id,
                    role="system",
                    content=f"Пользователь импортировал данные из внешней сессии. Основные тезисы: {context_str}",
                )
                db.add(sys_msg)
                await db.commit()

        return ImportContextResponse(success=True, summary=context, message=message)
    except Exception as e:
        logger.error(f"Import failed: {e}")
        return ImportContextResponse(success=False, message=str(e))


@app.get("/admin/users", response_model=list[UserResponse])
async def admin_users(
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> list[UserResponse]:
    res = await db.execute(select(User).order_by(User.created_at.desc()))
    users = res.scalars().all()
    return [
        UserResponse(
            id=u.id,
            email=u.email,
            name=u.name,
            is_admin=u.is_admin,
            is_active=u.is_active,
            email_verified=u.email_verified,
            created_at=u.created_at,
            subscription_tier=u.subscription_tier,
            subscription_expires_at=u.subscription_expires_at,
            onboarding_completed_at=u.onboarding_completed_at,
        )
        for u in users
    ]


def _stage_audit_entry(
    db: AsyncSession,
    admin: User,
    action: str,
    target_type: str | None = None,
    target_id: str | int | None = None,
    details: dict | None = None,
    request: Request | None = None,
) -> None:
    """Add an admin_audit_log row to the current session. Caller commits.

    Staged (not committed) so the audit lives or dies with the action it
    describes — if the action fails and rolls back, the audit goes with
    it instead of recording a phantom event.
    """
    entry = AdminAuditLog(
        admin_id=admin.id,
        admin_email=admin.email,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        details=details,
        ip_address=(request.client.host if request and request.client else None),
        user_agent=(request.headers.get("user-agent", "")[:500] if request else None),
    )
    db.add(entry)


@app.post("/admin/users/{user_id}/block")
async def admin_block_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    _stage_audit_entry(db, admin, "user.block", "user", user_id,
                       details={"target_email": user.email}, request=request)
    await db.commit()
    return {"status": "ok"}


@app.post("/admin/users/{user_id}/unblock")
async def admin_unblock_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = True
    _stage_audit_entry(db, admin, "user.unblock", "user", user_id,
                       details={"target_email": user.email}, request=request)
    await db.commit()
    return {"status": "ok"}


@app.post("/admin/users/{user_id}/make-admin")
async def admin_make_admin(
    user_id: int,
    request: Request,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_admin = True
    _stage_audit_entry(db, admin, "user.make_admin", "user", user_id,
                       details={"target_email": user.email}, request=request)
    await db.commit()
    return {"status": "ok"}


@app.delete("/admin/users/{user_id}")
async def admin_delete_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Soft-delete a user: set deleted_at, anonymize email/name, deactivate.
    Child data (analyses, chat sessions) is preserved for audit purposes.
    A fresh registration with the original email is now possible because
    the user's email is rewritten into the reserved deleted.pitchy.pro space.
    """
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.deleted_at is not None:
        raise HTTPException(status_code=400, detail="User already deleted")

    original_email = user.email
    target_snapshot = {
        "target_email": original_email,
        "target_name": user.name,
        "target_subscription_tier": user.subscription_tier,
    }

    now = datetime.utcnow()
    user.deleted_at = now
    user.is_active = False
    user.email = f"deleted-{user.id}@deleted.pitchy.pro"
    user.name = "Удалённый пользователь"
    user.password_hash = None  # password login disabled
    user.email_verify_token_hash = None
    user.email_verify_code_hash = None
    user.password_reset_token_hash = None

    _stage_audit_entry(db, admin, "user.delete", "user", user_id,
                       details=target_snapshot, request=request)

    await db.commit()
    return {"status": "ok", "soft_deleted": True}


@app.get("/admin/audit")
async def admin_audit(
    limit: int = 100,
    offset: int = 0,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Read the admin audit trail, most recent first."""
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    res = await db.execute(
        select(AdminAuditLog)
        .order_by(AdminAuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = res.scalars().all()
    return {
        "entries": [
            {
                "id": r.id,
                "admin_id": r.admin_id,
                "admin_email": r.admin_email,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "details": r.details,
                "ip_address": r.ip_address,
                "user_agent": r.user_agent,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@app.get("/admin/analytics")
async def admin_analytics(
    start: date | None = None,
    end: date | None = None,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    async def _count_absolute(model):
        res = await db.execute(select(sa_func.count()).select_from(model))
        return res.scalar()

    total_users = await _count_absolute(User)
    total_analyses = await _count_absolute(Analysis)
    total_analyses_anonymous = (await db.execute(select(sa_func.count()).select_from(Analysis).where(Analysis.user_id == None))).scalar()
    total_sessions = await _count_absolute(ChatSession)
    total_sessions_anonymous = (await db.execute(select(sa_func.count()).select_from(ChatSession).where(ChatSession.user_id == None))).scalar()
    total_messages = await _count_absolute(DbChatMessage)
    total_errors = await _count_absolute(ErrorLog)
    total_subscriptions = (await db.execute(select(sa_func.count()).select_from(User).where(User.subscription_tier != "free"))).scalar()

    delta = end_date - start_date
    is_hourly = delta.days <= 3

    series_dict = {}
    if is_hourly:
        curr = start_dt
        while curr <= end_dt:
            key = curr.strftime("%Y-%m-%d %H:00")
            series_dict[key] = {
                "date": key,
                "users": 0, "analyses": 0, "chat_sessions": 0, "chat_messages": 0, "errors": 0, "subscriptions": 0
            }
            curr += timedelta(hours=1)
    else:
        curr = start_date
        while curr <= end_date:
            key = curr.strftime("%Y-%m-%d")
            series_dict[key] = {
                "date": key,
                "users": 0, "analyses": 0, "chat_sessions": 0, "chat_messages": 0, "errors": 0, "subscriptions": 0
            }
            curr += timedelta(days=1)

    def _format_key(dt):
        if not dt: return None
        return dt.strftime("%Y-%m-%d %H:00") if is_hourly else dt.strftime("%Y-%m-%d")

    res_users = await db.execute(select(User.created_at, User.subscription_tier).where(User.created_at.between(start_dt, end_dt)))
    users_q = res_users.all()
    for (dt, tier) in users_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["users"] += 1
            if tier != "free":
                series_dict[k]["subscriptions"] += 1

    res_analyses = await db.execute(select(Analysis.created_at).where(Analysis.created_at.between(start_dt, end_dt)))
    analyses_q = res_analyses.all()
    for (dt,) in analyses_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["analyses"] += 1

    res_sessions = await db.execute(select(ChatSession.created_at).where(ChatSession.created_at.between(start_dt, end_dt)))
    sessions_q = res_sessions.all()
    for (dt,) in sessions_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["chat_sessions"] += 1

    res_messages = await db.execute(select(DbChatMessage.created_at).where(DbChatMessage.created_at.between(start_dt, end_dt)))
    messages_q = res_messages.all()
    for (dt,) in messages_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["chat_messages"] += 1

    res_errors = await db.execute(select(ErrorLog.created_at).where(ErrorLog.created_at.between(start_dt, end_dt)))
    errors_q = res_errors.all()
    for (dt,) in errors_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["errors"] += 1

    series = list(series_dict.values())

    return {
        "range": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "totals": {
            "users": total_users,
            "analyses": total_analyses,
            "analyses_anon": total_analyses_anonymous,
            "chat_sessions": total_sessions,
            "chat_sessions_anon": total_sessions_anonymous,
            "chat_messages": total_messages,
            "errors": total_errors,
            "subscriptions": total_subscriptions,
        },
        "series": series,
    }


@app.get("/admin/top-users")
async def admin_top_users(
    start: date | None = None,
    end: date | None = None,
    limit: int = 10,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> list[dict]:
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    res_an = await db.execute(
        select(Analysis.user_id, Analysis.id)
        .where(Analysis.created_at.between(start_dt, end_dt))
    )
    analyses = res_an.all()
    res_msg = await db.execute(
        select(ChatSession.user_id, DbChatMessage.id)
        .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
        .where(DbChatMessage.created_at.between(start_dt, end_dt))
    )
    messages = res_msg.all()
    analysis_counts: dict[int, int] = {}
    message_counts: dict[int, int] = {}
    for user_id, _ in analyses:
        analysis_counts[user_id] = analysis_counts.get(user_id, 0) + 1
    for user_id, _ in messages:
        message_counts[user_id] = message_counts.get(user_id, 0) + 1

    user_ids = set(analysis_counts.keys()) | set(message_counts.keys())
    users = []
    if user_ids:
        res_user = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = res_user.scalars().all()
    items = []
    for user in users:
        analyses_count = analysis_counts.get(user.id, 0)
        messages_count = message_counts.get(user.id, 0)
        total = analyses_count + messages_count
        items.append(
            {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "analyses": analyses_count,
                "messages": messages_count,
                "total": total,
            }
        )
    items.sort(key=lambda x: x["total"], reverse=True)
    return items[: max(1, min(limit, 50))]


@app.get("/admin/errors")
async def admin_errors(
    start: date | None = None,
    end: date | None = None,
    limit: int = 50,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    res = await db.execute(
        select(ErrorLog)
        .where(ErrorLog.created_at.between(start_dt, end_dt))
        .order_by(ErrorLog.created_at.desc())
        .limit(max(1, min(limit, 200)))
    )
    errors = res.scalars().all()
    return {
        "count": len(errors),
        "items": [
            {
                "id": err.id,
                "user_id": err.user_id,
                "path": err.path,
                "method": err.method,
                "status_code": err.status_code,
                "detail": err.detail,
                "created_at": err.created_at,
            }
            for err in errors
        ],
    }


@app.get("/admin/errors/export")
async def admin_errors_export(
    start: date | None = None,
    end: date | None = None,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    res = await db.execute(
        select(ErrorLog)
        .where(ErrorLog.created_at.between(start_dt, end_dt))
        .order_by(ErrorLog.created_at.desc())
    )
    errors = res.scalars().all()

    def _iter():
        yield "id,created_at,status_code,method,path,user_id,detail\n"
        for err in errors:
            detail = str(err.detail).replace('"', '""')
            yield (
                f'{err.id},{err.created_at},{err.status_code},{err.method},'
                f'{err.path},{err.user_id or ""},"{detail}"\n'
            )

    return StreamingResponse(_iter(), media_type="text/csv")


@app.get("/admin/promocodes", response_model=list[PromoCodeResponse])
async def get_promocodes(
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> list[PromoCodeResponse]:
    res = await db.execute(select(PromoCode).order_by(PromoCode.created_at.desc()))
    return res.scalars().all()


def _promo_campaign_dict(campaign: PromoCampaign) -> dict:
    succeeded = [r for r in campaign.redemptions if r.status == "succeeded"]
    reserved = [r for r in campaign.redemptions if r.status == "reserved"]
    codes = sorted(campaign.codes, key=lambda item: item.created_at, reverse=True)
    return {
        "id": campaign.id,
        "name": campaign.name,
        "description": campaign.description,
        "status": campaign.status,
        "benefit_type": campaign.benefit_type,
        "discount_percent": campaign.discount_percent,
        "fixed_price": float(campaign.fixed_price) if campaign.fixed_price is not None else None,
        "target_tier": campaign.target_tier,
        "starts_at": campaign.starts_at,
        "ends_at": campaign.ends_at,
        "max_redemptions": campaign.max_redemptions,
        "per_user_limit": campaign.per_user_limit,
        "first_payment_only": campaign.first_payment_only,
        "code_mode": campaign.code_mode,
        "code_prefix": campaign.code_prefix,
        "post_promo_action": campaign.post_promo_action,
        "renewal_config": campaign.renewal_config,
        "renewal_price_policy": campaign.renewal_price_policy,
        "renewal_fixed_price": (
            float(campaign.renewal_fixed_price)
            if campaign.renewal_fixed_price is not None
            else None
        ),
        "renewal_notice_days": campaign.renewal_notice_days,
        "created_at": campaign.created_at,
        "updated_at": campaign.updated_at,
        "codes_count": len(codes),
        "redemptions_count": len(succeeded),
        "reserved_count": len(reserved),
        "revenue": round(sum(float(r.final_amount) for r in succeeded), 2),
        "discount_total": round(sum(float(r.discount_amount) for r in succeeded), 2),
        "codes": [
            {
                "id": code.id,
                "code": code.code,
                "is_active": code.is_active,
                "current_uses": code.current_uses,
                "max_uses": code.max_uses,
                "assigned_user_id": code.assigned_user_id,
                "expires_at": code.expires_at,
            }
            for code in codes[:100]
        ],
    }


def _utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


async def _load_promo_campaign(db: AsyncSession, campaign_id: int) -> PromoCampaign | None:
    from sqlalchemy.orm import selectinload

    return (await db.execute(
        select(PromoCampaign)
        .options(
            selectinload(PromoCampaign.codes),
            selectinload(PromoCampaign.redemptions),
        )
        .where(PromoCampaign.id == campaign_id)
    )).scalar_one_or_none()


async def _generate_campaign_codes(
    db: AsyncSession,
    campaign: PromoCampaign,
    *,
    count: int,
    prefix: str | None,
    shared_code: str | None = None,
) -> list[PromoCode]:
    normalized_prefix = "".join(ch for ch in (prefix or "PROMO").upper() if ch.isalnum())[:20] or "PROMO"
    if shared_code:
        candidates = [shared_code.strip().upper()]
    else:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        candidates: list[str] = []
        while len(candidates) < count:
            candidate = f"{normalized_prefix}-{''.join(secrets.choice(alphabet) for _ in range(8))}"
            if candidate not in candidates:
                candidates.append(candidate)

    existing = set((await db.execute(
        select(PromoCode.code).where(PromoCode.code.in_(candidates))
    )).scalars().all())
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Промокод уже существует: {sorted(existing)[0]}",
        )

    per_code_limit = 1 if campaign.code_mode == "bulk" else campaign.max_redemptions
    created = [
        PromoCode(
            code=code,
            campaign_id=campaign.id,
            discount_percent=int(campaign.discount_percent or 0),
            target_tier=campaign.target_tier,
            fixed_price=campaign.fixed_price,
            max_uses=per_code_limit,
            expires_at=campaign.ends_at,
            is_active=True,
        )
        for code in candidates
    ]
    db.add_all(created)
    await db.flush()
    return created


@app.get("/admin/promo-campaigns")
async def get_promo_campaigns(
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> list[dict]:
    from sqlalchemy.orm import selectinload

    campaigns = (await db.execute(
        select(PromoCampaign)
        .options(
            selectinload(PromoCampaign.codes),
            selectinload(PromoCampaign.redemptions),
        )
        .order_by(PromoCampaign.created_at.desc())
    )).scalars().all()
    return [_promo_campaign_dict(campaign) for campaign in campaigns]


@app.post("/admin/promo-campaigns")
async def create_promo_campaign(
    payload: PromoCampaignCreate,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    from subscription_service import BASE_CONFIG, normalize_config

    if payload.benefit_type == "percent_discount" and payload.discount_percent is None:
        raise HTTPException(status_code=422, detail="Укажите процент скидки")
    if payload.benefit_type == "fixed_price" and payload.fixed_price is None:
        raise HTTPException(status_code=422, detail="Укажите фиксированную цену")
    if payload.ends_at and payload.starts_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="Дата окончания должна быть позже даты начала")
    if payload.code_mode == "shared" and not payload.code:
        raise HTTPException(status_code=422, detail="Для общего режима укажите промокод")
    if payload.renewal_price_policy == "fixed" and payload.renewal_fixed_price is None:
        raise HTTPException(status_code=422, detail="Укажите фиксированную цену продления")

    renewal_config = None
    if payload.post_promo_action in ("offer", "renew_base"):
        try:
            renewal_config = normalize_config(payload.renewal_config or BASE_CONFIG)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    campaign = PromoCampaign(
        name=payload.name.strip(),
        description=payload.description,
        status=payload.status,
        benefit_type=payload.benefit_type,
        discount_percent=payload.discount_percent if payload.benefit_type == "percent_discount" else None,
        fixed_price=payload.fixed_price if payload.benefit_type == "fixed_price" else None,
        target_tier=payload.target_tier,
        starts_at=_utc_naive(payload.starts_at),
        ends_at=_utc_naive(payload.ends_at),
        max_redemptions=payload.max_redemptions,
        per_user_limit=payload.per_user_limit,
        first_payment_only=payload.first_payment_only,
        code_mode=payload.code_mode,
        code_prefix=payload.code_prefix,
        post_promo_action=payload.post_promo_action,
        renewal_config=renewal_config,
        renewal_price_policy=payload.renewal_price_policy,
        renewal_fixed_price=payload.renewal_fixed_price,
        renewal_notice_days=payload.renewal_notice_days,
    )
    db.add(campaign)
    await db.flush()
    await _generate_campaign_codes(
        db,
        campaign,
        count=payload.generate_count if payload.code_mode == "bulk" else 1,
        prefix=payload.code_prefix,
        shared_code=payload.code if payload.code_mode == "shared" else None,
    )
    await db.commit()
    loaded = await _load_promo_campaign(db, campaign.id)
    return _promo_campaign_dict(loaded)


@app.patch("/admin/promo-campaigns/{campaign_id}")
async def update_promo_campaign(
    campaign_id: int,
    payload: PromoCampaignUpdate,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    from subscription_service import normalize_config

    campaign = (await db.execute(
        select(PromoCampaign).where(PromoCampaign.id == campaign_id).with_for_update()
    )).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Промокампания не найдена")

    values = payload.model_dump(exclude_unset=True)
    for date_key in ("starts_at", "ends_at"):
        if date_key in values:
            values[date_key] = _utc_naive(values[date_key])
    if "renewal_config" in values and values["renewal_config"] is not None:
        try:
            values["renewal_config"] = normalize_config(values["renewal_config"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    for key, value in values.items():
        setattr(campaign, key, value)
    if campaign.ends_at and campaign.starts_at and campaign.ends_at <= campaign.starts_at:
        raise HTTPException(status_code=422, detail="Дата окончания должна быть позже даты начала")
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    loaded = await _load_promo_campaign(db, campaign.id)
    return _promo_campaign_dict(loaded)


@app.post("/admin/promo-campaigns/{campaign_id}/codes")
async def generate_promo_campaign_codes(
    campaign_id: int,
    payload: PromoCodesGenerateRequest,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    campaign = (await db.execute(
        select(PromoCampaign).where(PromoCampaign.id == campaign_id)
    )).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(status_code=404, detail="Промокампания не найдена")
    if campaign.code_mode != "bulk":
        raise HTTPException(status_code=409, detail="Дополнительные коды доступны только для пула")
    await _generate_campaign_codes(
        db,
        campaign,
        count=payload.count,
        prefix=payload.prefix or campaign.code_prefix,
    )
    await db.commit()
    loaded = await _load_promo_campaign(db, campaign.id)
    return _promo_campaign_dict(loaded)


@app.post("/admin/promocodes", response_model=PromoCodeResponse)
async def create_promocode(
    payload: PromoCodeCreate,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> PromoCodeResponse:
    res = await db.execute(select(PromoCode).where(PromoCode.code == payload.code.upper()))
    exists = res.scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Promo code already exists")
        
    promo = PromoCode(
        code=payload.code.upper(),
        discount_percent=payload.discount_percent,
        target_tier=payload.target_tier,
        fixed_price=payload.fixed_price,
        max_uses=payload.max_uses,
        expires_at=payload.expires_at,
    )
    db.add(promo)
    await db.commit()
    await db.refresh(promo)
    return promo


@app.delete("/admin/promocodes/{promo_id}")
async def delete_promocode(
    promo_id: int,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(PromoCode).where(PromoCode.id == promo_id))
    promo = res.scalar_one_or_none()
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
        
    await db.delete(promo)
    await db.commit()
    return {"status": "ok"}


@app.get("/admin/subscriptions", response_model=list[SubscriptionResponse])
async def admin_subscriptions(
    tier: str | None = None,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """List all users with active or expired subscriptions."""
    query = select(User).where(
        User.subscription_tier != "free",
        User.deleted_at.is_(None),
    )
    if tier and tier != "all":
        query = query.where(User.subscription_tier == tier)

    query = query.order_by(User.subscription_expires_at.desc().nullslast())
    res_users = await db.execute(query)
    users = res_users.scalars().all()
    result = []
    
    from sqlalchemy.orm import selectinload
    for u in users:
        # Get the latest succeeded payment
        last_payment_res = await db.execute(
            select(Payment)
            .options(selectinload(Payment.promo_code))
            .where(Payment.user_id == u.id, Payment.status == "succeeded")
            .order_by(Payment.created_at.desc())
            .limit(1)
        )
        last_payment = last_payment_res.scalar_one_or_none()
        
        # Count total payments and total amount spent
        totals_res = await db.execute(
            select(
                sa_func.count(Payment.id).label("count"),
                sa_func.coalesce(sa_func.sum(Payment.amount), 0).label("total"),
            )
            .where(Payment.user_id == u.id, Payment.status == "succeeded")
        )
        totals = totals_res.first()

        promo_code_used = None
        if last_payment and last_payment.promo_code:
            promo_code_used = last_payment.promo_code.code

        now = datetime.utcnow()
        is_active = (
            u.subscription_expires_at is not None
            and u.subscription_expires_at > now
        )

        result.append(SubscriptionResponse(
            user_id=u.id,
            email=u.email,
            name=u.name,
            subscription_tier=u.subscription_tier,
            subscription_expires_at=u.subscription_expires_at,
            is_active=is_active,
            last_payment_date=last_payment.created_at if last_payment else None,
            last_payment_amount=float(last_payment.amount) if last_payment else None,
            last_payment_status=last_payment.status if last_payment else None,
            promo_code_used=promo_code_used,
            total_payments=totals.count if totals else 0,
            total_spent=float(totals.total) if totals else 0,
        ))
    return result


@app.post("/admin/rag/add-url", response_model=AdminRAGResponse)
async def admin_add_rag_url(
    req: AdminRAGRequest,
    db: AsyncSession = Depends(get_async_db),
    _: User = Depends(require_async_admin),
):
    """
    Scrapes a URL, saves the text, and injects it into the active RAG collection.
    """
    try:
        from urllib.parse import urlparse
        import asyncio
        parsed = urlparse(req.url)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail="Invalid URL format")
            
        filepath, text = await asyncio.to_thread(scrape_and_save, req.url)
        if not text or not filepath:
            raise HTTPException(status_code=400, detail="Could not extract text from the URL")
            
        chunks_added = await asyncio.to_thread(rag.add_text_to_rag, text)
        
        log_entry = RagLog(source_url=req.url, source_type="URL", status="SUCCESS", chunks_added=chunks_added)
        db.add(log_entry)
        await db.commit()
        
        return AdminRAGResponse(
            success=True,
            message=f"Successfully scraped {req.url} and added {chunks_added} chunks to RAG.",
            chunks_added=chunks_added,
            file_path=filepath
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to add url to rag {e}")
        import traceback
        traceback.print_exc()
        try:
            log_entry = RagLog(source_url=req.url, source_type="URL", status="FAILED", chunks_added=0, error_message=str(e))
            db.add(log_entry)
            await db.commit()
        except Exception:
            await db.rollback()

        raise HTTPException(status_code=500, detail=f"Failed to process URL: {e}")

@app.post("/admin/rag/add-pdf", response_model=AdminRAGResponse)
async def admin_add_rag_pdf(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    _: User = Depends(require_async_admin),
):
    """
    Saves an uploaded PDF, extracts text, and injects it into the active RAG collection.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
    try:
        from pathlib import Path
        import shutil
        import time
        import asyncio
        
        DOCS_DIR = Path(os.getenv("ADMIN_DOCS_DIR", "admin_docs"))
        DOCS_DIR.mkdir(exist_ok=True)
        
        # Save uploaded file
        safe_name = file.filename.replace(" ", "_").replace("/", "")
        ts = int(time.time())
        filepath = DOCS_DIR / f"{ts}_{safe_name}"
        
        def _save_file():
            with open(filepath, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        await asyncio.to_thread(_save_file)
            
        # Parse text - Execute in threadpool to avoid blocking event loop
        text = await run_in_threadpool(extract_text_from_pdf, filepath)
        if not text:
            raise HTTPException(status_code=400, detail="Could not extract text from the PDF. It might be scanned or empty.")
            
        # Create corresponding .txt file for persistence next time server boots
        txt_filepath = DOCS_DIR / f"{ts}_{safe_name}.txt"
        def _save_txt():
            with open(txt_filepath, "w", encoding="utf-8") as f:
                f.write(f"Source: Uploaded PDF {file.filename}\n\n")
                f.write(text)
        await asyncio.to_thread(_save_txt)
            
        # Load into active RAG - Execute in threadpool
        chunks_added = await run_in_threadpool(rag.add_text_to_rag, text)
        
        log_entry = RagLog(source_url=file.filename, source_type="PDF", status="SUCCESS", chunks_added=chunks_added)
        db.add(log_entry)
        await db.commit()
        
        return AdminRAGResponse(
            success=True,
            message=f"Successfully parsed {file.filename} and added {chunks_added} chunks to RAG.",
            chunks_added=chunks_added,
            file_path=str(txt_filepath)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process PDF {e}")
        try:
            log_entry = RagLog(source_url=file.filename or "unknown.pdf", source_type="PDF", status="FAILED", chunks_added=0, error_message=str(e))
            db.add(log_entry)
            await db.commit()
        except Exception:
            await db.rollback()

        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {e}")

class RagLogListResponse(BaseModel):
    items: list[RagLogResponse]
    total: int

@app.get("/admin/rag/logs", response_model=RagLogListResponse)
async def admin_rag_logs(
    db: AsyncSession = Depends(get_async_db),
    _: User = Depends(require_async_admin),
):
    """
    Returns the latest 100 RAG ingestion logs and the total count.
    """
    total = (await db.execute(select(sa_func.count()).select_from(RagLog))).scalar()
    res = await db.execute(select(RagLog).order_by(RagLog.created_at.desc()).limit(100))
    logs = res.scalars().all()
    return RagLogListResponse(items=logs, total=total)

@app.post("/admin/rag/crawl", response_model=AdminRAGResponse)
async def admin_rag_crawl(
    req: AdminRAGCrawlRequest,
    background_tasks: BackgroundTasks,
    _: User = Depends(require_async_admin),
):
    """
    Spawns a background task to crawl a website or sitemap and inject it entirely into RAG.
    """
    from urllib.parse import urlparse
    parsed = urlparse(req.url)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL format")
        
    background_tasks.add_task(
        background_crawl, 
        url=req.url, 
        is_sitemap=req.is_sitemap, 
        max_pages=req.max_pages, 
        delay=1.5
    )
    
    return AdminRAGResponse(
        success=True,
        message=f"Глубокий скан запущен в фоне. Ожидается обход до {req.max_pages} страниц.",
        chunks_added=0
    )

# --- RAG Visualization Admin Endpoints ---

@app.get("/admin/rag/viz")
async def admin_get_rag_viz(
    _: User = Depends(require_async_admin),
):
    """
    Serves the pre-generated RAG visualization HTML map.
    Safe-serves with admin check to protect document content.
    """
    path = DEFAULT_OUTPUT
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Visualization not generated yet. Please trigger a rebuild.")
    return FileResponse(path)

@app.get("/admin/rag/viz/status")
async def admin_get_rag_viz_status(
    _: User = Depends(require_async_admin),
):
    """
    Checks if the visualization map is currently being rebuilt.
    """
    is_busy = os.path.exists(STATUS_FILE)
    return {"status": "processing" if is_busy else "idling"}

@app.post("/admin/rag/viz/rebuild")
async def admin_rebuild_rag_viz(
    background_tasks: BackgroundTasks,
    _: User = Depends(require_async_admin),
):
    """
    Triggers a background task to rebuild the semantic RAG map.
    """
    if os.path.exists(STATUS_FILE):
        return {"status": "already_processing", "message": "Rebuild is already in progress."}
    
    if visualize_rag is None:
        raise HTTPException(status_code=500, detail="Visualization module not found on server.")

    # Run as a background task to avoid blocking the API
    background_tasks.add_task(visualize_rag, collection_name='all', dims=3)
    
    return {"status": "started", "message": "Rebuild task spawned in background."}

@app.get("/admin/payments", response_model=list[PaymentResponse])
async def admin_payments(
    status: str | None = None,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
):
    """Full list of all payments."""
    from sqlalchemy.orm import selectinload
    query = select(Payment).options(selectinload(Payment.user), selectinload(Payment.promo_code)).order_by(Payment.created_at.desc())
    if status:
        query = query.where(Payment.status == status)
    query = query.limit(200)
    res = await db.execute(query)
    payments = res.scalars().all()
    result = []
    for p in payments:
        result.append(PaymentResponse(
            id=p.id,
            user_id=p.user_id,
            user_email=p.user.email if p.user else "unknown",
            user_name=p.user.name if p.user else "unknown",
            yookassa_payment_id=p.yookassa_payment_id,
            amount=float(p.amount),
            currency=p.currency,
            status=p.status,
            tier=p.tier,
            is_annual=p.is_annual,
            promo_code=p.promo_code.code if p.promo_code else None,
            created_at=p.created_at,
            updated_at=p.updated_at,
        ))
    return result


SYSTEM_INTERVIEW_PROMPT = """
Ты — профессиональный венчурный аналитик. Твоя цель — провести интервью с основателем стартапа,
чтобы собрать информацию для оценки инвестиционной привлекательности проекта.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1. НИКОГДА не спрашивай пользователя то, что ты сам должен знать как эксперт. Например, НЕ спрашивай "какие критерии важны для инвесторов?" или "какие рыночные тренды актуальны?" — ты эксперт, ты обязан знать это сам.
2. Спрашивай ТОЛЬКО о конкретном проекте основателя: что делает продукт, кто платит, сколько клиентов, какие расходы, кто в команде.
3. НЕ задавай лишних, встречных или контекстных вопросов, если пользователь просто ищет информацию.
4. Если информации критически не хватает, задавай МАКСИМУМ 1-2 самых важных вопроса. Не перегружай пользователя долгими допросами.
5. Как только ты собрал базовый минимум информации (понятно что за продукт, для кого и стадия) — СРАЗУ переходи к выдаче JSON. Не жди идеальных ответов по всем параметрам.
6. ПОСЛЕ выдачи JSON — продолжай общение! Отвечай на вопросы, обсуждай рекомендации.

8. Если ты используешь таблицы, ВСЕГДА используй стандартный Markdown и разделяй каждую строку символом переноса строки (\n). НЕ пиши всю таблицу в одну строку.
"""


SYSTEM_TA_PROMPT = """
Ты — эксперт по маркетингу и целевой аудитории (ЦА) для стартапов на рынке СНГ и Global.
Твоя задача — помочь основателю лучше понять и сегментировать свою ЦА.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1. НИКОГДА не спрашивай пользователя то, что ты сам должен знать как эксперт. Например, НЕ спрашивай "какие критерии важны для инвесторов?" или "какие рыночные тренды актуальны?" — ты эксперт, ты обязан знать это сам и ИСПОЛЬЗОВАТЬ эти знания в своем анализе.
2. Спрашивай ТОЛЬКО о конкретном продукте/проекте пользователя: что делает продукт, кто уже им пользуется, какая бизнес-модель (B2B/B2C/B2G), на каком рынке работают.
3. НЕ задавай лишних, встречных или контекстных вопросов, если пользователь просто ищет информацию.
4. Если требуется уточнение, задавай от 3 до 5 вопросов в одном своем ответе. Выбирай только самые основные и важные уточнения. Но если пользователь просит список/примеры — дай список без вопросов.
5. После получения нужных ответов пользователя — ВЫДАЙ РАЗВЁРНУТЫЙ АНАЛИЗ. Не жди идеальных ответов.
6. Отвечай только текстом (markdown), без JSON.
7. ПОСЛЕ выдачи анализа — продолжай общение! Если пользователь комментирует, уточняет или спорит — адаптируй свои рекомендации, обсуждай, предлагай альтернативы. НЕ повторяй один и тот же анализ.

СТРУКТУРА ФИНАЛЬНОГО АНАЛИЗА (обязательные разделы):
## Анализ ЦА: [Название продукта]

### 1. Основные сегменты аудитории
Для каждого сегмента:
- **Название сегмента** (возраст, роль)
- Размер сегмента (примерная оценка)
- Боли и потребности (3-5 пунктов)
- Готовность платить (низкая/средняя/высокая)
- Где их найти (конкретные каналы и площадки)

### 2. Приоритетный сегмент для старта
Кто именно и почему — с обоснованием

### 3. Customer Journey Map
Как пользователь узнает о продукте → пробует → покупает → рекомендует

### 4. Каналы привлечения
Таблица: канал | стоимость | охват | рекомендация

### 5. Конкурентный ландшафт
Кто уже работает с этой ЦА, чем отличаетесь

### 6. Конкретный план действий на первые 30 дней
Пошаговый план с приоритетами

ВАЖНО: Если ты используешь таблицы, ВСЕГДА разделяй каждую строку символом переноса строки (\n). НЕ пиши всю таблицу в одну строку.
"""

SYSTEM_ECONOMICS_PROMPT = """
Ты — финансовый директор и эксперт по юнит-экономике для стартапов.
Твоя задача — собрать МИНИМУМ данных и затем САМОМУ рассчитать полную финансовую модель.

АЛГОРИТМ (СТРОГО!):

ФАЗА 1 — Задай РОВНО 2-3 ключевых вопроса в ПЕРВОМ ответе:
1. Какова цена вашего продукта и модель монетизации (подписка/разовая покупка)?
2. Как привлекаете клиентов и сколько тратите на привлечение?
3. Есть ли другие расходы помимо названных?
БОЛЬШЕ ВОПРОСОВ НЕ ЗАДАВАЙ. 2-3 максимум.

ФАЗА 2 — После ПЕРВОГО ответа пользователя СРАЗУ ВЫДАЙ ПОЛНЫЙ РАСЧЁТ.
Не задавай дополнительных вопросов. Считай с тем, что есть. Если чего-то не хватает — ставь бенчмарк.

ЗАПРЕЩЕНО:
❌ "Если вам нужна помощь — сообщите мне"
❌ "Давайте рассмотрим следующие аспекты..."
❌ "Рассчитайте / определите / уточните для себя"
❌ Более 3 вопросов в одном сообщении
❌ Перечислять "шаги для расчёта" вместо самого расчёта
❌ Спрашивать "какие функции включить в тариф" — это не твоя задача

ОБЯЗАТЕЛЬНО:
✅ Каждая ячейка таблицы содержит ЧИСЛО, не прочерк
✅ Таблица на 12 месяцев с конкретными цифрами
✅ Точка безубыточности с количеством клиентов
✅ После расчёта — если пользователь уточняет данные, ПЕРЕСЧИТАЙ (не повторяй)

ПРИМЕР ПЛОХОГО ОТВЕТА:
"Для более глубокого анализа давайте рассмотрим: 1) Постоянные расходы... 2) Переменные расходы... 3) Источники дохода... 4) Целевая аудитория... 5) Каналы продаж..."
ЭТО ЗАПРЕЩЕНО. Ты не методичка, ты калькулятор.

ПРИМЕР ХОРОШЕГО ОТВЕТА (после получения цены и расходов):
"## 💰 Юнит-экономика: [Продукт]
| Метрика | Значение |
|---------|----------|
| ARPU | 500 ₽/мес |
| CAC | 1500 ₽ [бенчмарк SaaS] |
| LTV (при retention 70%) | 1167 ₽ |
...
Для выхода на безубыточность при расходах 2100₽/мес нужно минимум 5 клиентов на тарифе Про."

Отвечай только текстом (markdown), без JSON. 
ВАЖНО: В таблицах ВСЕГДА разделяй строки символом переноса строки (\n). НЕ пиши всю таблицу в одну строку.
"""

SYSTEM_GENERAL_PROMPT = """
Ты — многопрофильный бизнес-ассистент для стартапов. 
Помогай основателю с любыми вопросами по бизнесу, стратегии, HR, разработке или фандрайзингу.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1. Твоя ГЛАВНАЯ задача — отвечать на вопросы пользователя максимально ПОДРОБНО, СТРУКТУРИРОВАННО и КРАСИВО. Используй заголовки (##, ###), списки, выделение жирным шрифтом и эмодзи.
2. ВНИМАТЕЛЬНО ИЗУЧАЙ СПРАВОЧНУЮ ИНФОРМАЦИЮ (RAG). Если там есть данные о грантах, программах или законах, пересказывай их в ответе детально: с суммами, конкретными названиями и условиями. 
3. НИКОГДА не давай сухие короткие ответы в стиле "посетите такой-то сайт" или "ознакомьтесь там-то". Ты эксперт, поэтому сам распиши названия программ, суммы, условия подачи заявки и требования прямо в ответе.
4. НЕ задавай лишних, встречных или контекстных вопросов, если пользователь просто ищет информацию.
5. Если требуется уточнение, задавай от 3 до 5 вопросов в одном своем ответе. Выбирай только самые основные и важные уточнения. Но если пользователь просит список/примеры — дай список без вопросов.

ПРИМЕР ХОРОШЕГО ОТВЕТА:
Основатель: "Как привлечь первых пользователей?"
Ассистент:
## 🚀 План привлечения первых 100 пользователей
1. **Product Hunt Launch** — подготовьте лендинг и запустите в понедельник утром.
2. **Telegram-каналы** — разместите пост в 3-5 тематических каналах.
3. **Холодные рассылки (Cold Outreach)** — найдите ЛПР в LinkedIn и отправьте им короткое value-сообщение.

ВАЖНО: Если ты используешь таблицы, ВСЕГДА разделяй каждую строку символом переноса строки (\n). НЕ пиши всю таблицу в одну строку.
"""


@app.post("/chat/sessions", response_model=ChatSessionDetailResponse)
async def create_chat_session(
    payload: ChatSessionCreateRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ChatSessionDetailResponse:
    session = ChatSession(
        user_id=user.id,
        title=payload.title,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    messages_response = []

    if payload.initial_message:
        await async_check_subscription_limits(
            user, db, "message",
            idempotency_key=f"chat:{user.id}:{payload.client_id or uuid.uuid4()}",
        )
        # Save user message
        user_msg = DbChatMessage(
            session_id=session.id,
            role="user",
            content=payload.initial_message,
            client_id=payload.client_id
        )
        db.add(user_msg)
        await db.commit()
        await db.refresh(user_msg)  # Get ID
        messages_response.append(ChatMessageResponse.model_validate(user_msg))

    # Generate Assistant Greeting
    assistant_text = (
        "Привет! Я — ваш ИИ-аналитик стартапов.\n\n"
        "Опишите ваш проект или выберите одну из тем ниже, чтобы начать работу."
    )

    # Save assistant message
    ai_msg = DbChatMessage(
        session_id=session.id,
        role="assistant",
        content=assistant_text, client_id=payload.assistant_client_id
    )
    db.add(ai_msg)
    await db.commit()
    await db.refresh(ai_msg)
    messages_response.append(ChatMessageResponse.model_validate(ai_msg))

    return ChatSessionDetailResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        analysis_id=session.analysis_id,
        messages=messages_response,
    )

# Плейсхолдеры, которые фронтенд/бэкенд ставят при создании чата. Пока у
# сессии такое название, её можно безопасно переименовывать автоматически.
# Держать в синхроне с DEFAULT_CHAT_TITLES в ChatInterface.tsx.
_DEFAULT_CHAT_TITLES = {"чат с аналитиком", "новый чат", "новый диалог", "new chat", "чат"}


def _is_default_chat_title(title: str | None) -> bool:
    return (title or "").strip().lower() in _DEFAULT_CHAT_TITLES or not (title or "").strip()


def _build_chat_title_context(messages, fallback: str) -> str:
    """Дайджест реплик пользователя для генерации названия чата.

    Первая реплика задаёт исходную тему, последние — к чему разговор пришёл:
    старый чат с дефолтным названием получает заголовок по актуальной теме,
    а не по давнему первому сообщению. Реплики разделяются '---' — промпт в
    slm_dispatcher.generate_chat_title опирается на этот формат.
    """
    import export_service
    user_texts = []
    for m in sorted(messages, key=lambda m: (m.created_at, m.id)):
        if m.role != "user":
            continue
        cleaned = export_service.strip_llm_markup(m.content or "")
        if cleaned:
            user_texts.append(cleaned)
    if not user_texts:
        return fallback
    picked = user_texts[:1] + user_texts[1:][-2:]
    return "\n---\n".join(t[:400] for t in picked)


async def rename_chat_session_background(session_id: int, initial_message: str):
    try:
        title = await slm_dispatcher.generate_chat_title(initial_message)
        if not title:
            # SLM не ответил — оставляем текущее название, следующая реплика
            # пользователя запустит генерацию повторно.
            return
        logger.info(f"Generated title '{title}' for session {session_id}")

        from db_async import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
            session = res.scalar_one_or_none()
            # Название, поставленное пользователем вручную, не перетираем.
            if session and _is_default_chat_title(session.title):
                session.title = title
                await db.commit()
    except Exception as e:
        logger.error(f"Error in background renaming: {e}")

@app.post("/guest/intents", response_model=IntentResponse)
def create_guest_intent(payload: IntentCreateRequest):
    intent_id = str(uuid.uuid4())
    redis = get_redis()
    
    # Store the text and client_id for 1 hour (3600 seconds)
    data = {
        "initial_message": payload.initial_message,
        "client_id": payload.client_id
    }
    redis.setex(f"guest_intent:{intent_id}", 3600, json.dumps(data))
    
    return IntentResponse(intent_id=intent_id)

@app.post("/chat/sessions/from-intent", response_model=ChatSessionDetailResponse)
async def create_chat_session_from_intent(
    payload: ChatSessionFromIntentRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ChatSessionDetailResponse:
    redis = get_redis()
    key = f"guest_intent:{payload.intent_id}"
    raw_data = redis.get(key)
    
    if not raw_data:
        raise HTTPException(status_code=404, detail="Intent not found or expired")
    
    if isinstance(raw_data, bytes):
        raw_data = raw_data.decode("utf-8")
        
    try:
        data = json.loads(raw_data)
        initial_message = data.get("initial_message")
        client_id = data.get("client_id")
    except Exception:
        initial_message = raw_data
        client_id = None

    session = ChatSession(
        user_id=user.id,
        title="Новый диалог",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    messages_response = []
    
    QUICK_ACTIONS = [
        "Оценить идею стартапа",
        "Составить план запуска",
        "Как найти первых клиентов?",
    ]

    if initial_message not in QUICK_ACTIONS:
        await async_check_subscription_limits(
            user, db, "message",
            idempotency_key=f"chat:{user.id}:{client_id or payload.intent_id}",
        )
        # Save user message
        user_msg = DbChatMessage(
            session_id=session.id,
            role="user",
            content=initial_message,
            client_id=client_id
        )
        db.add(user_msg)
        await db.commit()
        await db.refresh(user_msg)
        messages_response.append(ChatMessageResponse.model_validate(user_msg))

    # Generate Assistant Greeting
    assistant_text = (
        "Привет! Я — ваш ИИ-аналитик стартапов.\n\n"
        "Я увидел базовое описание вашего проекта. "
        "Чтобы наше общение было максимально полезным, **выберите одну из тем** ниже или задайте свой вопрос."
    )

    # Save assistant message
    ai_msg = DbChatMessage(
        session_id=session.id,
        role="assistant",
        content=assistant_text, client_id=payload.assistant_client_id
    )
    db.add(ai_msg)
    await db.commit()
    await db.refresh(ai_msg)
    messages_response.append(ChatMessageResponse.model_validate(ai_msg))

    # Clean up intent
    redis.delete(key)
    
    # Fire and forget background rename
    background_tasks.add_task(rename_chat_session_background, session.id, initial_message)
    
    return ChatSessionDetailResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        analysis_id=session.analysis_id,
        messages=messages_response,
    )

@app.post("/chat/sessions/auto", response_model=ChatSessionDetailResponse)
async def create_chat_session_auto(
    payload: ChatSessionAutoRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ChatSessionDetailResponse:
    session = ChatSession(
        user_id=user.id,
        title="Новый диалог",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    messages_response = []

    await async_check_subscription_limits(
        user, db, "message",
        idempotency_key=f"chat:{user.id}:{payload.client_id or uuid.uuid4()}",
    )
    # Save user message
    user_msg = DbChatMessage(
        session_id=session.id,
        role="user",
        content=payload.initial_message,
        client_id=payload.client_id
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)
    messages_response.append(ChatMessageResponse.model_validate(user_msg))

    # Fire and forget background rename
    background_tasks.add_task(rename_chat_session_background, session.id, payload.initial_message)
    
    return ChatSessionDetailResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        analysis_id=session.analysis_id,
        messages=messages_response,
    )


@app.get("/chat/sessions", response_model=list[ChatSessionResponse])
async def list_chat_sessions(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> list[ChatSessionResponse]:
    res = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = res.scalars().all()
    return sessions


@app.get("/chat/sessions/{session_id}", response_model=ChatSessionDetailResponse)
async def get_chat_session(
    session_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> ChatSessionDetailResponse:
    from sqlalchemy.orm import selectinload
    res = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.messages), selectinload(ChatSession.analysis))
        .where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Manually map messages to avoid N+1 if not careful, though ORM handles it
    msgs = sorted(session.messages, key=lambda m: m.created_at)

    analysis_data = None
    if session.analysis:
        analysis_data = AnalysisResponse(
            id=session.analysis.id,
            name="Анализ стартапа",  # Fallback as model doesn't store name separately
            category=None,
            investment_score=session.analysis.investment_score,
            strengths=session.analysis.strengths,
            weaknesses=session.analysis.weaknesses,
            recommendations=session.analysis.recommendations,
            market_summary=session.analysis.market_summary,
            created_at=session.analysis.created_at,
        )

    return ChatSessionDetailResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        analysis_id=session.analysis_id,
        analysis=analysis_data,
        messages=[
            ChatMessageResponse.model_validate(m) for m in msgs
        ],
    )


def _export_rate_limit_check(user_id: int | None) -> None:
    """3s cooldown per user on document export. Rendering runs in the
    threadpool, so this bounds concurrency. Best-effort without Redis."""
    if not user_id:
        return
    r = get_redis()
    if not r:
        return
    try:
        ok = r.set(f"export:rl:{user_id}", "1", nx=True, ex=3)
        if not ok:
            raise HTTPException(
                status_code=429,
                detail="Слишком часто. Подождите пару секунд и повторите экспорт.",
            )
    except HTTPException:
        raise
    except Exception:
        pass


@app.get("/chat/messages/{message_id}/export")
async def export_chat_message(
    message_id: int,
    format: str = Query(..., description="pdf | docx | md | txt"),
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Renders an assistant message as a downloadable document on demand —
    nothing is stored, so the same endpoint serves the per-message export
    menu, chat-requested file cards and history reloads. No LLM quota is
    consumed; the cooldown above is the abuse guard."""
    import export_service

    fmt = (format or "").lower().strip()
    if fmt not in export_service.EXPORT_FORMATS:
        raise HTTPException(status_code=422, detail="Неподдерживаемый формат экспорта.")
    _export_rate_limit_check(user.id)

    from sqlalchemy.orm import selectinload
    res = await db.execute(
        select(DbChatMessage)
        .options(selectinload(DbChatMessage.session))
        .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
        .where(
            DbChatMessage.id == message_id,
            ChatSession.user_id == user.id,
            # Only assistant answers are exportable; 404 (not 403) so foreign
            # message ids are indistinguishable from missing ones.
            DbChatMessage.role == "assistant",
        )
    )
    msg = res.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")

    if fmt == "pdf" and not export_service.pdf_available():
        raise HTTPException(
            status_code=503,
            detail="PDF-экспорт недоступен в этой среде. Скачайте DOCX, MD или TXT.",
        )
    content = msg.content or ""
    if len(content) > export_service.MAX_EXPORT_CHARS:
        raise HTTPException(status_code=413, detail="Ответ слишком большой для экспорта.")

    title = (msg.session.title if msg.session else "") or "Ответ Pitchy"
    filename = export_service.suggest_filename(title, fmt)
    try:
        data, mime, _ = await run_in_threadpool(
            export_service.render_message_export, content, fmt, title, msg.sources or []
        )
    except export_service.ExportUnavailable:
        raise HTTPException(status_code=503, detail="PDF-экспорт временно недоступен.")
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": export_service.build_content_disposition(filename),
            "Cache-Control": "no-store",
        },
    )


class FeedbackRequest(BaseModel):
    feedback: int

@app.post("/chat/sessions/{session_id}/messages/{message_id}/feedback")
async def set_chat_message_feedback(
    session_id: int,
    message_id: int,
    payload: FeedbackRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    res = await db.execute(
        select(DbChatMessage)
        .join(ChatSession)
        .where(
            DbChatMessage.id == message_id,
            DbChatMessage.session_id == session_id,
            ChatSession.user_id == user.id
        )
    )
    msg = res.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    msg.feedback = payload.feedback
    await db.commit()

    if payload.feedback == 1 and msg.role == "assistant":
        res2 = await db.execute(
            select(DbChatMessage)
            .where(
                DbChatMessage.session_id == session_id,
                DbChatMessage.role == "user",
                DbChatMessage.created_at < msg.created_at
            )
            .order_by(DbChatMessage.created_at.desc())
            .limit(1)
        )
        user_msg = res2.scalar_one_or_none()
        if user_msg:
            from rag import index_successful_chat_interaction
            background_tasks.add_task(index_successful_chat_interaction, user_msg.content, msg.content, message_id)

    return {"status": "ok", "feedback": msg.feedback}

@app.post("/chat/uploads")
async def upload_chat_attachment(
    file: UploadFile = File(...),
    user: User = Depends(get_async_current_user),
):
    """Processes a chat attachment: extracts document text or describes an
    image via a vision model. Stateless — the extracted text is returned to
    the client and travels back with the next chat message payload."""
    from chat_attachments import (
        IMAGE_MIMES, MAX_IMAGE_BYTES, MAX_TEXT_CHARS, MAX_UPLOAD_BYTES,
        describe_image, detect_attachment_kind, extract_document_text, sanitize_filename,
    )

    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Файл больше {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ.")
    if not raw:
        raise HTTPException(status_code=400, detail="Файл пуст.")

    name = sanitize_filename(file.filename or "file")
    kind = detect_attachment_kind(name, file.content_type)
    if kind is None:
        raise HTTPException(
            status_code=415,
            detail="Неподдерживаемый формат. Доступны: PDF, DOCX, TXT, MD, CSV и изображения (PNG, JPG, WEBP, GIF).",
        )

    if kind == "image":
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail=f"Изображение больше {MAX_IMAGE_BYTES // (1024 * 1024)} МБ.")
        mime = (file.content_type or "").lower().split(";")[0]
        if mime not in IMAGE_MIMES:
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            mime = {
                "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                "webp": "image/webp", "gif": "image/gif",
            }.get(ext, "image/png")
        text = await describe_image(raw, mime, name)
        if not text:
            raise HTTPException(
                status_code=502,
                detail="Не удалось обработать изображение — сервис распознавания временно недоступен.",
            )
        text = f"[Автоматическое описание изображения «{name}»]\n{text}"
    else:
        try:
            text = await asyncio.to_thread(extract_document_text, name, kind, raw)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    truncated = len(text) > MAX_TEXT_CHARS
    logger.info(
        f"Chat upload processed: user={user.id} name={name!r} kind={kind} "
        f"bytes={len(raw)} chars={len(text)} truncated={truncated}"
    )
    return {"name": name, "kind": kind, "text": text[:MAX_TEXT_CHARS], "truncated": truncated}


@app.post("/chat/sessions/{session_id}/messages")
async def send_chat_message(
    session_id: int,
    payload: ChatMessageCreateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    from sqlalchemy.orm import selectinload
    res = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Network retries reuse client-generated UUIDs. Replay a completed answer,
    # or reject a still-running duplicate before charging limits or inserting.
    if payload.assistant_client_id:
        existing_assistant_result = await db.execute(select(DbChatMessage).where(
            DbChatMessage.session_id == session.id,
            DbChatMessage.client_id == payload.assistant_client_id,
            DbChatMessage.role == "assistant",
        ))
        existing_assistant = existing_assistant_result.scalar_one_or_none()
        if existing_assistant:
            return replay_chat_message(existing_assistant)
    if payload.client_id:
        existing_user_result = await db.execute(select(DbChatMessage).where(
            DbChatMessage.session_id == session.id,
            DbChatMessage.client_id == payload.client_id,
            DbChatMessage.role == "user",
        ))
        if existing_user_result.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Chat request is already in progress")

    # Determine which feature flag (if any) this request is asking for so
    # the limit check can short-circuit with upgrade_required on free tier.
    requested_feature = None
    if getattr(payload, "use_research", False):
        requested_feature = "research"
    elif getattr(payload, "use_deep_search", False):
        requested_feature = "deep_search"
    elif getattr(payload, "intent", None) == "presentation":
        requested_feature = "presentation"

    # Экспорт по запросу словами («сохрани прошлый ответ в pdf»): дешёвый
    # regex-префильтр, затем SLM-уточнение (export_service). Экспорт УЖЕ
    # существующего ответа не генерирует ничего нового, поэтому для
    # target=previous лимит сообщений ниже не списывается.
    import export_service
    export_request = None
    _export_probe = (payload.content or "").strip()
    if _export_probe and export_service.detect_export_request(_export_probe):
        export_request = await export_service.classify_export_intent(_export_probe)
    is_prev_export = bool(export_request and export_request.target == "previous")

    if not is_prev_export:
        await async_check_subscription_limits(
            user,
            db,
            "message",
            session.id,
            feature=requested_feature,
            is_search=getattr(payload, "use_deep_search", False),
            idempotency_key=f"chat:{user.id}:{payload.client_id or payload.assistant_client_id or uuid.uuid4()}",
        )

    # Attachments arrive pre-processed by /chat/uploads. Their extracted text
    # is embedded into the stored message between FILE markers: the frontend
    # renders them as chips, and the LLM sees the file contents in the prompt.
    from chat_attachments import build_attachment_block
    attachments = payload.attachments or []
    raw_content = (payload.content or "").strip()
    if not raw_content and not attachments:
        raise HTTPException(status_code=422, detail="Сообщение не может быть пустым.")
    attachment_block = build_attachment_block(attachments) if attachments else ""
    stored_content = f"{raw_content}\n\n{attachment_block}".strip() if attachment_block else raw_content
    # Query used for classification/retrieval/web search — the user's question,
    # not the (potentially huge) attached file contents.
    query_text = raw_content or "Проанализируй прикреплённые файлы: " + ", ".join(a.name for a in attachments)
    from chat_pipeline import build_model_user_content
    model_user_content = build_model_user_content(raw_content, attachment_block)

    # 1. Save User Message
    user_msg = DbChatMessage(
        session_id=session.id,
        role="user",
        content=stored_content,
        client_id=payload.client_id
    )
    db.add(user_msg)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Duplicate chat request")
    await db.refresh(session)

    # Авто-название по контексту (как в Claude): пока у чата плейсхолдер,
    # генерируем заголовок из реплик пользователя. Проверка по названию,
    # а не по счётчику сообщений: сессии из дашборда создаются сразу с
    # приветствием ассистента, поэтому «len == 1» здесь никогда не выполнялся;
    # заодно старые чаты с дефолтным именем получают название при новой реплике.
    if _is_default_chat_title(session.title):
        title_context = _build_chat_title_context(session.messages, fallback=query_text)
        background_tasks.add_task(rename_chat_session_background, session.id, title_context)

    # Fast path «сохрани прошлый ответ в файл»: LLM-пайплайн не нужен —
    # находим последний ответ ассистента, отвечаем подтверждением и отдаём
    # карточки файлов. Файл генерируется при скачивании
    # (GET /chat/messages/{id}/export), здесь только маркеры + SSE-события.
    if is_prev_export:
        _FMT_LABELS = {"pdf": "PDF", "docx": "DOCX", "md": "Markdown", "txt": "TXT"}

        async def export_previous_generator():
            yield format_sse({"type": "ping"})
            yield format_sse({"type": "metadata", "model": "Pitchy"})
            target_msg = None
            for m in sorted(session.messages, key=lambda m: m.created_at, reverse=True):
                if m.role == "assistant" and export_service.strip_llm_markup(m.content or ""):
                    target_msg = m
                    break
            if target_msg is None:
                note = (
                    "Пока нечего сохранять — в этом чате ещё нет моего ответа. "
                    "Задайте вопрос, и я смогу собрать ответ в файл."
                )
                yield format_sse({"type": "chunk", "content": note})
                asyncio.create_task(asyncio.to_thread(
                    save_assistant_message,
                    session_id=session.id,
                    content=note,
                    client_id=payload.assistant_client_id,
                ))
                return

            formats = list(export_request.formats)
            dropped_pdf = False
            if "pdf" in formats and not export_service.pdf_available():
                formats = [f for f in formats if f != "pdf"]
                dropped_pdf = True
                if not formats:
                    formats = ["docx"]

            markers: list[str] = []
            cards: list[tuple[str, str]] = []
            for fmt in formats:
                fname = export_service.suggest_filename(session.title, fmt)
                markers.append(export_service.build_export_marker(fmt, fname, message_id=target_msg.id))
                cards.append((fmt, fname))

            pretty = ", ".join(_FMT_LABELS.get(f, f.upper()) for f in formats)
            note = f"Готово — собрал прошлый ответ в {pretty}. Карточка файла ниже."
            if dropped_pdf:
                note += " PDF в этой среде временно недоступен, поэтому предложил другой формат."
            yield format_sse({"type": "chunk", "content": note})
            for fmt, fname in cards:
                yield format_sse({
                    "type": "file",
                    "format": fmt,
                    "message_id": target_msg.id,
                    "name": fname,
                    "url": f"/chat/messages/{target_msg.id}/export?format={fmt}",
                })
            # Маркеры персистятся в подтверждении, чтобы карточки пережили
            # перезагрузку страницы (их парсит parseExports во фронте).
            asyncio.create_task(asyncio.to_thread(
                save_assistant_message,
                session_id=session.id,
                content=note + "\n\n" + "\n".join(markers),
                client_id=payload.assistant_client_id,
            ))

        return EventSourceResponse(
            export_previous_generator(),
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # 2. Generator with Thoughts
    try:
        from langfuse.decorators import observe, langfuse_context
    except Exception:
        logger.warning("Langfuse decorators unavailable in main_chat")
        observe = lambda **kw: lambda f: f
        langfuse_context = None

    @observe(name="main_chat", as_type="generation")
    async def session_chat_generator():
        # Immediate heartbeat so the frontend's 20s watchdog doesn't fire during
        # slow setup (intent classification + RAG can take 10-15s combined).
        yield format_sse({"type": "ping"})

        if langfuse_context:
            langfuse_context.update_current_observation(
                user_id=str(user.id),
                session_id=str(session.id),
                tags=["main_chat", "deep_search" if getattr(payload, "use_deep_search", False) else "basic_search"]
            )

        main_chat_model = os.getenv("MAIN_CHAT_MODEL", "z-ai/glm-5.2")
        provider = f"routerai/{main_chat_model}"
        full_response = ""
        full_thoughts = ""
        usage_data = None
        sources = []
        start_time = time.time()
        ttft = None
        message_saved = False  # Track if the message was successfully queued for saving
        pipeline_meta = {
            "pipeline": "chat-v2",
            "rag_candidates": 0,
            "reranked_candidates": 0,
            "web_sources": 0,
            "swarm_facts": 0,
            "fallbacks": [],
        }

        try:
            # We need history for contextual responses — use pre-loaded messages
            history = sorted(session.messages, key=lambda m: m.created_at)
            chat_history = [ChatMessage(role=m.role, content=m.content) for m in history]
            from chat_pipeline import build_history_text
            # Bump whenever the behavioural contract changes so a response
            # generated under an older, softer persona is never replayed.
            cache_scope = f"chat-v3:{session.id}"
            cache_query = query_text + "\nRECENT CONTEXT:\n" + build_history_text(chat_history[-4:])

            # Пассивная память папки грузится ПОСЛЕ определения режима
            # (STAGE 2): справочному вопросу нужен только однострочный бриф о
            # сфере пользователя, а полный дамп паспорта заставляет модель
            # разбирать бизнес вместо ответа на вопрос.
            project_ctx = ""

            use_deep_search_flag = getattr(payload, "use_deep_search", False)
            use_research_flag = getattr(payload, "use_research", False)
            is_pres_request = payload.intent == "presentation"
            if is_pres_request:
                logger.info(f"Detected presentation intent for session {session.id}")

            def _emit_thought(content: str):
                """Helper to yield a narrative thought and mirror into full_thoughts."""
                nonlocal full_thoughts
                full_thoughts += content
                return format_sse({"type": "thought", "content": content})

            # ===========================================================
            # STAGE 1/7 — Semantic cache lookup
            # ===========================================================
            yield _emit_thought("Проверяю, не отвечал ли я на похожий вопрос недавно.\n")

            # Attachments make the answer depend on file contents — the cache
            # keyed by question text alone would return misleading hits.
            if not (use_deep_search_flag or use_research_flag or is_pres_request or attachments or export_request):
                try:
                    from ops.cache.semantic_cache import semantic_cache as _sc
                    cached_entry = await _sc.get_entry(query=cache_query, project_id=cache_scope)
                    if cached_entry:
                        cached = cached_entry["response"]
                        cached_sources = cached_entry.get("sources") or []
                        yield _emit_thought("Нашёл подходящий ответ из памяти — отдаю мгновенно.\n")
                        yield format_sse({"type": "metadata", "model": "Pitchy"})
                        if cached_sources:
                            yield format_sse({"type": "sources", "data": cached_sources})
                        yield format_sse({"type": "chunk", "content": cached})
                        full_response = cached
                        ttft = time.time() - start_time
                        message_saved = True
                        asyncio.create_task(asyncio.to_thread(
                            save_assistant_message,
                            session_id=session.id,
                            content=full_response,
                            thoughts=full_thoughts.strip() or None,
                            client_id=payload.assistant_client_id,
                            sources=cached_sources or None,
                        ))
                        return
                except Exception as e:
                    logger.error(f"Semantic cache lookup failed: {e}")
            else:
                yield _emit_thought("Пропускаю быстрый ответ — нужен свежий анализ.\n")

            # ===========================================================
            # STAGE 2/7 — Intent routing, then targeted knowledge-base retrieval
            # ===========================================================
            cats: list = []
            slm_res: dict = {}
            context_chunks: list = []
            try:
                from slm_dispatcher import slm_dispatcher as _slm
                from chat_pipeline import (
                    RAG_TIMEOUT_SECONDS,
                    ROUTING_TIMEOUT_SECONDS,
                    sanitize_categories,
                )
                yield _emit_thought("Разбираюсь в сути запроса и одновременно поднимаю релевантный контекст из базы знаний.\n")
                slm_res = await asyncio.wait_for(
                    _slm.classify_query_intent(query_text),
                    timeout=ROUTING_TIMEOUT_SECONDS,
                ) or {}
                cats = sanitize_categories(slm_res.get("categories"))
                context_chunks = await asyncio.wait_for(
                    asyncio.to_thread(
                        rag.get_relevant_chunks,
                        query_text,
                        categories=cats or None,
                        top_k=10,
                    ),
                    timeout=RAG_TIMEOUT_SECONDS,
                ) or []
                pipeline_meta["categories"] = cats
                pipeline_meta["rag_candidates"] = len(context_chunks)

                topic_label = "финансовая модель" if slm_res.get("is_finance") else \
                              "глубокий анализ" if slm_res.get("is_deep_search") else "общий анализ"
                yield _emit_thought(
                    f"Определил тематику: {topic_label}. "
                    f"Поднял {len(context_chunks)} релевантных фрагментов из базы знаний.\n"
                )
            except Exception as e:
                logger.error(f"Stage 2 (intent+RAG) failed: {e}")
                pipeline_meta["fallbacks"].append("routing_or_rag")
                yield _emit_thought("Контекст подгрузить не удалось — отвечаю на общих знаниях.\n")

            # ===========================================================
            # STAGE 2.5/7 — Режим ответа: справка / консультация / разбор.
            # Определяет и тон промпта, и состав пайплайна ниже.
            # ===========================================================
            from slm_dispatcher import resolve_chat_mode
            chat_mode = resolve_chat_mode(
                query_text,
                slm_mode=slm_res.get("mode"),
                has_attachments=bool(attachments),
            )
            logger.info(f"Chat mode for session {session.id}: {chat_mode} (slm: {slm_res.get('mode')})")
            pipeline_meta["chat_mode"] = chat_mode
            if langfuse_context:
                try:
                    langfuse_context.update_current_observation(tags=["main_chat", f"mode:{chat_mode}"])
                except Exception:
                    pass
            _MODE_LABELS = {
                "fact": "справочный вопрос — отвечаю по фактам, без разбора проекта",
                "consult": "консультация — нужен рабочий подход, а не оценка проекта",
                "review": "разбор проекта — включаю критический анализ",
            }
            yield _emit_thought(f"Тип запроса: {_MODE_LABELS[chat_mode]}.\n")

            # Память папки: полный паспорт нужен только там, где разбираем
            # бизнес. Для справки берём однострочный бриф о сфере — он
            # позволяет привязать ответ к рынку пользователя, но не тянет
            # модель в разбор.
            if getattr(session, "project_id", None):
                try:
                    if chat_mode == "fact":
                        from project_memory_service import load_project_brief
                        project_ctx = await load_project_brief(db, session.project_id)
                    else:
                        from project_memory_service import load_project_context
                        project_ctx = await load_project_context(
                            db, session.project_id, query=query_text
                        )
                except Exception as e:
                    logger.warning(f"load project context failed: {e}")

            # ===========================================================
            # STAGE 3/7 — Web search (conditional)
            # ===========================================================
            search_ctx = ""
            from chat_pipeline import requires_fresh_web_search
            should_search = (
                use_deep_search_flag
                or use_research_flag
                or slm_res.get("is_deep_search", False)
                or requires_fresh_web_search(query_text)
                # Справочный вопрос — это всегда вопрос о внешнем мире:
                # цифра, статистика, перечень программ. Внутренних знаний
                # модели тут недостаточно, они устарели.
                or chat_mode == "fact"
            )
            from chat_pipeline import RERANK_TIMEOUT_SECONDS, rerank_rag_entries
            rerank_task = asyncio.create_task(
                rerank_rag_entries(query_text, context_chunks[:10], top_k=6)
            ) if context_chunks else None

            if should_search and not is_pres_request:
                yield _emit_thought("Запрос требует свежих данных — ищу актуальную информацию в интернете.\n")
                try:
                    from search_agent import async_search_with_sources
                    from chat_pipeline import WEB_SEARCH_TIMEOUT_SECONDS
                    search_sources, search_ctx = await asyncio.wait_for(
                        async_search_with_sources(query_text, use_deep_search=True),
                        timeout=WEB_SEARCH_TIMEOUT_SECONDS,
                    )
                    if search_sources:
                        sources = search_sources
                        pipeline_meta["web_sources"] = len(search_sources)
                        yield format_sse({"type": "sources", "data": search_sources})
                        yield _emit_thought(f"Подобрал {len(search_sources)} проверенных источников.\n")
                except Exception as e:
                    logger.error(f"Stage 3 (web search) failed: {e}")
                    pipeline_meta["fallbacks"].append("web_search")
            else:
                yield _emit_thought("Внешний поиск не нужен — данных в базе знаний достаточно.\n")

            # ===========================================================
            # STAGE 4/7 — Dedicated RAG reranker
            # ===========================================================
            swarm_facts = ""
            reranked_entries = context_chunks[:6]
            if rerank_task:
                try:
                    reranked_entries = await asyncio.wait_for(
                        rerank_task,
                        timeout=RERANK_TIMEOUT_SECONDS,
                    )
                except Exception as e:
                    logger.error(f"RAG reranker failed: {e}")
                    pipeline_meta["fallbacks"].append("reranker")
            pipeline_meta["reranked_candidates"] = len(reranked_entries)
            rag_texts = [str(c.get("text") or "") for c in reranked_entries]

            # ===========================================================
            # STAGE 5/7 — Analytical agents (Map phase)
            # ===========================================================
            chunks_for_swarm = rag_texts + ([search_ctx] if search_ctx else [])

            # Рой агентов вытаскивает конкурентов и метрики — это материал для
            # разбора проекта. Справке и консультации он не нужен, а стадия
            # самая долгая в пайплайне, поэтому там её пропускаем.
            if chunks_for_swarm and not is_pres_request and not use_research_flag and chat_mode == "review":
                yield _emit_thought(
                    f"Прогоняю {len(chunks_for_swarm)} фрагментов через аналитических агентов "
                    "— ищу проверенные факты, цифры и упоминания конкурентов.\n"
                )
                try:
                    from swarm_agent import run_analytical_swarm
                    from chat_pipeline import SWARM_TIMEOUT_SECONDS
                    swarm_res = await asyncio.wait_for(
                        run_analytical_swarm(chunks_for_swarm),
                        timeout=SWARM_TIMEOUT_SECONDS,
                    )
                    facts: list[str] = []
                    for item in swarm_res or []:
                        comps = getattr(item, 'competitors', None) or []
                        mets = getattr(item, 'metrics', None) or []
                        if comps:
                            facts.append("Конкуренты: " + ", ".join(comps))
                        if mets:
                            facts.append("Метрики: " + "; ".join(mets))
                    if facts:
                        swarm_facts = "\n- ".join(sorted(set(facts)))
                        pipeline_meta["swarm_facts"] = len(facts)
                        yield _emit_thought(f"Извлёк {len(facts)} групп проверенных фактов.\n")
                    else:
                        yield _emit_thought("Структурированных фактов не нашлось — опираюсь на исходные фрагменты.\n")
                except Exception as e:
                    logger.error(f"Stage 4 (analytical agents) failed: {e}")
                    pipeline_meta["fallbacks"].append("swarm")
                    yield _emit_thought("Аналитические агенты недоступны — опираюсь на исходные фрагменты.\n")
            elif chunks_for_swarm and chat_mode != "review":
                yield _emit_thought("Для такого запроса глубокий разбор фрагментов не нужен — отвечаю по собранным данным.\n")
            else:
                yield _emit_thought("Дополнительный анализ фрагментов не требуется.\n")

            # Raw evidence is always preserved. Structured swarm facts are an
            # additional signal and can no longer erase RAG or web context.
            from chat_pipeline import build_evidence_context
            compiled_rag = build_evidence_context(
                project_context=project_ctx,
                rag_entries=reranked_entries,
                web_context=search_ctx,
                swarm_facts=swarm_facts,
            )

            # 3.1 MODE: PRESENTATION GENERATION
            if is_pres_request:
                yield format_sse({"type": "chunk", "content": "Начинаю сборку вашей презентации...\n\n"})
                full_response += "Начинаю сборку вашей презентации...\n\n"
                
                # Use history and context to build slides
                history_text = "\n".join([f"{m.role}: {m.content[:200]}" for m in history[-10:]])
                context_text = "\n".join([c["text"] if isinstance(c, dict) else c for c in context_chunks[:3]])
                # Паспорт папки — приоритетный контекст для слайд-агента.
                if project_ctx:
                    context_text = project_ctx + ("\n\n" + context_text if context_text else "")
                
                # `regenerate` flag is set when the user explicitly asks for
                # a fresh deck from scratch (we surface it as a UI button).
                regenerate_flag = bool(getattr(payload, "regenerate_deck", False))

                final_slides = []
                # Attached files feed the deck content (question + extracted text).
                pres_query = model_user_content[:24_000]
                provider_used = None
                try:
                    async for item in _handle_presentation_in_chat(
                        pres_query, history_text, context_text,
                        session_id=session.id,
                        user_id=user.id,
                        regenerate=regenerate_flag,
                    ):
                        t = item["type"]
                        if t == "thought":
                            full_thoughts += item["content"]
                            yield format_sse(item)
                        elif t == "provider":
                            provider_used = item.get("name")
                            yield format_sse(item)
                        elif t == "slide":
                            # Progressive streaming: each slide appears in the
                            # preview pane as soon as the model finishes it.
                            final_slides.append(item["data"])
                            yield format_sse(item)
                        elif t == "presentation":
                            # Consolidated end-of-stream event (legacy consumers).
                            final_slides = item["data"]
                            yield format_sse(item)
                        elif t == "chunk":
                            full_response += item["content"]
                            yield format_sse(item)
                except HTTPException as he:
                    # Rate-limit / similar — surface to client cleanly.
                    yield format_sse({"type": "chunk", "content": f"\n⚠ {he.detail}"})
                    full_response += f"\n⚠ {he.detail}"
                
                if final_slides:
                    msg = "Презентация успешно сгенерирована! Открываю панель просмотра."
                    yield format_sse({"type": "chunk", "content": msg})
                    full_response += msg

                    # Sync the slide-agent output into the chat history as a
                    # system breadcrumb. Without this, a follow-up like "сделай
                    # 3-й слайд короче" routes through Makura — which never
                    # saw the slides and replies "о каких слайдах речь?". With
                    # the breadcrumb in history_text, Makura now knows the
                    # deck shape (titles + provider) and can either edit
                    # inline or recommend re-running the presentation intent.
                    try:
                        summary_lines = []
                        for i, s in enumerate(final_slides[:20], 1):
                            if not isinstance(s, dict):
                                continue
                            title = s.get("title") or s.get("type") or "Slide"
                            summary_lines.append(f"  {i}. [{s.get('type','?')}] {title}")
                        breadcrumb_body = (
                            f"[Слайд-агент сгенерировал презентацию "
                            f"({len(final_slides)} слайдов, провайдер: "
                            f"{provider_used or 'unknown'}).]\n" + "\n".join(summary_lines)
                        )
                        db.add(DbChatMessage(
                            session_id=session.id,
                            role="system",
                            content=breadcrumb_body,
                        ))
                        # commit happens with the assistant message at end of stream
                    except Exception as e:
                        logger.warning(f"Failed to write slide-agent breadcrumb: {e}")
                else:
                    msg = "К сожалению, не удалось сгенерировать правильный формат презентации. Попробуйте еще раз или уточните запрос."
                    yield format_sse({"type": "chunk", "content": msg})
                    full_response += msg

            # 4. MODE: DEEP RESEARCH
            elif getattr(payload, "use_research", False):
                # Stage 3 already fetched the evidence. The old implementation
                # called Exa a second time and streamed its raw source dump
                # straight to the user. Deep research needs a synthesis phase.
                if not search_ctx:
                    from search_agent import async_search_with_sources
                    sources, search_ctx = await async_search_with_sources(
                        query_text, use_deep_search=True
                    )
                    if sources:
                        yield format_sse({"type": "sources", "data": sources})

                research_system = SYSTEM_CHAT_PROMPT + """

You are writing a deep research report, not a source-by-source digest.
Synthesize the evidence into one coherent analytical answer in the user's
language. Start with a direct executive conclusion, then cover key findings,
important numbers and trends, contradictions/limitations, and practical
implications. Compare sources instead of retelling them in sequence.
Use inline citations like [1] and [2] that match the numbered evidence.
Never print raw URLs, scraped navigation, long date sequences, or a
"Source N / Content" catalogue. Do not invent facts absent from the evidence.
"""
                research_prompt = (
                    f"USER QUESTION:\n{model_user_content}\n\n"
                    f"AVAILABLE EVIDENCE:\n{compiled_rag[:28000]}\n"
                )

                yield _emit_thought(
                    "Источники собраны. Сопоставляю факты и формирую аналитический отчёт.\n"
                )
                raw_gen = stream_routerai(
                    research_system,
                    research_prompt,
                    model=main_chat_model,
                )
                async for sse_item in parse_thought_generator(raw_gen):
                    try:
                        data = json.loads(sse_item.get("data", "{}"))
                        content = data.get("content", "")
                        if isinstance(content, list):
                            content = "".join(str(c) for c in content)
                        if data.get("type") == "chunk":
                            if ttft is None:
                                ttft = time.time() - start_time
                            full_response += str(content)
                        elif data.get("type") == "thought":
                            full_thoughts += str(content)
                        elif data.get("type") == "metadata" and "usage" in data:
                            usage_data = data["usage"]
                    except Exception as e:
                        logger.error(f"Error processing deep research SSE item: {e}")
                    yield sse_item
            # 4. MODE: QUICK SEARCH OR REGULAR CHAT
            else:
                # =======================================================
                # STAGE 6/7 — GLM-5 Reduce phase (synthesis + streaming)
                # =======================================================
                from chat_pipeline import build_history_text
                history_text = build_history_text(chat_history)
                user_prompt = (
                    f"{compiled_rag}"
                    f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\n"
                    f"Вопрос пользователя: {model_user_content}"
                )

                yield _emit_thought(
                    "Готов. Формулирую ответ по существу вопроса.\n"
                    if chat_mode == "fact"
                    else "Готов. Формулирую развёрнутый ответ на основе собранных данных.\n"
                )
                # Актуальная дата (иначе модель пишет свою устаревшую, напр. «декабрь 2024»).
                _today = datetime.now().strftime("%d.%m.%Y")
                _export_system = build_chat_system_prompt(chat_mode, _today)
                if export_request and export_request.target == "current":
                    _fmts = ", ".join(f.upper() for f in export_request.formats)
                    _export_system += (
                        f"\n\n[ЭКСПОРТ] Пользователь запросил документ ({_fmts}). Твой ответ будет "
                        "автоматически преобразован в файл и прикреплён карточкой для скачивания под "
                        "ответом — файл уже создаётся системой. Поэтому НЕ пиши, что не можешь создавать "
                        "файлы, и НЕ добавляй инструкций, как сохранить/конвертировать вручную (Ctrl+P, "
                        "Word, Google Docs и т.п.).\n"
                        "КРИТИЧНО: опирайся ТОЛЬКО на реальный контекст этого диалога и данные проекта "
                        "пользователя. Если в диалоге НЕТ информации о конкретном проекте — НЕ выдумывай "
                        "пример (кофейню, абстрактный бизнес, вымышленные цифры). Вместо отчёта коротко "
                        "напиши, что данных о проекте недостаточно, и попроси описать проект или заполнить "
                        "паспорт проекта. Никаких выдуманных данных."
                    )
                raw_gen = stream_routerai(
                    _export_system,
                    user_prompt,
                    model=main_chat_model,
                )

                async for sse_item in parse_thought_generator(raw_gen):
                    # sse_item is a dict from format_sse: {"event": "...", "data": "JSON_STRING"}
                    # We need to extract data for local state (full_response)
                    try:
                        raw_data = sse_item.get("data", "{}")
                        data = json.loads(raw_data)
                        
                        if data.get("type") == "chunk":
                            if ttft is None:
                                ttft = time.time() - start_time
                            content = data.get("content", "")
                            if isinstance(content, list):
                                content = "".join(str(c) for c in content)
                            full_response += str(content)
                        elif data.get("type") == "thought":
                            content = data.get("content", "")
                            if isinstance(content, list):
                                content = "".join(str(c) for c in content)
                            full_thoughts += str(content)
                        elif data.get("type") == "metadata":
                            if "usage" in data:
                                usage_data = data["usage"]
                    except Exception as e:
                        logger.error(f"Error processing SSE item in chat loop: {e}")
                    
                    yield sse_item
            
            # Fallback: if upstream model produced no visible response, apologize
            # cleanly. Do NOT leak narrative thought events back as the answer —
            # they are internal pipeline status, not the model's reply.
            full_response = full_response.strip()
            if not full_response:
                apology = (
                    "Извините, не удалось сформировать ответ. "
                    "Попробуйте переформулировать запрос или повторить через минуту."
                )
                yield format_sse({"type": "chunk", "content": apology})
                full_response = apology

            # Save assistant response in background using asyncio instead of background_tasks
            if full_response and export_request and export_request.target == "current":
                # «Ответь и собери в файл»: маркеры экспорта должны попасть в
                # сохранённый контент, а карточкам нужен настоящий DB id —
                # сохраняем синхронно (доли секунды в самом конце стрима).
                exp_formats = [
                    f for f in export_request.formats
                    if f != "pdf" or export_service.pdf_available()
                ] or ["docx"]
                exp_cards = [(f, export_service.suggest_filename(session.title, f)) for f in exp_formats]
                stored_response = full_response + "\n\n" + "\n".join(
                    export_service.build_export_marker(f, name) for f, name in exp_cards
                )
                try:
                    new_msg_id = await async_save_assistant_message(
                        session_id=session.id,
                        content=stored_response,
                        thoughts=full_thoughts.strip() if full_thoughts.strip() else None,
                        client_id=payload.assistant_client_id,
                        sources=sources if (use_deep_search_flag or use_research_flag) else None,
                    )
                    message_saved = True
                    for f, name in exp_cards:
                        yield format_sse({
                            "type": "file",
                            "format": f,
                            "message_id": new_msg_id,
                            "name": name,
                            "url": f"/chat/messages/{new_msg_id}/export?format={f}",
                        })
                except Exception as e:
                    # Rescue-сохранение в finally подхватит ответ без маркеров.
                    logger.error(f"Export-aware save failed, falling back to rescue save: {e}")
            elif full_response:
                message_saved = True
                asyncio.create_task(
                    asyncio.to_thread(
                        save_assistant_message,
                        session_id=session.id,
                        content=full_response,
                        thoughts=full_thoughts.strip() if full_thoughts.strip() else None,
                        client_id=payload.assistant_client_id,
                        sources=sources if (use_deep_search_flag or use_research_flag) else None
                    )
                )

            # Активная память: если чат в папке проекта, фоном извлекаем
            # факты из этого обмена и аккуратно дозаполняем паспорт. Запускаем
            # после сохранения ответа, чтобы не задерживать стрим. Ошибки
            # внутри проглатываются — память не должна ломать чат.
            if full_response and getattr(session, "project_id", None):
                try:
                    from project_memory_service import extract_and_store_facts
                    asyncio.create_task(extract_and_store_facts(
                        project_id=session.project_id,
                        # stored_content includes attached-file text, so the
                        # passport can learn from uploads too (SLM caps input).
                        user_text=stored_content,
                        assistant_text=full_response,
                        source_session_id=session.id,
                    ))
                except Exception as e:
                    logger.warning(f"schedule project memory extraction failed: {e}")

            # =======================================================
            # STAGE 7/7 — Background Semantic Cache write
            # Cache only successful, non-research, non-presentation
            # responses so future identical queries get the fast path.
            # =======================================================
            if full_response and not (use_deep_search_flag or use_research_flag or is_pres_request or attachments or export_request):
                try:
                    from ops.cache.semantic_cache import semantic_cache as _sc
                    asyncio.create_task(_sc.set(
                        query=cache_query,
                        response=full_response,
                        project_id=cache_scope,
                        sources=sources or None,
                    ))
                except Exception as e:
                    logger.error(f"Stage 6 (semantic cache set) failed: {e}")
        except Exception as e:
            logger.error(f"Session streaming failed: {type(e).__name__}: {e}", exc_info=True)
            pipeline_meta["fallbacks"].append("main_chat_provider")
            if full_response.strip():
                safe_error = "\n\nОтвет прервался из-за временной ошибки сервиса. Попробуйте повторить запрос."
            else:
                safe_error = (
                    "Не удалось получить ответ от аналитической модели. "
                    "Попробуйте повторить запрос через минуту."
                )
            full_response += safe_error
            yield format_sse({"type": "chunk", "content": safe_error})
        finally:
            # Rescue save: if message wasn't saved (e.g. stream aborted), save the partial response
            if not message_saved and full_response.strip():
                asyncio.create_task(
                    asyncio.to_thread(
                        save_assistant_message, 
                        session_id=session.id, 
                        content=full_response,
                        thoughts=full_thoughts.strip() if full_thoughts.strip() else None,
                        client_id=payload.assistant_client_id,
                        sources=sources if (use_deep_search_flag or use_research_flag) else None
                    )
                )
            if langfuse_context and (full_response or full_thoughts or usage_data):
                try:
                    update_params = {
                        "input": payload.content,
                        "output": f"<thought>{full_thoughts}</thought>\n\n{full_response}" if full_thoughts else full_response,
                        "model": provider
                    }
                    if usage_data:
                        update_params["usage"] = {
                            "input": usage_data.get("prompt_tokens", 0),
                            "output": usage_data.get("completion_tokens", 0),
                            "total": usage_data.get("total_tokens", 0)
                        }
                    update_params["metadata"] = {
                        **pipeline_meta,
                        "ttft": ttft,
                    }
                    
                    langfuse_context.update_current_observation(**update_params)
                except Exception as e:
                    logger.error(f"Langfuse tracking failed: {e}")

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }
    return EventSourceResponse(_with_heartbeat(session_chat_generator()), headers=headers)


def _extract_project_context_from_history(history_text: str) -> str:
    """Pull the structured ProjectContext that /chat/import-context stashes as
    a system message (prefix "Пользователь импортировал данные ..."). Falling
    back to an empty string is fine — the LLM still has full chat history.
    """
    try:
        marker = "Пользователь импортировал данные из внешней сессии. Основные тезисы:"
        idx = history_text.find(marker)
        if idx < 0:
            return ""
        tail = history_text[idx + len(marker):]
        # The JSON dump runs to end of the message; bound it by a newline+role
        # marker if present.
        for stop in ("\nuser:", "\nassistant:", "\nsystem:"):
            cut = tail.find(stop)
            if cut > 0:
                tail = tail[:cut]
                break
        return tail.strip()
    except Exception:
        return ""


def _try_extract_slide(buffer: str):
    """Best-effort: find the first complete top-level JSON object in `buffer`
    and return (slide_dict, remaining_buffer). Returns (None, buffer) when no
    complete object yet."""
    start = buffer.find("{")
    if start < 0:
        return None, buffer
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(buffer)):
        ch = buffer[i]
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                blob = buffer[start:i + 1]
                try:
                    obj = json.loads(blob)
                    return obj, buffer[i + 1:]
                except Exception:
                    return None, buffer  # malformed, wait for more
    return None, buffer


def _pres_state_key(session_id: int | None) -> str | None:
    """Redis key for per-session presentation state (z.ai conversation_id
    + last slides snapshot). None for anonymous/no-session callers."""
    return f"pres:state:{session_id}" if session_id else None


def _pres_get_state(session_id: int | None) -> dict:
    """Load persisted presentation state for a chat session, or {} if none."""
    key = _pres_state_key(session_id)
    if not key:
        return {}
    r = get_redis()
    if not r:
        return {}
    try:
        raw = r.get(key)
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _pres_save_state(session_id: int | None, state: dict) -> None:
    """Persist presentation state for 24h. Safe no-op without Redis."""
    key = _pres_state_key(session_id)
    if not key:
        return
    r = get_redis()
    if not r:
        return
    try:
        r.setex(key, 86400, json.dumps(state, ensure_ascii=False))
    except Exception as e:
        logger.warning(f"Failed to persist presentation state: {e}")


def _pres_rate_limit_check(user_id: int | None) -> None:
    """30s cooldown per user_id on presentation generation. Raises 429.
    Best-effort — silently allows when Redis is down."""
    if not user_id:
        return
    r = get_redis()
    if not r:
        return
    try:
        key = f"pres:rl:{user_id}"
        # SET NX EX 30 = first call within window succeeds, others fail.
        ok = r.set(key, "1", nx=True, ex=30)
        if not ok:
            ttl = r.ttl(key)
            raise HTTPException(
                status_code=429,
                detail=f"Слишком часто. Подождите {max(ttl, 1)}с перед следующим запросом презентации.",
            )
    except HTTPException:
        raise
    except Exception:
        pass


async def _handle_presentation_in_chat(user_message: str, history_text: str,
                                        rag_context: str,
                                        session_id: int | None = None,
                                        user_id: int | None = None,
                                        regenerate: bool = False):
    """Slide-agent flow. Streams thinking, then yields slides ONE-BY-ONE as
    soon as each is parseable from the model output — the UI can render them
    progressively instead of waiting for the whole deck.

    Provider preference, in order:
      1. Z.AI native slides_glm_agent (when ZAI_API_KEY is set) — purpose-
         built, returns styled HTML per slide.
      2. Makura glm-5 + our JSONL prompt — fallback when Z.AI isn't
         configured or its first attempt fails before any output.

    Conversation continuity: if `session_id` is supplied AND a previous deck
    exists in Redis state, we resume the z.ai conversation so follow-ups
    ("сделай 3-й слайд короче") edit the existing deck instead of starting
    over. Pass `regenerate=True` to drop the saved conversation_id and
    rebuild from scratch.
    """
    _pres_rate_limit_check(user_id)
    project_context = _extract_project_context_from_history(history_text)

    saved = _pres_get_state(session_id) if not regenerate else {}
    saved_conv_id = saved.get("zai_conversation_id")

    # ── Path 1: Z.AI native slide agent ────────────────────────────
    try:
        import zai_slide_agent
        if zai_slide_agent.is_configured():
            yield {"type": "provider", "name": "zai"}
            produced = False
            new_conv_id = saved_conv_id
            collected: list[dict] = []
            try:
                async for ev in zai_slide_agent.stream_slides(
                    user_message=user_message,
                    history_text=history_text,
                    rag_context=rag_context,
                    project_context=project_context,
                    conversation_id=saved_conv_id,
                ):
                    if ev.get("type") == "zai_conversation_id":
                        new_conv_id = ev.get("id") or new_conv_id
                        continue  # internal, don't surface to client
                    if ev.get("type") in ("slide", "presentation"):
                        data = ev.get("data")
                        if ev["type"] == "slide" and isinstance(data, dict):
                            collected.append(data)
                        elif ev["type"] == "presentation" and isinstance(data, list):
                            collected = data
                    produced = True
                    yield ev
                if produced:
                    _pres_save_state(session_id, {
                        "provider": "zai",
                        "zai_conversation_id": new_conv_id,
                        "slides": collected,
                    })
                    return
            except Exception as e:
                logger.warning(f"Z.AI slide agent failed before output, falling back to Makura: "
                               f"{type(e).__name__}: {e}")
                # fall through to Makura path
    except Exception as e:
        logger.warning(f"Z.AI slide agent module unavailable: {e}")

    # ── Path 2: Makura GLM-5 with JSONL streaming ─────────────────────────
    yield {"type": "provider", "name": "makura"}

    system_prompt = (
        "Ты — GLM Slide Agent, эксперт по инвестиционным презентациям (Pitch Decks). "
        "Создай 6-10 слайдов на русском в профессиональном бизнес-стиле.\n\n"
        "СТРОГИЕ ПРАВИЛА:\n"
        "1. Каждый элемент `content` — это КОРОТКАЯ ФРАЗА (3-8 слов), а НЕ предложение. "
        "Без вводных, без 'мы делаем', без причастных оборотов.\n"
        "2. ХОРОШО: \"До 60% времени уходит на оформление\"\n"
        "   ПЛОХО: \"Стартапы тратят слишком много времени на оформление, потому что...\"\n"
        "3. `title` — 1-5 слов. `subtitle` (только в Hero) — 5-12 слов.\n"
        "4. Опирайся на структуру Sequoia / YC: Hero → Problem → Solution → Market → "
        "BusinessModel → Team → CallToAction. Можно добавлять Traction, Competition.\n\n"
        "ФОРМАТ ВЫВОДА — НЕ JSON-массив, а ПОТОК отдельных объектов через `\\n` "
        "(по одному объекту на строку, без обёртки []):\n"
        '{"type":"Hero","title":"...","subtitle":"...","content":["..."]}\n'
        '{"type":"Problem","title":"...","content":["...","...","..."]}\n'
        "...\n\n"
        "Допустимые `type`: Hero, Problem, Solution, Market, BusinessModel, Team, "
        "Traction, Competition, CallToAction.\n"
        "НЕ оборачивай в markdown-fences (```), не пиши лишнего текста ни до ни после."
    )

    user_prompt_parts = [f"ЗАПРОС ПОЛЬЗОВАТЕЛЯ: {user_message}"]
    if project_context:
        user_prompt_parts.append(f"\nСТРУКТУРИРОВАННЫЙ КОНТЕКСТ ПРОЕКТА (импортированный):\n{project_context}")
    if history_text and history_text.strip():
        user_prompt_parts.append(f"\nИСТОРИЯ ДИАЛОГА:\n{history_text}")
    if rag_context and rag_context.strip():
        user_prompt_parts.append(f"\nКОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ (RAG):\n{rag_context}")
    user_prompt_parts.append("\nГенерируй слайды СЕЙЧАС, по одному JSON-объекту на строку.")
    prompt = "\n".join(user_prompt_parts)

    buffer = ""
    all_slides: list[dict] = []
    try:
        async for chunk in stream_makura(system_prompt, prompt):
            if isinstance(chunk, dict):
                if "__thinking__" in chunk:
                    yield {"type": "thought", "content": chunk["__thinking__"]}
                continue

            buffer += chunk

            # Try to pull as many complete slides as we can from the buffer.
            while True:
                slide, buffer = _try_extract_slide(buffer)
                if slide is None:
                    break
                if isinstance(slide, dict) and slide.get("type"):
                    all_slides.append(slide)
                    yield {"type": "slide", "data": slide, "position": len(all_slides)}

        # Final consolidated event for any legacy consumers expecting the full
        # array (the inline slide events above are the primary channel).
        if all_slides:
            yield {"type": "presentation", "data": all_slides}
            _pres_save_state(session_id, {"provider": "makura", "slides": all_slides})
            return

        # Fallback: if streaming-parse found nothing, try the legacy "one big
        # JSON array" parse on whatever's in the buffer.
        cleaned = buffer.strip()
        if "```json" in cleaned:
            cleaned = cleaned.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in cleaned:
            cleaned = cleaned.split("```", 1)[1].split("```", 1)[0].strip()
        start, end = cleaned.find("["), cleaned.rfind("]")
        if 0 <= start < end:
            slides = json.loads(cleaned[start:end + 1])
            if isinstance(slides, list):
                for i, s in enumerate(slides, 1):
                    yield {"type": "slide", "data": s, "position": i}
                yield {"type": "presentation", "data": slides}
                _pres_save_state(session_id, {"provider": "makura", "slides": slides})
                return

        yield {"type": "chunk", "content": "\nНе удалось собрать слайды — модель вернула неструктурированный ответ."}

    except Exception as e:
        logger.error(f"Failed Slide Agent Flow: {e}", exc_info=True)
        yield {"type": "chunk", "content": f"\nОшибка при сборке слайдов: {str(e)}"}

async def _generate_interviewer_response(session: ChatSession, db: AsyncSession) -> str:
    # Fetch history
    history_msgs = sorted(session.messages, key=lambda m: m.created_at)

    # Check if analysis already exists (sanity check, though we might allow re-analysis)
    if session.analysis_id:
        # If analysis done, maybe just chat normally?
        # For now, let's assume we continue strictly or we shouldn't act as interviewer anymore.
        # But user wants "possibility to continue dialog".
        # Let's simple context prompt for now.
        pass

    # We use a custom build payload here to inject SYSTEM_INTERVIEW_PROMPT and handle JSON

    # Prepare RAG context?
    # Get last user message
    last_user_text = ""
    for m in reversed(history_msgs):
        if m.role == "user":
            last_user_text = m.content
            break

    context_text = ""
    if last_user_text and len(last_user_text) > 10:
        try:
            # Parallel Phase 1: Intent, History RAG, Search Intent
            intent_task = classify_intent(last_user_text)
            history_rag_task = asyncio.create_task(rag.asearch_successful_chats(last_user_text, top_k=1))
            search_intent_task = slm_dispatcher.detect_search_intent(last_user_text)
            
            categories, successful_chats, search_decision = await asyncio.gather(
                intent_task, history_rag_task, search_intent_task
            )
            
            # Parallel Phase 2: Chroma RAG (needs categories) and Web Search (if needed)
            tasks = [asyncio.to_thread(rag.get_relevant_chunks, last_user_text, categories=categories, top_k=5)]
            
            needs_search = search_decision.get("needs_search")
            search_query = search_decision.get("search_query")
            if needs_search and search_query:
                logger.info(f"Agent triggered web search for query: {search_query}")
                tasks.append(asyncio.to_thread(execute_search_agent, search_query))
            
            results = await asyncio.gather(*tasks)
            chunks = results[0] # Chroma chunks
            
            if len(results) > 1 and results[1]: # web_context
                chunks.insert(0, f"--- АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ИНТЕРНЕТА (ПОИСК: {search_query}) ---\n{results[1]}\n--- КОНЕЦ ДАННЫХ ИЗ ИНТЕРНЕТА ---")

            if successful_chats:
                chunks.insert(0, f"--- ИСТОРИЧЕСКИ УСПЕШНЫЕ ДИАЛОГИ (ИСПОЛЬЗУЙ КАК ПРИМЕР) ---\n" + "\n".join(successful_chats) + "\n---------------------------------------------------------------\n")
            
            context_text = "\n".join(chunks) if 'chunks' in locals() else ""
        except Exception:
            pass

    # Determine Topic Mode
    topic = "Анализ идеи"
    if len(history_msgs) >= 3:
        topic = history_msgs[2].content.strip()

    system_prompt_final = SYSTEM_INTERVIEW_PROMPT
    if topic == "Анализ ЦА":
        system_prompt_final = SYSTEM_TA_PROMPT
    elif topic == "Посчитать экономику проекта":
        system_prompt_final = SYSTEM_ECONOMICS_PROMPT
    elif topic not in ("Анализ идеи", ""):  # "Другой вопрос" and general fallback
        system_prompt_final = SYSTEM_GENERAL_PROMPT

    if context_text:
        system_prompt_final += f"\n\nСправочная информация (RAG):\n{context_text}"

    # Call LLM
    try:
        # Helper to call YandexGPT with list of messages
        # We need to bypass `call_yandex_gpt` which is simple and uses `_build_payload`.
        # We can implement `_call_yandex_gpt_messages` or similar.
        # But `call_yandex_gpt` takes system_prompt and user_prompt.
        # If we want history, format it into user_prompt or use the `messages` list
        # properly if the helper supported it.
        # Current `yandex_gpt_client` seems to support `messages` list in `_build_payload`.
        # But `call_yandex_gpt` hardcodes it to [system, user].

        # Let's serialize history into text for now (simple approach) or fix client.
        # Serializing history is safer for "turn-based" API usage if we don't valid tokens.

        history_text = ""
        for m in history_msgs:
            role_label = "Основатель" if m.role == "user" else "Аналитик"
            history_text += f"{role_label}: {m.content}\n"

        final_user_prompt = f"История диалога:\n{history_text}\n\nТвоя реакция (вопрос, резюме или ответ на уточнение пользователя):"

        # Forcefully stop questions if history is too long
        # BUT only if analysis/summary hasn't been given yet
        # Check: if any AI message is longer than 500 chars, analysis was likely already given
        analysis_already_given = any(
            m.role == "assistant" and len(m.content) > 500
            for m in history_msgs[3:]  # skip greeting + topic
        )

        if not analysis_already_given:
            qa_limit = 7 if topic == "Анализ идеи" else 9
            if len(history_msgs) >= qa_limit:
                if topic == "Анализ идеи":
                    final_user_prompt += "\n\n[СИСТЕМНОЕ СООБЩЕНИЕ]: ЛИМИТ ВОПРОСОВ КЛИЕНТУ ИСЧЕРПАН. СНАЧАЛА НАПИШИ РАЗВЕРНУТОЕ ЧЕЛОВЕЧЕСКОЕ РЕЗЮМЕ АНАЛИТИКА (ТЕКСТОМ), А ЗАТЕМ В САМОМ КОНЦЕ ПРИЛОЖИ ФИНАЛЬНЫЙ JSON АНАЛИЗ ОТ 0 ДО 100."
                else:
                    final_user_prompt += "\n\n[СИСТЕМНОЕ СООБЩЕНИЕ]: ЛИМИТ ВОПРОСОВ КЛИЕНТУ ИСЧЕРПАН. СЕЙЧАС ЖЕ ВЫДАЙ ФИНАЛЬНОЕ ПОДРОБНОЕ РЕЗЮМЕ/СОВЕТЫ ПО ТЕМЕ БЕЗ КАКИХ-ЛИБО ВОПРОСОВ. ОТВЕЧАЙ КРАСИВЫМ ЧЕЛОВЕЧЕСКИМ ТЕКСТОМ."


        try:
            provider = os.getenv("PRIMARY_PROVIDER", "makura")
            if provider == "makura":
                raw_response, _, usage = await call_makura(system_prompt_final, final_user_prompt)
            else:
                raw_response, _, usage = await call_makura(system_prompt_final, final_user_prompt)
            if usage:
                logger.info(f"AI token usage ({provider} background summary): {usage}")
        except Exception as e:
            logger.error(f"Interviewer provider call failed: {e}")
            raw_response, usage = None, None

        if not raw_response:
            logger.error("Interviewer (Makura) failed: No response")
            return "Извините, я задумался. Можете повторить?"

        # Check if JSON
        clean_text = raw_response.strip()
        if topic == "Анализ идеи" and "{" in clean_text and "}" in clean_text:
            # Try parse
            try:
                data = extract_json_zai(clean_text)
                # It is analysis!
                # Validate fields
                if "investment_score" in data:
                    # Create Analysis
                    normalized = _normalize_analyze_data(data)

                    # Create Analysis entity
                    analysis = Analysis(
                        user_id=session.user_id,
                        payload_text=history_text,  # Save chat history as source
                        investment_score=normalized["investment_score"],
                        strengths=normalized["strengths"],
                        weaknesses=normalized["weaknesses"],
                        recommendations=normalized["recommendations"],
                        market_summary=normalized["market_summary"],
                    )
                    db.add(analysis)
                    await db.commit()
                    await db.refresh(analysis)

                    # Link to Session
                    session.analysis_id = analysis.id
                    await db.commit()
                    await db.refresh(session)

                    return (
                        f"Анализ готов! \n\n**Резюме:** {analysis.market_summary}\n\n"
                        f"**Оценка:** {analysis.investment_score}/100. \n\n"
                        "Вы можете увидеть полную версию в дашборде."
                    )
            except Exception:
                # Failed to parse, return raw text (maybe it was just a question with quotes)
                pass

        return clean_text

    except Exception as e:
        logger.error(f"Interviewer Error: {e}")
        return "Извините, я задумался. Можете повторить?"

