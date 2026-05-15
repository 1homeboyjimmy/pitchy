from contextlib import asynccontextmanager
from typing import Any
import asyncio
import json
import os
import logging
import time
import random
import secrets
from datetime import datetime, timedelta, date

import urllib.parse
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile, File, BackgroundTasks, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
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
from pydantic import BaseModel, Field, ValidationError
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
from redis_client import get_redis
from slm_dispatcher import slm_dispatcher
from makura_client import call_makura, stream_makura
from search_agent import execute_search_agent, execute_deep_research, async_search_with_sources
from db import SessionLocal, get_db
from db_async import get_async_db
from swarm_agent import run_analytical_swarm
from sqlalchemy.ext.asyncio import AsyncSession
from models import (
    Analysis, ChatMessage as DbChatMessage, ChatSession, ErrorLog, 
    User, PromoCode, Payment, RagLog, ToolResult, SocialAccount, ProjectTree
)
from sqlalchemy import select, func as sa_func
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
    "Ты — Pitchy, ведущий эксперт по венчурным инвестициям и развитию технологического бизнеса в России. "
    "ОТВЕЧАЙ СТРОГО НА РУССКОМ ЯЗЫКЕ. Использование китайских иероглифов или любых других языков (кроме общепринятых английских терминов) КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО. "
    "Если ты начнешь отвечать на китайском — это будет считаться системной ошибкой. "
    "Твоя задача — давать глубокий, структурированный и визуально чистый анализ проектов для российского рынка. "
    "Отвечай сразу полноценным итоговым ответом в формате чистого Markdown (жирный текст, списки, таблицы). "
    "НИКОГДА не используй теги <think>, <thought> или подобные — пиши ответ напрямую. "
    "Никогда не упоминай в ответе названия моделей, провайдеров, технологий бэкенда (Qwen, GLM, Makura, Exa, ChromaDB и т.п.) — представляйся только как Pitchy. "
    "Учитывай специфику РФ: регуляторику, конкуренцию, поведение потребителей и требования инвесторов."
)


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
    
    # Start RAG initialization in background task so server starts immediately
    async def _init_rag_bg():
        import asyncio
        max_retries = 3
        for attempt in range(max_retries):
            try:
                await rag.init_rag()
                logger.info("RAG initialized successfully in background.")
                return
            except Exception as e:
                logger.warning(f"RAG init failed (attempt {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(5)
        logger.error("RAG init failed permanently after retries.")
    
    asyncio.create_task(_init_rag_bg())
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
        },
    )
    return response

AUTH_RATE_LIMIT = {}
AUTH_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_RATE_WINDOW_SECONDS", "600"))
AUTH_RATE_MAX = int(os.getenv("AUTH_RATE_MAX", "10"))

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
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    error_details = traceback.format_exc()
    logger.error(f"GLOBAL ERROR: {str(exc)}\n{error_details}", extra={
        "path": request.url.path,
        "method": request.method,
    })
    _log_error(request, 500, str(exc))
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера. Мы уже работаем над исправлением."}
    )


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

@app.get("/health")
def health() -> dict:
    db_ok = _db_healthcheck()
    redis_ok = _redis_healthcheck()
    rag_ok = rag.healthcheck()
    # RAG loads in background - don't block deploy healthcheck on it
    status = "ok" if db_ok else "degraded"
    return {
        "status": status,
        "db": db_ok,
        "redis": redis_ok,
        "rag": rag_ok,
        "chromadb": rag_ok,
    }


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/dev/emails")
def dev_emails() -> list[dict]:
    if os.getenv("APP_ENV") != "dev":
        raise HTTPException(status_code=404, detail="Not available")
    return get_dev_emails()


