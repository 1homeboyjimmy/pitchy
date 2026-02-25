from contextlib import asynccontextmanager
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
from redis_client import get_redis
from yandex_gpt_client import YandexGPTError, call_yandex_gpt, extract_json
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
    SubscriptionResponse,
)
from email_utils import get_dev_emails, send_email
from sso import yandex_sso, github_sso
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
    "текстом, без JSON и без форматирования. Учитывай российский рынок: регуляторику, "
    "конкуренцию, поведение потребителей, каналы продвижения и требования инвесторов "
    "(РВК, бизнес-ангелы). Используй только достоверные данные из контекста."
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Start RAG initialization in background thread so server starts immediately
    # (model loading + migration can take minutes on first run after model switch)
    import threading
    def _init_rag_bg():
        try:
            rag.init_rag()
            logger.info("RAG initialized successfully in background.")
        except Exception as e:
            logger.exception(f"RAG background init failed: {e}")
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
    status = "ok" if db_ok and rag_ok and redis_ok is not False else "degraded"
    return {
        "status": status,
        "db": db_ok,
        "redis": redis_ok,
        "rag": rag_ok,
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
    )


@app.patch("/me", response_model=UserResponse)
def update_me(
    payload: UserUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    if payload.name:
        user.name = payload.name

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
def analyze_startup(payload: AnalyzeRequest) -> AnalyzeResponse:
    try:
        context_chunks = rag.get_relevant_chunks(payload.description, top_k=3)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_prompt = _build_user_prompt(payload.description, context_chunks)

    try:
        raw_text, usage = call_yandex_gpt(SYSTEM_PROMPT, user_prompt)
        logger.info(f"YandexGPT token usage (anonymous /analyze): {usage}")
        data = extract_json(raw_text)
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
def create_analysis(
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
        raw_text, usage = call_yandex_gpt(SYSTEM_PROMPT, user_prompt)
        logger.info(f"YandexGPT token usage (user {user.id} /analyze): {usage}")
        data = extract_json(raw_text)
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


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages is required")

    last_user = next((m.content for m in reversed(payload.messages) if m.role == "user"), "")
    if not last_user:
        raise HTTPException(status_code=400, detail="last user message is required")

    try:
        context_chunks = rag.get_relevant_chunks(last_user, top_k=3)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_prompt = _build_chat_prompt(payload.messages, context_chunks)

    try:
        raw_text, usage = call_yandex_gpt(SYSTEM_CHAT_PROMPT, user_prompt)
        logger.info(f"YandexGPT token usage (anonymous /chat): {usage}")
    except YandexGPTError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status, detail=exc.message) from exc

    return ChatResponse(reply=raw_text.strip())


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
            id=m.id, role=m.role, content=m.content, created_at=m.created_at
        )
        for m in messages
    ]


