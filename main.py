from contextlib import asynccontextmanager
import asyncio
import os
import logging
import time
import random
from datetime import datetime, timedelta, date

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.responses import StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session
from sqlalchemy import text
from dotenv import load_dotenv

import rag
from scraper import scrape_and_save, extract_text_from_pdf
from lockbox import lockbox
from metrics import ERROR_COUNT, REQUEST_COUNT, REQUEST_LATENCY
from observability import configure_logging
import uuid
from redis_client import get_redis
from yandex_gpt_client import YandexGPTError, call_yandex_gpt, extract_json
from zai_client import generate_chat_title, analyze_search_intent
from routerai_client import call_routerai, stream_routerai
from makura_client import call_makura, stream_makura
from search_agent import execute_search_agent
from db import SessionLocal, get_db
from models import User, PromoCode, Analysis, Payment, RagLog
from models import Analysis, ChatMessage as DbChatMessage, ChatSession, ErrorLog, User, PromoCode, Payment
from sqlalchemy import func as sa_func
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
)
from email_utils import get_dev_emails, send_email
from sso import yandex_sso, github_sso, google_sso
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
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты — эксперт по венчурным инвестициям в России. Проанализируй стартап с учётом "
    "российского рынка: регуляторики, конкуренции, поведения потребителей, каналов "
    "продвижения и требований инвесторов (РВК, бизнес-ангелы). Используй только "
    "достоверные данные из контекста. Отвечай строго в формате JSON без пояснений."
)
SYSTEM_CHAT_PROMPT = (
    "Ты — эксперт по венчурным инвестициям в России. Веди диалог и отвечай сплошным "
    "текстом. Сначала запиши свои мысли/размышления о запросе внутри тегов <thought>...</thought>, "
    "а затем дай итоговый ответ пользователю. Никогда не используй markdown-заголовки с решетками (### и подобные). "
    "Задавай пользователю МАКСИМУМ один уточняющий вопрос за раз, только если это критически важно. "
    "Учитывай российский рынок: регуляторику, конкуренцию, поведение потребителей, "
    "каналы продвижения и требования инвесторов (РВК, бизнес-ангелы). "
    "Если в контексте из интернета (RAG) есть полезная информация, "
    "ОБЯЗАТЕЛЬНО детально описывай её, перечисляй суммы, условия и названия грантов или программ прямо в чате. "
    "Избегай сухих ответов в стиле 'ознакомьтесь на сайте'."
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
    
    # Start RAG initialization in background thread so server starts immediately
    # and can respond to healthchecks while model loads.
    # Model weights are pre-cached in Docker image, so load is fast (~10-30s).
    import threading
    def _init_rag_bg():
        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                rag.init_rag()
                logger.info("RAG initialized successfully in background.")
                return
            except Exception as e:
                logger.warning(f"RAG init failed (attempt {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(5)
        logger.error("RAG init failed permanently after retries.")
    t = threading.Thread(target=_init_rag_bg, daemon=True)
    t.start()
    yield


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
    if len(timestamps) >= AUTH_RATE_MAX:
        raise HTTPException(status_code=429, detail="Too many requests")
    timestamps.append(now)
    AUTH_RATE_LIMIT[ip] = timestamps


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
async def unhandled_exception_handler(request: Request, exc: Exception):
    _log_error(request, 500, str(exc))
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


def _build_user_prompt(description: str, context_chunks: list[str]) -> str:
    context_block = "\n".join(
        [f"{idx + 1}. {chunk}" for idx, chunk in enumerate(context_chunks)]
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


def _build_chat_prompt(messages: list[ChatMessage], context_chunks: list[str]) -> str:
    context_block = "\n".join(
        [f"{idx + 1}. {chunk}" for idx, chunk in enumerate(context_chunks)]
    )
    history = _format_chat_history(messages)
    return (
        "Контекст:\n"
        f"{context_block}\n\n"
        "Диалог:\n"
        f"{history}\n\n"
        "Продолжи диалог и ответь на последнюю реплику пользователя."
    )


@app.get("/")
def index() -> dict:
    return {"status": "ok"}


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
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    exists = db.query(User).filter(User.email == payload.email).first()
    if exists:
        if not exists.email_verified:
            # Overwrite an abandoned unverified registration
            db.delete(exists)
            db.commit()
        else:
            raise HTTPException(status_code=400, detail="Email already registered")

    # Generate 6-digit code
    verify_code = "".join([str(random.randint(0, 9)) for _ in range(6)])
    verify_hash = hash_token(verify_code)
    verify_expires = datetime.utcnow() + timedelta(hours=24)

    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        email_verify_token_hash=verify_hash,
        email_verify_expires_at=verify_expires,
        email_verified=False,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Registration failed") from exc
    db.refresh(user)

    try:
        send_email(
            payload.email,
            "Verify your email",
            f"Your verification code is: {verify_code}\n\nEnter this code to complete registration.",
        )
    except Exception:
        # Log error but don't fail registration
        logger.error(f"Failed to send verification email to {payload.email}")

    return {"status": "verification_required", "email": payload.email}


@app.post("/auth/verify-email", response_model=TokenResponse)
def verify_email_code(
    payload: EmailCodeVerifyRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.email_verified:
        # Already verified, just log in
        pass
    else:
        if not user.email_verify_token_hash or not user.email_verify_expires_at:
            raise HTTPException(status_code=400, detail="No pending verification")

        if datetime.utcnow() > user.email_verify_expires_at:
            raise HTTPException(status_code=400, detail="Verification code expired")

        if not verify_token(payload.code, user.email_verify_token_hash):
            raise HTTPException(status_code=400, detail="Invalid verification code")

        user.email_verified = True
        user.email_verify_token_hash = None
        user.email_verify_expires_at = None
        db.commit()

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
    )
    return TokenResponse(access_token=token)


@app.post("/auth/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    user = db.query(User).filter(User.email == payload.email).first()
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
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()
    token = create_access_token(user.id)
    response.set_cookie(
        key=get_access_token_cookie_name(),
        value=token,
        httponly=True,
        secure=os.getenv("APP_ENV", "dev").lower() == "prod",
        samesite="lax",
        max_age=get_access_token_max_age(),
        path="/",
    )
    return TokenResponse(access_token=token)


@app.post("/auth/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(key=get_access_token_cookie_name(), path="/")
    return {"status": "ok"}


@app.get("/auth/{provider}/login")
async def auth_login(provider: str):
    if provider == "yandex":
        return await yandex_sso.get_login_redirect()
    elif provider == "github":
        return await github_sso.get_login_redirect()
    elif provider == "google":
        return await google_sso.get_login_redirect()
    raise HTTPException(status_code=404, detail="Provider not found")


@app.get("/auth/{provider}/callback")
async def auth_callback(
    provider: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
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

    social_acc = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.provider == provider,
            SocialAccount.provider_id == str(openid_user.id),
        )
        .first()
    )

    if social_acc:
        user = db.query(User).filter(User.id == social_acc.user_id).first()
    else:
        # Check if user with this email exists
        user = db.query(User).filter(User.email == openid_user.email).first()

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
            db.flush()

        # Link social account
        social_acc = SocialAccount(
            user_id=user.id,
            provider=provider,
            provider_id=str(openid_user.id),
            email=openid_user.email,
        )
        db.add(social_acc)
        db.commit()

    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is blocked")

    # Create session
    token = create_access_token(user.id)
    frontend_url = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")
    # Pass token in URL so frontend can pick it up and save to localStorage
    redirect = RedirectResponse(url=f"{frontend_url}/dashboard?token={token}", status_code=302)
    redirect.set_cookie(
        key=get_access_token_cookie_name(),
        value=token,
        httponly=True,
        secure=os.getenv("APP_ENV", "dev").lower() == "prod",
        samesite="lax",
        max_age=get_access_token_max_age(),
        path="/",
        domain=os.getenv("COOKIE_DOMAIN", None),
    )
    return redirect


@app.api_route("/me", methods=["GET", "POST"], response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> UserResponse:
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


@app.patch("/me", response_model=UserResponse)
def update_me(
    payload: UserUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    if payload.name:
        user.name = payload.name
        
    if payload.cookie_consent is not None:
        user.cookie_consent = payload.cookie_consent

    if payload.email and payload.email != user.email:
        exists = db.query(User).filter(User.email == payload.email).first()
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
            send_email(
                payload.email,
                "Verify your new email",
                f"Your verification code is: {verify_code}\n\nEnter this code to convert your email.",
            )
        except Exception:
            logger.error("Failed to send verification email during update")

    db.commit()
    db.refresh(user)

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
def initiate_change_password(
    payload: PasswordChangeInitRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    db.commit()

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
def confirm_change_password(
    payload: PasswordChangeConfirmRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    db.commit()

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
def resend_verification(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    db.commit()

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
def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        return {"status": "ok"}
    token = generate_token()
    user.password_reset_token_hash = hash_token(token)
    user.password_reset_expires_at = datetime.utcnow() + timedelta(hours=1)
    db.commit()
    try:
        base_url = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")
        reset_link = f"{base_url}/account?reset={token}"
        send_email(
            payload.email,
            "Reset your password",
            f"Reset your password using this link: {reset_link}",
        )
    except Exception:
        pass
    return {"status": "ok"}


@app.post("/auth/reset-password")
def reset_password(
    payload: PasswordResetConfirm,
    db: Session = Depends(get_db),
) -> dict:
    token_hash = hash_token(payload.token)
    user = (
        db.query(User)
        .filter(User.password_reset_token_hash == token_hash)
        .first()
    )
    if (
        not user
        or not user.password_reset_expires_at
        or user.password_reset_expires_at < datetime.utcnow()
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user.password_hash = hash_password(payload.new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    db.commit()
    return {"status": "ok"}


@app.post("/auth/verify-email")
def verify_email(
    payload: EmailVerifyRequest,
    db: Session = Depends(get_db),
) -> dict:
    token_hash = hash_token(payload.token)
    user = db.query(User).filter(User.email_verify_token_hash == token_hash).first()
    if (
        not user
        or not user.email_verify_expires_at
        or user.email_verify_expires_at < datetime.utcnow()
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user.email_verified = True
    user.email_verify_token_hash = None
    user.email_verify_expires_at = None
    db.commit()
    return {"status": "ok"}


@app.post("/analyze-startup", response_model=AnalyzeResponse)
async def analyze_startup(payload: AnalyzeRequest) -> AnalyzeResponse:
    try:
        context_chunks = rag.get_relevant_chunks(payload.description, top_k=3)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_prompt = _build_user_prompt(payload.description, context_chunks)

    try:
        provider = os.getenv("PRIMARY_PROVIDER", "routerai")
        if provider == "makura":
            raw_text, usage = await call_makura(SYSTEM_PROMPT, user_prompt)
        else:
            raw_text, usage = await call_routerai(SYSTEM_PROMPT, user_prompt)
        logger.info(f"AI token usage ({provider} /analyze): {usage}")
        data = extract_json_zai(raw_text)
    except YandexGPTError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status, detail=exc.message) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Invalid JSON from YandexGPT") from exc
    try:
        normalized = _normalize_analyze_data(data)
        return AnalyzeResponse(**normalized)
    except (ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Invalid analysis schema from YandexGPT") from exc


def _check_subscription_limits(user: User, db: Session, resource_type: str, session_id: int = None):
    if user.is_admin:
        return

    tier = "free"
    if user.subscription_tier in ("pro", "premium"):
        if not user.subscription_expires_at or user.subscription_expires_at > datetime.utcnow():
            tier = user.subscription_tier

    if tier == "premium":
        return
        
    if resource_type == "project":
        analyses_count = db.query(Analysis).filter(Analysis.user_id == user.id).count()
        chat_sessions_count = db.query(ChatSession).filter(ChatSession.user_id == user.id, ChatSession.analysis_id == None).count()
        total_projects = analyses_count + chat_sessions_count
        
        if tier == "free" and total_projects >= 1:
            raise HTTPException(status_code=403, detail="Free tier limit: maximum 1 project. Please upgrade your subscription.")
        elif tier == "pro" and total_projects >= 5:
            raise HTTPException(status_code=403, detail="Pro tier limit: maximum 5 projects. Please upgrade your subscription.")
            
    elif resource_type == "message":
        if tier == "free" and session_id:
            msg_count = db.query(DbChatMessage).filter(
                DbChatMessage.session_id == session_id,
                DbChatMessage.role == "user"
            ).count()
            if msg_count >= 10:
                raise HTTPException(status_code=403, detail="Free tier limit: maximum 10 messages per chat session. Please upgrade your subscription.")


@app.post("/analysis", response_model=AnalysisResponse)
async def create_analysis(
    payload: AnalysisCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalysisResponse:
    _check_subscription_limits(user, db, "project")

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
        provider = os.getenv("PRIMARY_PROVIDER", "routerai")
        if provider == "makura":
            raw_text, usage = await call_makura(SYSTEM_PROMPT, user_prompt)
        else:
            raw_text, usage = await call_routerai(SYSTEM_PROMPT, user_prompt)
        logger.info(f"AI token usage ({provider} website analysis): {usage}")
        data = extract_json_zai(raw_text)
    except YandexGPTError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status, detail=exc.message) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Invalid JSON from YandexGPT") from exc
    try:
        normalized = _normalize_analyze_data(data)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Invalid analysis schema from YandexGPT") from exc

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
    db.commit()
    db.refresh(analysis)

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
@app.get("/analysis", response_model=list[AnalysisResponse])
def list_analyses(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AnalysisResponse]:
    analyses = (
        db.query(Analysis)
        .filter(Analysis.user_id == user.id)
        .order_by(Analysis.created_at.desc())
        .all()
    )

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
    """Parses <thought>...</thought> tags and yields JSON chunks."""
    inside_thought = False
    buffer = ""
    async for chunk in generator:
        if not chunk: continue
        buffer += chunk
        
        while True:
            if not inside_thought:
                if "<thought>" in buffer:
                    pre, post = buffer.split("<thought>", 1)
                    if pre:
                        yield json.dumps({"type": "chunk", "content": pre}) + "\n"
                    inside_thought = True
                    buffer = post
                else:
                    if len(buffer) > 10:
                        to_yield = buffer[:-9]
                        buffer = buffer[-9:]
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
                        to_yield = buffer[:-10]
                        buffer = buffer[-10:]
                        yield json.dumps({"type": "thought", "content": to_yield}) + "\n"
                    break
    if buffer:
        yield json.dumps({"type": "thought" if inside_thought else "chunk", "content": buffer}) + "\n"

def save_assistant_message(session_id: int, content: str, client_id: str | None = None):
    """Background task to save streamed assistant message to DB."""
    from db import SessionLocal
    from models import ChatMessage as DbChatMessage
    db = SessionLocal()
    try:
        msg = DbChatMessage(
            session_id=session_id, 
            role="assistant", 
            content=content, 
            client_id=client_id
        )
        db.add(msg)
        db.commit()
        db.refresh(msg) # Confirm persistence
    except Exception as e:
        logger.error(f"Failed to save assistant message: {e}")
    finally:
        db.close()


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
    provider = os.getenv("PRIMARY_PROVIDER", "routerai")

    async def chat_generator():
        full_response = ""
        try:
            raw_gen = stream_makura(SYSTEM_CHAT_PROMPT, user_prompt) if provider == "makura" else stream_routerai(SYSTEM_CHAT_PROMPT, user_prompt)
            async for json_chunk in parse_thought_generator(raw_gen):
                # Extra clean for saving later
                data = json.loads(json_chunk.strip())
                if data["type"] == "chunk":
                    full_response += data["content"]
                yield json_chunk
        except Exception as e:
            logger.error(f"Streaming failed: {e}")
            yield json.dumps({"type": "error", "content": str(e)}) + "\n"
        finally:
            # We don't have a session_id here for anonymous /chat, 
            # but if this endpoint is ever used with a session, we should save it.
            # Currently /chat is used for the very first message before session exists.
            # So we might not need to save here if the session is created later.
            # However, for consistency with other endpoints:
            pass

    return StreamingResponse(chat_generator(), media_type="text/event-stream")


@app.patch("/chat/sessions/{session_id}", response_model=ChatSessionResponse)
def rename_chat_session(
    session_id: int,
    payload: ChatSessionCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionResponse:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    session.title = payload.title
    db.commit()
    db.refresh(session)
    return ChatSessionResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
    )


@app.delete("/chat/sessions/{session_id}")
def delete_chat_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    db.query(DbChatMessage).filter(DbChatMessage.session_id == session.id).delete()
    db.delete(session)
    db.commit()
    return {"status": "ok"}


@app.get("/chat/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
def list_chat_messages(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessageResponse]:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    messages = (
        db.query(DbChatMessage)
        .filter(DbChatMessage.session_id == session.id)
        .order_by(DbChatMessage.created_at.asc())
        .all()
    )
    return [
        ChatMessageResponse(
            id=m.id, role=m.role, content=m.content, created_at=m.created_at, client_id=m.client_id
        )
        for m in messages
    ]


@app.post("/chat/messages")
async def create_chat_message(
    payload: ChatMessageCreateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == payload.session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    user_message = DbChatMessage(
        session_id=session.id, role="user", content=payload.content, client_id=payload.client_id
    )
    db.add(user_message)
    db.commit()
    db.refresh(user_message)

    history = (
        db.query(DbChatMessage)
        .filter(DbChatMessage.session_id == session.id)
        .order_by(DbChatMessage.created_at.asc())
        .all()
    )
    chat_messages = [ChatMessage(role=m.role, content=m.content) for m in history]

    context_chunks = [] # Initialize context_chunks
    try:
        # Parallel RAG
        ch_task = asyncio.to_thread(rag.get_relevant_chunks, payload.content, top_k=3)
        si_task = analyze_search_intent_zai(payload.content)
        context_chunks, search_decision = await asyncio.gather(ch_task, si_task)
        
        if search_decision.get("needs_search") and search_decision.get("search_query"):
            query = search_decision.get("search_query")
            logger.info(f"Agent triggered web search for query: {query}")
            web_context = await asyncio.to_thread(execute_search_agent, query)
            if web_context:
                context_chunks.insert(0, f"--- АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ИНТЕРНЕТА (ПОИСК: {query}) ---\n{web_context}\n--- КОНЕЦ ДАННЫХ ИЗ ИНТЕРНЕТА ---")
    except Exception as e:
        logger.error(f"Failed RAG in session message: {e}")
    # -----------------------------------

    user_prompt = _build_chat_prompt(chat_messages, context_chunks)
    provider = os.getenv("PRIMARY_PROVIDER", "routerai")

    async def session_chat_generator():
        full_text = ""
        try:
            if provider == "makura":
                raw_gen = stream_makura(SYSTEM_CHAT_PROMPT, user_prompt)
            else:
                raw_gen = stream_routerai(SYSTEM_CHAT_PROMPT, user_prompt)
                
            async for json_chunk in parse_thought_generator(raw_gen):
                data = json.loads(json_chunk.strip())
                if data["type"] == "chunk":
                    full_text += data["content"]
                yield json_chunk
        except Exception as e:
            logger.error(f"Streaming failed: {e}")
            yield json.dumps({"type": "error", "content": str(e)}) + "\n"
        finally:
            if full_text.strip() and background_tasks:
                logger.info(f"Stream finished. Collected {len(full_text)} chars.")
                background_tasks.add_task(save_assistant_message, session.id, full_text.strip(), payload.assistant_client_id)

    return StreamingResponse(session_chat_generator(), media_type="text/event-stream")


@app.get("/chat/messages/search")
def search_chat_messages(
    query: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    if not query.strip():
        return []
    messages = (
        db.query(DbChatMessage, ChatSession)
        .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
        .filter(ChatSession.user_id == user.id)
        .filter(DbChatMessage.content.ilike(f"%{query}%"))
        .order_by(DbChatMessage.created_at.desc())
        .limit(50)
        .all()
    )
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


@app.get("/admin/users", response_model=list[UserResponse])
def admin_users(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[UserResponse]:
    users = db.query(User).order_by(User.created_at.desc()).all()
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
def admin_block_user(
    user_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
    return {"status": "ok"}


@app.post("/admin/users/{user_id}/unblock")
def admin_unblock_user(
    user_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = True
    db.commit()
    return {"status": "ok"}


@app.post("/admin/users/{user_id}/make-admin")
def admin_make_admin(
    user_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_admin = True
    db.commit()
    return {"status": "ok"}


@app.delete("/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    sessions = db.query(ChatSession).filter(ChatSession.user_id == user.id).all()
    for session in sessions:
        db.query(DbChatMessage).filter(DbChatMessage.session_id == session.id).delete()
    db.query(ChatSession).filter(ChatSession.user_id == user.id).delete()
    db.query(Analysis).filter(Analysis.user_id == user.id).delete()
    db.delete(user)
    db.commit()
    return {"status": "ok"}


@app.get("/admin/analytics")
def admin_analytics(
    start: date | None = None,
    end: date | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    def _count_absolute(model):
        return db.query(model).count()

    total_users = _count_absolute(User)
    total_analyses = _count_absolute(Analysis)
    total_analyses_anonymous = db.query(Analysis).filter(Analysis.user_id == None).count()
    total_sessions = _count_absolute(ChatSession)
    total_sessions_anonymous = db.query(ChatSession).filter(ChatSession.user_id == None).count()
    total_messages = _count_absolute(DbChatMessage)
    total_errors = _count_absolute(ErrorLog)
    total_subscriptions = db.query(User).filter(User.subscription_tier != "free").count()

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

    users_q = db.query(User.created_at, User.subscription_tier).filter(User.created_at.between(start_dt, end_dt)).all()
    for (dt, tier) in users_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["users"] += 1
            if tier != "free":
                series_dict[k]["subscriptions"] += 1

    analyses_q = db.query(Analysis.created_at).filter(Analysis.created_at.between(start_dt, end_dt)).all()
    for (dt,) in analyses_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["analyses"] += 1

    sessions_q = db.query(ChatSession.created_at).filter(ChatSession.created_at.between(start_dt, end_dt)).all()
    for (dt,) in sessions_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["chat_sessions"] += 1

    messages_q = db.query(DbChatMessage.created_at).filter(DbChatMessage.created_at.between(start_dt, end_dt)).all()
    for (dt,) in messages_q:
        k = _format_key(dt)
        if k in series_dict:
            series_dict[k]["chat_messages"] += 1

    errors_q = db.query(ErrorLog.created_at).filter(ErrorLog.created_at.between(start_dt, end_dt)).all()
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
def admin_top_users(
    start: date | None = None,
    end: date | None = None,
    limit: int = 10,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict]:
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    analyses = (
        db.query(Analysis.user_id, Analysis.id)
        .filter(Analysis.created_at.between(start_dt, end_dt))
        .all()
    )
    messages = (
        db.query(ChatSession.user_id, DbChatMessage.id)
        .join(ChatSession, ChatSession.id == DbChatMessage.session_id)
        .filter(DbChatMessage.created_at.between(start_dt, end_dt))
        .all()
    )
    analysis_counts: dict[int, int] = {}
    message_counts: dict[int, int] = {}
    for user_id, _ in analyses:
        analysis_counts[user_id] = analysis_counts.get(user_id, 0) + 1
    for user_id, _ in messages:
        message_counts[user_id] = message_counts.get(user_id, 0) + 1

    user_ids = set(analysis_counts.keys()) | set(message_counts.keys())
    users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
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
def admin_errors(
    start: date | None = None,
    end: date | None = None,
    limit: int = 50,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    errors = (
        db.query(ErrorLog)
        .filter(ErrorLog.created_at.between(start_dt, end_dt))
        .order_by(ErrorLog.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
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
def admin_errors_export(
    start: date | None = None,
    end: date | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    today = datetime.utcnow().date()
    start_date = start or (today - timedelta(days=6))
    end_date = end or today
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    errors = (
        db.query(ErrorLog)
        .filter(ErrorLog.created_at.between(start_dt, end_dt))
        .order_by(ErrorLog.created_at.desc())
        .all()
    )

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
def get_promocodes(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[PromoCodeResponse]:
    promos = db.query(PromoCode).order_by(PromoCode.created_at.desc()).all()
    return promos


@app.post("/admin/promocodes", response_model=PromoCodeResponse)
def create_promocode(
    payload: PromoCodeCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PromoCodeResponse:
    exists = db.query(PromoCode).filter(PromoCode.code == payload.code.upper()).first()
    if exists:
        raise HTTPException(status_code=400, detail="Promo code already exists")
        
    promo = PromoCode(
        code=payload.code.upper(),
        discount_percent=payload.discount_percent,
        max_uses=payload.max_uses,
        expires_at=payload.expires_at,
    )
    db.add(promo)
    db.commit()
    db.refresh(promo)
    return promo


@app.delete("/admin/promocodes/{promo_id}")
def delete_promocode(
    promo_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    promo = db.query(PromoCode).filter(PromoCode.id == promo_id).first()
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
        
    db.delete(promo)
    db.commit()
    return {"status": "ok"}


@app.get("/admin/subscriptions", response_model=list[SubscriptionResponse])
def admin_subscriptions(
    tier: str | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List all users with active or expired subscriptions."""
    query = db.query(User).filter(User.subscription_tier != "free")
    if tier and tier != "all":
        query = query.filter(User.subscription_tier == tier)

    users = query.order_by(User.subscription_expires_at.desc().nullslast()).all()
    result = []
    for u in users:
        # Get the latest succeeded payment
        last_payment = (
            db.query(Payment)
            .filter(Payment.user_id == u.id, Payment.status == "succeeded")
            .order_by(Payment.created_at.desc())
            .first()
        )
        # Count total payments and total amount spent
        totals = (
            db.query(
                sa_func.count(Payment.id).label("count"),
                sa_func.coalesce(sa_func.sum(Payment.amount), 0).label("total"),
            )
            .filter(Payment.user_id == u.id, Payment.status == "succeeded")
            .first()
        )

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
def admin_add_rag_url(
    req: AdminRAGRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Scrapes a URL, saves the text, and injects it into the active RAG collection.
    """
    try:
        from urllib.parse import urlparse
        parsed = urlparse(req.url)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail="Invalid URL format")
            
        filepath, text = scrape_and_save(req.url)
        if not text or not filepath:
            raise HTTPException(status_code=400, detail="Could not extract text from the URL")
            
        chunks_added = rag.add_text_to_rag(text)
        
        log_entry = RagLog(source_url=req.url, source_type="URL", status="SUCCESS", chunks_added=chunks_added)
        db.add(log_entry)
        db.commit()
        
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
            db.commit()
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to process URL: {e}")

@app.post("/admin/rag/add-pdf", response_model=AdminRAGResponse)
async def admin_add_rag_pdf(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
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
        
        DOCS_DIR = Path(os.getenv("ADMIN_DOCS_DIR", "admin_docs"))
        DOCS_DIR.mkdir(exist_ok=True)
        
        # Save uploaded file
        safe_name = file.filename.replace(" ", "_").replace("/", "")
        ts = int(time.time())
        filepath = DOCS_DIR / f"{ts}_{safe_name}"
        
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Parse text
        text = extract_text_from_pdf(filepath)
        if not text:
            raise HTTPException(status_code=400, detail="Could not extract text from the PDF. It might be scanned or empty.")
            
        # Create corresponding .txt file for persistence next time server boots
        txt_filepath = DOCS_DIR / f"{ts}_{safe_name}.txt"
        with open(txt_filepath, "w", encoding="utf-8") as f:
            f.write(f"Source: Uploaded PDF {file.filename}\n\n")
            f.write(text)
            
        chunks_added = rag.add_text_to_rag(text)
        
        log_entry = RagLog(source_url=file.filename, source_type="PDF", status="SUCCESS", chunks_added=chunks_added)
        db.add(log_entry)
        db.commit()
        
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
            db.commit()
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {e}")

class RagLogListResponse(BaseModel):
    items: list[RagLogResponse]
    total: int

@app.get("/admin/rag/logs", response_model=RagLogListResponse)
def admin_rag_logs(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Returns the latest 100 RAG ingestion logs and the total count.
    """
    total = db.query(RagLog).count()
    logs = db.query(RagLog).order_by(RagLog.created_at.desc()).limit(100).all()
    return RagLogListResponse(items=logs, total=total)

@app.post("/admin/rag/crawl", response_model=AdminRAGResponse)
def admin_rag_crawl(
    req: AdminRAGCrawlRequest,
    background_tasks: BackgroundTasks,
    _: User = Depends(require_admin),
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

@app.get("/admin/payments", response_model=list[PaymentResponse])
def admin_payments(
    status: str | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Full list of all payments."""
    query = db.query(Payment).order_by(Payment.created_at.desc())
    if status:
        query = query.filter(Payment.status == status)
    payments = query.limit(200).all()
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
def create_chat_session(
    payload: ChatSessionCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionDetailResponse:
    _check_subscription_limits(user, db, "project")

    session = ChatSession(
        user_id=user.id,
        title=payload.title,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

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
        db.commit()
        db.refresh(user_msg)  # Get ID
        messages_response.append(
            ChatMessageResponse(
                id=user_msg.id,
                role=user_msg.role,
                content=user_msg.content,
                created_at=user_msg.created_at,
                client_id=user_msg.client_id
            )
        )

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
    db.commit()
    db.refresh(ai_msg)
    messages_response.append(
        ChatMessageResponse(
            id=ai_msg.id,
            role=ai_msg.role,
            content=ai_msg.content,
            created_at=ai_msg.created_at,
            client_id=ai_msg.client_id
        )
    )

    return ChatSessionDetailResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        analysis_id=session.analysis_id,
        messages=messages_response,
    )

async def rename_chat_session_background(session_id: int, initial_message: str):
    try:
        title = await generate_chat_title(initial_message)
        logger.info(f"Generated title '{title}' for session {session_id}")
        
        with SessionLocal() as db:
            session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if session:
                session.title = title
                db.commit()
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
def create_chat_session_from_intent(
    payload: ChatSessionFromIntentRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionDetailResponse:
    _check_subscription_limits(user, db, "project")
    
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
    except:
        initial_message = raw_data
        client_id = None

    session = ChatSession(
        user_id=user.id,
        title="Новый диалог",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

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
        db.commit()
        db.refresh(user_msg)
        messages_response.append(
            ChatMessageResponse(
                id=user_msg.id,
                role=user_msg.role,
                content=user_msg.content,
                created_at=user_msg.created_at,
                client_id=user_msg.client_id
            )
        )

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
    db.commit()
    db.refresh(ai_msg)
    messages_response.append(
        ChatMessageResponse(
            id=ai_msg.id,
            role=ai_msg.role,
            content=ai_msg.content,
            created_at=ai_msg.created_at,
            client_id=ai_msg.client_id
        )
    )

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
def create_chat_session_auto(
    payload: ChatSessionAutoRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionDetailResponse:
    _check_subscription_limits(user, db, "project")
    
    session = ChatSession(
        user_id=user.id,
        title="Новый диалог",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    messages_response = []
    
    # Save user message
    user_msg = DbChatMessage(
        session_id=session.id,
        role="user",
        content=payload.initial_message,
        client_id=payload.client_id
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)
    messages_response.append(
        ChatMessageResponse(
            id=user_msg.id,
            role=user_msg.role,
            content=user_msg.content,
            created_at=user_msg.created_at,
            client_id=user_msg.client_id
        )
    )

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
def list_chat_sessions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatSessionResponse]:
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user.id)
        .order_by(ChatSession.created_at.desc())
        .all()
    )
    return sessions


@app.get("/chat/sessions/{session_id}", response_model=ChatSessionDetailResponse)
def get_chat_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionDetailResponse:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.refresh(session)

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
            ChatMessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=m.created_at,
                client_id=m.client_id
            ) for m in msgs
        ],
    )


@app.delete("/chat/sessions/{session_id}")
def delete_chat_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    db.delete(session)
    db.commit()
    return {"status": "ok", "deleted_id": session_id}
class FeedbackRequest(BaseModel):
    feedback: int

@app.post("/chat/sessions/{session_id}/messages/{message_id}/feedback")
def set_chat_message_feedback(
    session_id: int,
    message_id: int,
    payload: FeedbackRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = (
        db.query(DbChatMessage)
        .join(ChatSession)
        .filter(
            DbChatMessage.id == message_id,
            DbChatMessage.session_id == session_id,
            ChatSession.user_id == user.id
        )
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    msg.feedback = payload.feedback
    db.commit()

    if payload.feedback == 1 and msg.role == "assistant":
        user_msg = (
            db.query(DbChatMessage)
            .filter(
                DbChatMessage.session_id == session_id,
                DbChatMessage.role == "user",
                DbChatMessage.created_at < msg.created_at
            )
            .order_by(DbChatMessage.created_at.desc())
            .first()
        )
        if user_msg:
            from rag import index_successful_chat_interaction
            background_tasks.add_task(index_successful_chat_interaction, user_msg.content, msg.content, message_id)

    return {"status": "ok", "feedback": msg.feedback}

@app.post("/chat/sessions/{session_id}/messages")
async def send_chat_message(
    session_id: int,
    payload: ChatMessageCreateRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    _check_subscription_limits(user, db, "message", session.id)

    # 1. Save User Message
    user_msg = DbChatMessage(
        session_id=session.id,
        role="user",
        content=payload.content,
        client_id=payload.client_id
    )
    db.add(user_msg)
    db.commit()
    db.refresh(session)

    if len(session.messages) == 1:
        background_tasks.add_task(rename_chat_session_background, session.id, payload.content)

    # 2. Generator with Thoughts
    async def session_chat_generator():
        provider = os.getenv("PRIMARY_PROVIDER", "routerai")
        full_response = ""
        try:
            # We need history for contextual responses
            history = (
                db.query(DbChatMessage)
                .filter(DbChatMessage.session_id == session.id)
                .order_by(DbChatMessage.created_at.asc())
                .all()
            )
            chat_history = [ChatMessage(role=m.role, content=m.content) for m in history]
            
            # Identify RAG contexts in parallel
            try:
                cats = await classify_intent(payload.content)
                context_chunks = await asyncio.to_thread(rag.get_relevant_chunks, payload.content, collections=cats, top_k=5)
            except:
                context_chunks = []

            user_prompt = _build_chat_prompt(chat_history, context_chunks)
            
            raw_gen = stream_makura(SYSTEM_CHAT_PROMPT, user_prompt) if provider == "makura" else stream_routerai(SYSTEM_CHAT_PROMPT, user_prompt)
            
            async for json_chunk in parse_thought_generator(raw_gen):
                data = json.loads(json_chunk.strip())
                if data["type"] == "chunk":
                    full_response += data["content"]
                yield json_chunk
            
            # Save assistant response in background
            if full_response:
                background_tasks.add_task(save_assistant_message, session.id, full_response, payload.assistant_client_id)
        except Exception as e:
            logger.error(f"Session streaming failed: {e}")
            yield json.dumps({"type": "error", "content": str(e)}) + "\n"

    return StreamingResponse(session_chat_generator(), media_type="text/event-stream")

async def classify_intent(user_message: str) -> list[str]:
    """Router LLM: Determines which RAG collections to search based on the user's intent."""
    system_prompt = (
        "Ты — умный роутер. Определи от 1 до 2 самых подходящих категорий для вопроса пользователя.\n"
        "Выбирай СТРОГО из списка: pitching, grants_and_funds, unit_economics, target_audience, legal_and_taxes, product_management, platform_rules, general.\n"
        "Отвечей ТОЛЬКО названиями категорий через запятую, без лишних слов."
    )
    try:
        # Use YandexGPT Lite for speed
        folder_id = os.getenv("YC_FOLDER_ID")
        lite_model_uri = f"gpt://{folder_id}/yandexgpt-lite/latest" if folder_id else None
        
        raw_response, _ = await async_call_yandex_gpt(system_prompt, user_message, model_uri=lite_model_uri, timeout=10)
        
        if not raw_response:
            logger.error("Router LLM failed: No response")
            return ["general"]

        valid_cats = {"pitching", "grants_and_funds", "unit_economics", "target_audience", "legal_and_taxes", "product_management", "platform_rules", "general"}
        found = [c.strip() for c in raw_response.split(",")]
        result = [c for c in found if c in valid_cats]
        return result if result else ["general"]
    except Exception as e:
        logger.error(f"Router LLM failed: {e}")
        return ["general"]

async def _generate_interviewer_response(session: ChatSession, db: Session) -> str:
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
            history_rag_task = asyncio.to_thread(rag.search_successful_chats, last_user_text, top_k=1)
            search_intent_task = analyze_search_intent_zai(last_user_text)
            
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
            
            context_text = "\n".join(chunks)
        except Exception as e:
            logger.error(f"Parallel RAG failed: {e}")
            pass
            
            context_text = "\n".join(chunks)
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
            provider = os.getenv("PRIMARY_PROVIDER", "routerai")
            if provider == "makura":
                raw_response, usage = await call_makura(system_prompt_final, final_user_prompt)
            else:
                raw_response, usage = await call_routerai(system_prompt_final, final_user_prompt)
            if usage:
                logger.info(f"AI token usage ({provider} background summary): {usage}")
        except Exception as e:
            logger.error(f"Interviewer provider call failed: {e}")
            raw_response, usage = None, None

        if not raw_response:
            logger.error("Interviewer (RouterAI) failed: No response")
            return "Извините, я задумался. Можете повторить?"

        # Check if JSON
        clean_text = raw_response.strip()
        if topic == "Анализ идеи" and "{" in clean_text and "}" in clean_text:
            # Try parse
            try:
                data = extract_json(clean_text)
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
                    db.commit()
                    db.refresh(analysis)

                    # Link to Session
                    session.analysis_id = analysis.id
                    db.commit()
                    db.refresh(session)

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