@app.post("/auth/register")
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    _check_registration_rate_limit(ip)
    
    result = await db.execute(select(User).where(User.email == payload.email))
    exists = result.scalar_one_or_none()
    
    if exists:
        if not exists.email_verified:
            # Overwrite an abandoned unverified registration
            await db.delete(exists)
            await db.commit()
        else:
            raise HTTPException(status_code=400, detail="Email already registered")

    # Generate 6-digit code for manual entry
    verify_code = "".join([str(random.randint(0, 9)) for _ in range(6)])
    verify_hash = hash_token(verify_code)
    
    # Generate long token for links
    verify_token_str = secrets.token_urlsafe(32)
    verify_token_hash = hash_token(verify_token_str)
    
    verify_expires = datetime.utcnow() + timedelta(hours=24)

    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        email_verify_token_hash=verify_token_hash,
        email_verify_code_hash=verify_hash,
        email_verify_expires_at=verify_expires,
        email_verified=False,
        is_active=True,
    )
    db.add(user)
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Registration failed") from exc
    await db.refresh(user)

    try:
        await run_in_threadpool(
            send_email,
            payload.email,
            "Verify your email",
            f"Your verification code is: {verify_code}\n\nEnter this code to complete registration.",
        )
    except Exception:
        logger.error(f"Failed to send verification email to {payload.email}")

    return {"status": "verification_required", "email": payload.email}



@app.post("/auth/verify-email", response_model=TokenResponse)
async def verify_email_code(
    payload: EmailCodeVerifyRequest,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.email_verified:
        # Already verified, just log in
        pass
    else:
        if not user.email_verify_code_hash or not user.email_verify_expires_at:
            raise HTTPException(status_code=400, detail="No pending verification")

        if datetime.utcnow() > user.email_verify_expires_at:
            raise HTTPException(status_code=400, detail="Verification code expired")

        if not verify_token(payload.code, user.email_verify_code_hash):
            raise HTTPException(status_code=400, detail="Invalid verification code")

        user.email_verified = True
        user.email_verify_token_hash = None
        user.email_verify_code_hash = None
        user.email_verify_expires_at = None
        await db.commit()

    # Create session/token
    token = create_access_token(user.id)
    response.set_cookie(
        key=get_access_token_cookie_name(),
        value=token,
        httponly=True,
        secure=os.getenv("APP_ENV", "dev").lower() == "prod",
        samesite="lax",
        max_age=get_access_token_max_age(),
        path="/",
        domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
    )
    return TokenResponse(access_token=token)


@app.post("/auth/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is blocked")
    if user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=403, detail="User is temporarily locked")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Email is not verified")
    if not user or not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= 5:
            user.locked_until = datetime.utcnow() + timedelta(minutes=15)
            user.failed_login_attempts = 0
        await db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    from auth import needs_update, hash_password
    if needs_update(user.password_hash):
        user.password_hash = hash_password(payload.password)

    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()
    token = create_access_token(user.id)
    response.set_cookie(
        key=get_access_token_cookie_name(),
        value=token,
        httponly=True,
        secure=os.getenv("APP_ENV", "dev").lower() == "prod",
        samesite="lax",
        max_age=get_access_token_max_age(),
        path="/",
        domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
    )
    return TokenResponse(access_token=token)


@app.post("/auth/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(
        key=get_access_token_cookie_name(), 
        path="/",
        domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro")
    )
    return {"status": "ok"}


def _safe_next_path(value: str | None) -> str | None:
    """Allow only local app paths; reject external URLs and scheme-relative
    tricks (//host, /\\host). Used to validate the `next` redirect target
    after auth so we don't open an open-redirect."""
    if not value:
        return None
    if not value.startswith("/"):
        return None
    if value.startswith("//") or value.startswith("/\\"):
        return None
    return value


@app.get("/auth/{provider}/login")
async def auth_login(
    provider: str,
    next_path: str | None = Query(None, alias="next"),
):
    if provider == "yandex":
        redirect = await yandex_sso.get_login_redirect()
    elif provider == "github":
        redirect = await github_sso.get_login_redirect()
    elif provider == "google":
        redirect = await google_sso.get_login_redirect()
    else:
        raise HTTPException(status_code=404, detail="Provider not found")

    # Stash the post-auth destination in a short-lived cookie so the SSO
    # round-trip can survive without exposing it to the OAuth provider.
    safe_next = _safe_next_path(next_path)
    if safe_next:
        redirect.set_cookie(
            key="sso_next",
            value=safe_next,
            httponly=True,
            secure=os.getenv("APP_ENV", "dev").lower() == "prod",
            samesite="lax",
            max_age=600,  # 10 minutes is plenty for any SSO round-trip
            path="/",
            domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
        )
    return redirect