@app.post("/chat/messages", response_model=ChatMessageResponse)
def create_chat_message(
    payload: ChatMessageCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMessageResponse:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == payload.session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    user_message = DbChatMessage(
        session_id=session.id, role="user", content=payload.content
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

    try:
        context_chunks = rag.get_relevant_chunks(payload.content, top_k=3)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    user_prompt = _build_chat_prompt(chat_messages, context_chunks)

    try:
        raw_text, usage = call_yandex_gpt(SYSTEM_CHAT_PROMPT, user_prompt)
        logger.info(f"YandexGPT token usage (session {session.id} /chat/messages): {usage}")
    except YandexGPTError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status, detail=exc.message) from exc

    assistant_message = DbChatMessage(
        session_id=session.id, role="assistant", content=raw_text.strip()
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    return ChatMessageResponse(
        id=assistant_message.id,
        role=assistant_message.role,
        content=assistant_message.content,
        created_at=assistant_message.created_at,
    )


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

    def _count(model, created_field):
        return db.query(model).filter(created_field.between(start_dt, end_dt)).count()

    total_users = _count(User, User.created_at)
    total_analyses = _count(Analysis, Analysis.created_at)
    total_analyses_anonymous = db.query(Analysis).filter(Analysis.created_at.between(start_dt, end_dt), Analysis.user_id == None).count()
    total_sessions = _count(ChatSession, ChatSession.created_at)
    total_sessions_anonymous = db.query(ChatSession).filter(ChatSession.created_at.between(start_dt, end_dt), ChatSession.user_id == None).count()
    total_messages = _count(DbChatMessage, DbChatMessage.created_at)
    total_errors = _count(ErrorLog, ErrorLog.created_at)

    series = []
    current = start_date
    while current <= end_date:
        day_start = datetime.combine(current, datetime.min.time())
        day_end = datetime.combine(current, datetime.max.time())
        series.append(
            {
                "date": current.isoformat(),
                "users": db.query(User)
                .filter(User.created_at.between(day_start, day_end))
                .count(),
                "analyses": db.query(Analysis)
                .filter(Analysis.created_at.between(day_start, day_end))
                .count(),
                "chat_sessions": db.query(ChatSession)
                .filter(ChatSession.created_at.between(day_start, day_end))
                .count(),
                "chat_messages": db.query(DbChatMessage)
                .filter(DbChatMessage.created_at.between(day_start, day_end))
                .count(),
                "errors": db.query(ErrorLog)
                .filter(ErrorLog.created_at.between(day_start, day_end))
                .count(),
            }
        )
        current += timedelta(days=1)

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
        
        DOCS_DIR = Path("sample_docs")
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

@app.get("/admin/rag/logs", response_model=list[RagLogResponse])
def admin_rag_logs(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """
    Returns the latest 100 RAG ingestion logs.
    """
    logs = db.query(RagLog).order_by(RagLog.created_at.desc()).limit(100).all()
    return logs

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

ПРАВИЛА ДИАЛОГА:
1. Проанализируй текущую историю диалога.
2. Задавай ТОЛЬКО самые критически важные вопросы (рынок, проблема, решение, бизнес-модель, конкуренты, команда). 
3. Задавай строго по ОДНОМУ вопросу за раз. 
4. ЗАПРЕЩЕНО задавать более 7 вопросов суммарно за весь диалог. Береги время основателя.
5. Как только ты собрал базовый минимум информации ИЛИ задал 7 вопросов, ПРЕКРАЩАЙ задавать вопросы и переходи к выводу результата.

ПРИМЕР ХОРОШЕГО ВОПРОСА:
Основатель: "Мы делаем платформу для аналитики стартапов с помощью ИИ"
Аналитик: "Какую конкретную проблему решает ваш продукт и кто ваш основной клиент — инвесторы, акселераторы или сами основатели стартапов?"

ФИНАЛЬНЫЙ РЕЗУЛЬТАТ (JSON):
Если ты решил, что информации достаточно (или лимит вопросов исчерпан), твой ответ ДОЛЖЕН быть только валидным JSON объектом и ничем больше! Не добавляй markdown разметку вокруг JSON.

Формат JSON анализа:
{
  "investment_score": 0-100,
  "strengths": ["сильная сторона 1", ...],
  "weaknesses": ["слабая сторона 1", ...],
  "recommendations": ["рекомендация 1", ...],
  "market_summary": "Текстовое резюме стартапа..."
}
"""


SYSTEM_TA_PROMPT = """
Ты — эксперт по маркетингу и целевой аудитории (ЦА) для стартапов на рынке СНГ и Global.
Твоя задача — помочь основателю лучше понять и сегментировать свою ЦА.

ПРАВИЛА ДИАЛОГА:
1. Задавай ТОЛЬКО самые важные, ключевые вопросы, чтобы понять суть проекта.
2. Задавай не более 1 вопроса за раз.
3. Суммарно задай НЕ БОЛЕЕ 5 вопросов за весь диалог. Не утомляй пользователя бесконечными уточнениями.
4. Когда ты соберешь достаточно базовой информации (или после 3-5 ответов), ПРЕКРАТИ задавать вопросы и выдай финальное резюме.
5. Отвечай только обычным текстом (можно использовать markdown), без JSON.

ПРИМЕР ФИНАЛЬНОГО РЕЗЮМЕ:
---
## Анализ ЦА: [Название продукта]

### Основные сегменты
1. **Начинающие стартаперы (25-35 лет)** — нуждаются в валидации идеи, бюджет ограничен. Канал: Telegram, VC.ru
2. **Бизнес-ангелы** — ищут быстрый скрининг проектов. Канал: LinkedIn, отраслевые мероприятия

### Рекомендации по продвижению
- Начните с сегмента 1 (больше объём, проще достучаться)
- Используйте контент-маркетинг на VC.ru и Habr
- Предложите бесплатный тариф для привлечения первых пользователей
---
"""

SYSTEM_ECONOMICS_PROMPT = """
Ты — финансовый директор и эксперт по юнит-экономике для стартапов.
Твоя задача — помочь основателю рассчитать или оптимизировать метрики: CAC, LTV, ARPU, Retention, CPA.

ПРАВИЛА ДИАЛОГА:
1. Задавай ТОЛЬКО самые важные вопросы для понимания бизнес-модели.
2. Задавай не более 1 вопроса за раз.
3. Суммарно задай НЕ БОЛЕЕ 5 вопросов за весь диалог. Уважай время пользователя.
4. Когда ты соберешь достаточно данных (или после 3-5 ответов), ПРЕКРАТИ задавать вопросы и выдай финальное резюме.
5. Отвечай только обычным текстом (можно использовать markdown), без JSON.

ПРИМЕР ФИНАЛЬНОГО РЕЗЮМЕ:
---
## Юнит-экономика: [Название продукта]

| Метрика | Значение | Комментарий |
|---------|----------|-------------|
| ARPU    | 500 ₽/мес | Средний чек |
| CAC     | 1 200 ₽   | Стоимость привлечения |
| LTV     | 6 000 ₽   | При Retention 6 мес |
| LTV/CAC | 5x        | ✅ Хороший показатель |

### Рекомендации
- Снизить CAC через реферальную программу
- Повысить ARPU через доп. услуги
---
"""

SYSTEM_GENERAL_PROMPT = """
Ты — многопрофильный бизнес-ассистент для стартапов. 
Помогай основателю с любыми вопросами по бизнесу, стратегии, HR, разработке или фандрайзингу.

ПРАВИЛА ДИАЛОГА:
1. Если требуется уточнение, задавай только самые важные вопросы (не более 1 за раз).
2. Суммарно задавай НЕ БОЛЕЕ 3 вопросов по одной теме.
3. Быстро переходи к сути: выдавай конкретные советы, подробные пошаговые планы действий или решения проблемы в виде финального резюме, не затягивая диалог постоянными расспросами.
4. Отвечай только обычным текстом (можно использовать markdown), без JSON.

ПРИМЕР ХОРОШЕГО ОТВЕТА:
Основатель: "Как привлечь первых пользователей?"
Ассистент:
## План привлечения первых 100 пользователей
1. **Product Hunt Launch** — подготовьте лендинг и запустите в понедельник утром (PST)
2. **Telegram-каналы** — разместите пост в 3-5 тематических каналах
3. **Персональный outreach** — напишите 50 потенциальным пользователям в LinkedIn
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
            content=assistant_text,
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
            )
        )

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
                created_at=m.created_at
            ) for m in msgs
        ],
    )