@app.get("/auth/{provider}/callback")
async def auth_callback(
    provider: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
):
    if provider == "yandex":
        sso = yandex_sso
    elif provider == "github":
        sso = github_sso
    elif provider == "google":
        sso = google_sso
    else:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        # Get user details from provider
        openid_user = await sso.verify_and_process(request)
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"SSO Error ({provider}): {str(e)}\n{error_details}", extra={
            "query_params": str(request.query_params),
            "provider": provider
        })
        raise HTTPException(status_code=400, detail="SSO Authentication Failed")

    if not openid_user or not openid_user.email:
        raise HTTPException(status_code=400, detail="No email provided by social login")

    # Check if social account exists
    from models import SocialAccount

    res_social = await db.execute(
        select(SocialAccount)
        .where(
            SocialAccount.provider == provider,
            SocialAccount.provider_id == str(openid_user.id),
        )
    )
    social_acc = res_social.scalar_one_or_none()

    if social_acc:
        res_user = await db.execute(select(User).where(User.id == social_acc.user_id))
        user = res_user.scalar_one_or_none()
    else:
        # Check if user with this email exists
        res_user = await db.execute(select(User).where(User.email == openid_user.email))
        user = res_user.scalar_one_or_none()

        if not user:
            # Create new user
            user = User(
                email=openid_user.email,
                name=openid_user.display_name or openid_user.email.split("@")[0],
                password_hash=None,
                is_active=True,
                email_verified=True,  # Trusted from OAuth
            )
            db.add(user)
            await db.flush()

        # Link social account
        social_acc = SocialAccount(
            user_id=user.id,
            provider=provider,
            provider_id=str(openid_user.id),
            email=openid_user.email,
        )
        db.add(social_acc)
        await db.commit()

    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is blocked")

    # Create session
    token = create_access_token(user.id)
    frontend_url = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")

    # Honour the `next` destination stashed by /auth/{provider}/login. The
    # dashboard route already captures `?token=` and pushes it into
    # localStorage; we forward `&next=` so the dashboard's redirect lands
    # the user on the page they actually wanted (e.g. /pricing).
    sso_next = _safe_next_path(request.cookies.get("sso_next"))
    target = f"{frontend_url}/dashboard?token={token}"
    if sso_next:
        target += f"&next={urllib.parse.quote(sso_next, safe='/')}"

    redirect = RedirectResponse(url=target, status_code=302)
    if sso_next:
        redirect.delete_cookie(
            "sso_next",
            path="/",
            domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
        )
    redirect.set_cookie(
        key=get_access_token_cookie_name(),
        value=token,
        httponly=True,
        secure=os.getenv("APP_ENV", "dev").lower() == "prod",
        samesite="lax",
        max_age=get_access_token_max_age(),
        path="/",
        domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
    )
    return redirect


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
    )


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

    # Main-chat user messages this month (counts only role="user")
    messages_used = (await db.execute(
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

    # Deep research messages — heuristic: messages with non-empty `sources` JSON,
    # which is only set when use_deep_search/use_research was on.
    try:
        research_used = (await db.execute(
            select(sa_func.count())
            .select_from(DbChatMessage)
            .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
            .where(
                ChatSession.user_id == user.id,
                DbChatMessage.role == "assistant",
                DbChatMessage.created_at >= month_start,
                DbChatMessage.sources.isnot(None),
            )
        )).scalar() or 0
    except Exception:
        research_used = 0

    def remaining(limit_value: int, used: int) -> int | None:
        if limit_value == UNLIMITED:
            return None  # JSON null → frontend treats as unlimited
        return max(0, limit_value - used)

    return {
        "tier": tier_name,
        "limits": limits_as_dict(limits),
        "usage": {
            "messages": messages_used,
            "custdev": custdev_used,
            "roadmaps": roadmaps_used,
            "deep_research": research_used,
        },
        "remaining": {
            "messages": remaining(limits.messages, messages_used),
            "custdev": remaining(limits.custdev, custdev_used),
            "roadmaps": remaining(limits.roadmaps, roadmaps_used),
            "deep_research": remaining(limits.deep_research, research_used),
        },
        "period_start": month_start.isoformat() + "Z",
    }


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
            await run_in_threadpool(
                send_email,
                payload.email,
                "Verify your new email",
                f"Your verification code is: {verify_code}\n\nEnter this code to convert your email.",
            )
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
        send_email(
            user.email,
            "Verification Code for Password Change",
            f"Your verification code is: {code}\n\nIt expires in 10 minutes.",
        )
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
        send_email(
            user.email,
            "Password Changed",
            "Your password has been successfully changed.",
        )
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
        send_email(
            user.email,
            "Verify your email",
            f"Your verification code is: {verify_code}\n\nEnter this code to complete verification.",
        )
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
    res = await db.execute(select(User).where(User.email == payload.email))
    user = res.scalar_one_or_none()
    if not user:
        return {"status": "ok"}
    code = "".join(str(random.randint(0, 9)) for _ in range(6))
    user.password_reset_token_hash = hash_token(code)
    user.password_reset_expires_at = datetime.utcnow() + timedelta(minutes=15)
    await db.commit()
    try:
        send_email(
            payload.email,
            "Код для сброса пароля Pitchy",
            (
                f"Ваш код для сброса пароля: {code}\n\n"
                "Введите этот код на странице сброса пароля. "
                "Код действителен 15 минут.\n\n"
                "Если вы не запрашивали сброс — просто проигнорируйте это письмо."
            ),
        )
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
    res = await db.execute(select(User).where(User.email == payload.email))
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


@app.post("/auth/verify-email")
async def verify_email(
    payload: EmailVerifyRequest,
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    token_hash = hash_token(payload.token)
    res = await db.execute(select(User).where(User.email_verify_token_hash == token_hash))
    user = res.scalar_one_or_none()
    if (
        not user
        or not user.email_verify_expires_at
        or user.email_verify_expires_at < datetime.utcnow()
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user.email_verified = True
    user.email_verify_token_hash = None
    user.email_verify_expires_at = None
    await db.commit()
    return {"status": "ok"}


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
        "presentation": limits.can_use_presentation,
        "import": limits.can_use_import_context,
    }
    if feature and feature in feature_map and not feature_map[feature]:
        feature_label = {
            "custdev": "глубокий CustDev",
            "tree": "интерактивная дорожная карта",
            "deep_search": "поиск в интернете",
            "research": "глубокое исследование",
            "presentation": "генерация презентации",
            "import": "импорт контекста",
        }.get(feature, feature)
        raise HTTPException(
            status_code=403,
            detail=f"upgrade_required: функция «{feature_label}» доступна на тарифах Starter и Pro. Обновите подписку.",
        )

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
        if limits.messages == UNLIMITED:
            return
        used = (await db.execute(
            select(sa_func.count())
            .select_from(DbChatMessage)
            .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
            .where(
                ChatSession.user_id == user.id,
                DbChatMessage.role == "user",
                DbChatMessage.created_at >= month_start,
            )
        )).scalar() or 0
        if used >= limits.messages:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"quota_exceeded: исчерпан месячный лимит сообщений на тарифе {tier} "
                    f"({limits.messages}). Обновите подписку, чтобы продолжить."
                ),
            )


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
    finally:
        db.close()


async def async_save_assistant_message(session_id: int, content: str, thoughts: str | None = None, client_id: str | None = None, sources: list[dict] | None = None):
    from db_async import AsyncSessionLocal
    from models import ChatMessage as DbChatMessage
    async with AsyncSessionLocal() as db:
        msg = DbChatMessage(
            session_id=session_id, 
            role="assistant", 
            content=content,
            thoughts=thoughts,
            client_id=client_id,
            sources=sources
        )
        db.add(msg)
        await db.commit()


@app.post("/chat")
async def chat(payload: ChatRequest):
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
    return {"status": "ok"}


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


@app.post("/chat/messages")
@observe(name="create_chat_message")
async def create_chat_message(
    payload: ChatMessageCreateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> StreamingResponse:
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
        )
        for u in users
    ]


@app.post("/admin/users/{user_id}/block")
async def admin_block_user(
    user_id: int,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    await db.commit()
    return {"status": "ok"}


@app.post("/admin/users/{user_id}/unblock")
async def admin_unblock_user(
    user_id: int,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = True
    await db.commit()
    return {"status": "ok"}


@app.post("/admin/users/{user_id}/make-admin")
async def admin_make_admin(
    user_id: int,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_admin = True
    await db.commit()
    return {"status": "ok"}


@app.delete("/admin/users/{user_id}")
async def admin_delete_user(
    user_id: int,
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    from sqlalchemy import delete
    
    session_res = await db.execute(select(ChatSession.id).where(ChatSession.user_id == user.id))
    session_ids = session_res.scalars().all()
    
    if session_ids:
        await db.execute(delete(DbChatMessage).where(DbChatMessage.session_id.in_(session_ids)))
        
    await db.execute(delete(ChatSession).where(ChatSession.user_id == user.id))
    await db.execute(delete(Analysis).where(Analysis.user_id == user.id))
    
    await db.delete(user)
    await db.commit()
    return {"status": "ok"}


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
    query = select(User).where(User.subscription_tier != "free")
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
    await async_check_subscription_limits(user, db, "project")

    session = ChatSession(
        user_id=user.id,
        title=payload.title,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    messages_response = []

    if payload.initial_message:
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

async def rename_chat_session_background(session_id: int, initial_message: str):
    try:
        title = await slm_dispatcher.generate_chat_title(initial_message)
        logger.info(f"Generated title '{title}' for session {session_id}")
        
        from db_async import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
            session = res.scalar_one_or_none()
            if session:
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
    await async_check_subscription_limits(user, db, "project")
    
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
    await async_check_subscription_limits(user, db, "project")
    
    session = ChatSession(
        user_id=user.id,
        title="Новый диалог",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    messages_response = []
    
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


@app.delete("/chat/sessions/{session_id}")
async def delete_chat_session(
    session_id: int,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    res = await db.execute(
        select(ChatSession)
        .where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    await db.delete(session)
    await db.commit()
    return {"status": "ok", "deleted_id": session_id}
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

    # Determine which feature flag (if any) this request is asking for so
    # the limit check can short-circuit with upgrade_required on free tier.
    requested_feature = None
    if getattr(payload, "use_research", False):
        requested_feature = "research"
    elif getattr(payload, "use_deep_search", False):
        requested_feature = "deep_search"
    elif getattr(payload, "intent", None) == "presentation":
        requested_feature = "presentation"

    await async_check_subscription_limits(
        user,
        db,
        "message",
        session.id,
        feature=requested_feature,
        is_search=getattr(payload, "use_deep_search", False),
    )

    # 1. Save User Message
    user_msg = DbChatMessage(
        session_id=session.id,
        role="user",
        content=payload.content,
        client_id=payload.client_id
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(session)

    if len(session.messages) == 1:
        background_tasks.add_task(rename_chat_session_background, session.id, payload.content)

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

        provider = os.getenv("PRIMARY_PROVIDER", "makura")
        full_response = ""
        full_thoughts = ""
        usage_data = None
        sources = []
        start_time = time.time()
        ttft = None
        message_saved = False  # Track if the message was successfully queued for saving

        try:
            # We need history for contextual responses — use pre-loaded messages
            history = sorted(session.messages, key=lambda m: m.created_at)
            chat_history = [ChatMessage(role=m.role, content=m.content) for m in history]

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
            # STAGE 1/6 — Semantic cache lookup
            # ===========================================================
            yield _emit_thought("Проверяю, не отвечал ли я на похожий вопрос недавно.\n")

            if not (use_deep_search_flag or use_research_flag or is_pres_request):
                try:
                    from ops.cache.semantic_cache import semantic_cache as _sc
                    cached = await _sc.get(query=payload.content, project_id=str(session.id))
                    if cached:
                        yield _emit_thought("Нашёл подходящий ответ из памяти — отдаю мгновенно.\n")
                        yield format_sse({"type": "metadata", "model": "Pitchy"})
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
                            sources=None,
                        ))
                        return
                except Exception as e:
                    logger.error(f"Semantic cache lookup failed: {e}")
            else:
                yield _emit_thought("Пропускаю быстрый ответ — нужен свежий анализ.\n")

            # ===========================================================
            # STAGE 2/6 — Parallel: intent classifier + knowledge base
            # ===========================================================
            cats: list = []
            slm_res: dict = {}
            context_chunks: list = []
            try:
                from slm_dispatcher import slm_dispatcher as _slm
                slm_task = asyncio.create_task(_slm.classify_query_intent(payload.content))
                context_task = asyncio.create_task(
                    asyncio.to_thread(rag.get_relevant_chunks, payload.content, categories=None, top_k=10)
                )

                yield _emit_thought("Разбираюсь в сути запроса и одновременно поднимаю релевантный контекст из базы знаний.\n")

                pending = {slm_task, context_task}
                while pending:
                    _, pending = await asyncio.wait(pending, timeout=5.0)
                    if pending:
                        yield format_sse({"type": "ping"})

                if slm_task.exception() is None:
                    slm_res = slm_task.result() or {}
                    cats = slm_res.get("categories") or []
                if context_task.exception() is None:
                    context_chunks = context_task.result() or []

                if cats:
                    context_chunks = [
                        c for c in context_chunks
                        if isinstance(c, dict) and any(cat in c.get('metadata', {}).get('collection', '') for cat in cats)
                    ] or context_chunks

                topic_label = "финансовая модель" if slm_res.get("is_finance") else \
                              "глубокий анализ" if slm_res.get("is_deep_search") else "общий анализ"
                yield _emit_thought(
                    f"Определил тематику: {topic_label}. "
                    f"Поднял {len(context_chunks)} релевантных фрагментов из базы знаний.\n"
                )
            except Exception as e:
                logger.error(f"Stage 2 (intent+RAG) failed: {e}")
                yield _emit_thought("Контекст подгрузить не удалось — отвечаю на общих знаниях.\n")

            # ===========================================================
            # STAGE 3/6 — Web search (conditional)
            # ===========================================================
            search_ctx = ""
            should_search = (
                use_deep_search_flag
                or use_research_flag
                or slm_res.get("is_deep_search", False)
            )
            if should_search and not is_pres_request:
                yield _emit_thought("Запрос требует свежих данных — ищу актуальную информацию в интернете.\n")
                try:
                    from search_agent import async_search_with_sources
                    search_sources, search_ctx = await async_search_with_sources(payload.content, use_deep_search=True)
                    if search_sources:
                        sources = search_sources
                        yield format_sse({"type": "sources", "data": search_sources})
                        yield _emit_thought(f"Подобрал {len(search_sources)} проверенных источников.\n")
                except Exception as e:
                    logger.error(f"Stage 3 (web search) failed: {e}")
            else:
                yield _emit_thought("Внешний поиск не нужен — данных в базе знаний достаточно.\n")

            # ===========================================================
            # STAGE 4/6 — Analytical agents (Map phase)
            # ===========================================================
            swarm_facts = ""
            rag_texts = [c["text"] if isinstance(c, dict) else c for c in context_chunks[:10]]
            chunks_for_swarm = rag_texts + ([search_ctx] if search_ctx else [])

            if chunks_for_swarm and not is_pres_request and not use_research_flag:
                yield _emit_thought(
                    f"Прогоняю {len(chunks_for_swarm)} фрагментов через аналитических агентов "
                    "— ищу проверенные факты, цифры и упоминания конкурентов.\n"
                )
                try:
                    from swarm_agent import run_analytical_swarm
                    swarm_res = await run_analytical_swarm(chunks_for_swarm)
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
                        yield _emit_thought(f"Извлёк {len(facts)} групп проверенных фактов.\n")
                    else:
                        yield _emit_thought("Структурированных фактов не нашлось — опираюсь на исходные фрагменты.\n")
                except Exception as e:
                    logger.error(f"Stage 4 (analytical agents) failed: {e}")
                    yield _emit_thought("Аналитические агенты недоступны — опираюсь на исходные фрагменты.\n")
            else:
                yield _emit_thought("Дополнительный анализ фрагментов не требуется.\n")

            # Compile final RAG context for GLM-5 (Reduce phase input)
            compiled_rag = ""
            if swarm_facts:
                compiled_rag += f"ПРОВЕРЕННЫЕ ФАКТЫ ИЗ БАЗЫ ЗНАНИЙ И СЕТИ:\n- {swarm_facts}\n\n"
            if not swarm_facts and rag_texts:
                compiled_rag += f"ДАННЫЕ ИЗ БАЗЫ ЗНАНИЙ:\n{chr(10).join(rag_texts[:3])}\n\n"
            if search_ctx and not swarm_facts:
                compiled_rag += f"ДАННЫЕ ИЗ ИНТЕРНЕТА:\n{search_ctx[:2500]}\n\n"

            # 3.1 MODE: PRESENTATION GENERATION
            if is_pres_request:
                yield format_sse({"type": "chunk", "content": "Начинаю сборку вашей презентации...\n\n"})
                full_response += "Начинаю сборку вашей презентации...\n\n"
                
                # Use history and context to build slides
                history_text = "\n".join([f"{m.role}: {m.content[:200]}" for m in history[-10:]])
                context_text = "\n".join([c["text"] if isinstance(c, dict) else c for c in context_chunks[:3]])
                
                final_slides = []
                async for item in _handle_presentation_in_chat(payload.content, history_text, context_text):
                    if item["type"] == "thought":
                        full_thoughts += item["content"]
                        yield format_sse(item)
                    elif item["type"] == "presentation":
                        final_slides = item["data"]
                        yield format_sse(item)
                    elif item["type"] == "chunk":
                        full_response += item["content"]
                        yield format_sse(item)
                
                if final_slides:
                    msg = "Презентация успешно сгенерирована! Открываю панель просмотра."
                    yield format_sse({"type": "chunk", "content": msg})
                    full_response += msg
                else:
                    msg = "К сожалению, не удалось сгенерировать правильный формат презентации. Попробуйте еще раз или уточните запрос."
                    yield format_sse({"type": "chunk", "content": msg})
                    full_response += msg

            # 4. MODE: DEEP RESEARCH
            elif getattr(payload, "use_research", False):
                from search_agent import stream_deep_research
                async for chunk in stream_deep_research(payload.content):
                    if chunk["type"] == "chunk":
                        if ttft is None: ttft = time.time() - start_time
                        full_response += chunk["content"]
                    elif chunk["type"] == "thought":
                        full_thoughts += chunk["content"]
                    elif chunk["type"] == "sources":
                        sources = chunk.get("data", [])
                    yield format_sse(chunk)
            
            # 4. MODE: QUICK SEARCH OR REGULAR CHAT
            else:
                # =======================================================
                # STAGE 5/6 — GLM-5 Reduce phase (synthesis + streaming)
                # =======================================================
                history_text = "\n".join([f"{m.role}: {m.content[:300]}" for m in chat_history[-8:]])
                user_prompt = (
                    f"{compiled_rag}"
                    f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\n"
                    f"Вопрос пользователя: {payload.content}"
                )

                yield _emit_thought("Готов. Формулирую развёрнутый ответ на основе собранных данных.\n")
                raw_gen = stream_makura(SYSTEM_CHAT_PROMPT, user_prompt)

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
            if full_response:
                message_saved = True
                asyncio.create_task(
                    asyncio.to_thread(
                        save_assistant_message,
                        session_id=session.id,
                        content=full_response,
                        thoughts=full_thoughts.strip() if full_thoughts.strip() else None,
                        client_id=payload.assistant_client_id,
                        sources=sources if getattr(payload, "use_deep_search", False) else None
                    )
                )

            # =======================================================
            # STAGE 6/6 — Background Semantic Cache write
            # Cache only successful, non-research, non-presentation
            # responses so future identical queries get the fast path.
            # =======================================================
            if full_response and not (use_deep_search_flag or use_research_flag or is_pres_request):
                try:
                    from ops.cache.semantic_cache import semantic_cache as _sc
                    asyncio.create_task(_sc.set(
                        query=payload.content,
                        response=full_response,
                        project_id=str(session.id),
                    ))
                except Exception as e:
                    logger.error(f"Stage 6 (semantic cache set) failed: {e}")
        except Exception as e:
            logger.error(f"Session streaming failed: {e}")
            yield format_sse({"type": "error", "content": str(e)})
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
                        sources=sources if getattr(payload, "use_deep_search", False) else None
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
                    if ttft is not None:
                        update_params["metadata"] = {"ttft": ttft}
                    
                    langfuse_context.update_current_observation(**update_params)
                except Exception as e:
                    logger.error(f"Langfuse tracking failed: {e}")

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }
    return EventSourceResponse(_with_heartbeat(session_chat_generator()), headers=headers)


async def _handle_presentation_in_chat(user_message: str, history_text: str, rag_context: str):
    """
    Acts as a Slide Agent. Uses streaming to provide thoughts and then yields the slides.
    Following Z.AI Agent Task patterns.
    """
    system_prompt = (
        "Ты — GLM Slide Agent, эксперт по созданию профессиональных инвестиционных презентаций (Pitch Decks). "
        "Твоя задача — проанализировать проект и создать структуру и контент для 6-10 слайдов.\n\n"
        "ПРОТОКОЛ РАБОТЫ:\n"
        "1. Тебе будет включен Thinking Mode. СНАЧАЛА детально проанализируй проект, выдели УТП, боли рынка и решение.\n"
        "2. Сформируй структуру презентации, следуя стандартам Sequoia Capital или Y Combinator.\n"
        "3. Генерируй контент для каждого слайда в формате JSON.\n\n"
        "ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ К КОНТЕНТУ:\n"
        "- Тексты должны быть на русском языке, в профессиональном бизнес-стиле.\n"
        "- content должен быть массивом из 3-5 четких тезисов.\n\n"
        "ФОРМАТ ВЫВОДА (ТОЛЬКО JSON):\n"
        "[\n"
        "  {\"type\": \"Hero\", \"title\": \"Название\", \"subtitle\": \"Слоган\", \"content\": [\"Тезис 1\"]},\n"
        "  ...\n"
        "]\n\n"
        "Допустимые типы: 'Hero', 'Problem', 'Solution', 'Market', 'BusinessModel', 'Team', 'CallToAction'."
    )
    
    prompt = (
        f"ЗАПРОС ПОЛЬЗОВАТЕЛЯ: {user_message}\n\n"
        f"ИСТОРИЯ ДИАЛОГА:\n{history_text}\n\n"
        f"КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ (RAG):\n{rag_context}\n\n"
        "Создай презентацию прямо сейчас."
    )
    
    full_content = ""
    try:
        # We use stream_makura here to capture reasoning_content and content
        async for chunk in stream_makura(system_prompt, prompt):
            if isinstance(chunk, dict):
                if "__thinking__" in chunk:
                    yield {"type": "thought", "content": chunk["__thinking__"]}
                elif "__usage__" in chunk:
                    # Ignore usage for now or handle if needed
                    pass
                continue
            
            # This is normal content (the JSON slides)
            full_content += chunk
            
        # At the end, parse the full_content as JSON
        cleaned = full_content.strip()
        if "```json" in cleaned:
            cleaned = cleaned.split("```json")[1].split("```")[0].strip()
        elif "```" in cleaned:
            cleaned = cleaned.split("```")[1].split("```")[0].strip()
            
        start = cleaned.find('[')
        end = cleaned.rfind(']')
        if start != -1 and end != -1:
            cleaned = cleaned[start:end+1]
            
        slides = json.loads(cleaned)
        if isinstance(slides, list):
            yield {"type": "presentation", "data": slides}
            
    except Exception as e:
        logger.error(f"Failed Slide Agent Flow: {e}")
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