@app.post("/chat/sessions/{session_id}/messages", response_model=ChatMessageResponse)
def send_chat_message(
    session_id: int,
    payload: ChatMessageCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMessageResponse:
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
    )
    db.add(user_msg)
    db.commit()

    # 2. Generate Assistant Response
    assistant_text = _generate_interviewer_response(session, db)

    # 3. Save Assistant Message
    ai_msg = DbChatMessage(
        session_id=session.id,
        role="assistant",
        content=assistant_text,
    )
    db.add(ai_msg)
    db.commit()
    db.refresh(ai_msg)

    return ChatMessageResponse(
        id=ai_msg.id,
        role=ai_msg.role,
        content=ai_msg.content,
        created_at=ai_msg.created_at,
    )


def _generate_interviewer_response(session: ChatSession, db: Session) -> str:
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
            chunks = rag.get_relevant_chunks(last_user_text, top_k=5)
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

        final_user_prompt = f"История диалога:\n{history_text}\n\nТвоя реакция (вопрос или JSON):"

        # Forcefully stop questions if history is too long
        # History messages count: 
        # 0: initial idea, 1: AI greeting, 2: user topic, 3: AI Q1, 4: user A1...
        # 5 QAs = 13 messages. 7 QAs = 17 messages.
        qa_limit = 17 if topic == "Анализ идеи" else 13
        if len(history_msgs) >= qa_limit:
            if topic == "Анализ идеи":
                final_user_prompt += "\n\n[СИСТЕМНОЕ СООБЩЕНИЕ]: ЛИМИТ ВОПРОСОВ КЛИЕНТУ ИСЧЕРПАН. СЕЙЧАС ЖЕ ВЫДАЙ ФИНАЛЬНЫЙ JSON АНАЛИЗ ОТ 0 ДО 100 БЕЗ КАКИХ-ЛИБО ВОПРОСОВ. НИЧЕГО КРОМЕ JSON СТРОКИ НЕ ВЫВОДИ."
            else:
                final_user_prompt += "\n\n[СИСТЕМНОЕ СООБЩЕНИЕ]: ЛИМИТ ВОПРОСОВ КЛИЕНТУ ИСЧЕРПАН. СЕЙЧАС ЖЕ ВЫДАЙ ФИНАЛЬНОЕ ПОДРОБНОЕ РЕЗЮМЕ/СОВЕТЫ ПО ТЕМЕ БЕЗ КАКИХ-ЛИБО ВОПРОСОВ."


        raw_response, usage = call_yandex_gpt(system_prompt_final, final_user_prompt)
        logger.info(f"YandexGPT token usage (background summary): {usage}")

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
