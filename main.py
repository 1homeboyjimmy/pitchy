from contextlib import asynccontextmanager
import os
import logging
import time
from datetime import datetime, timedelta, date

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.responses import StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session
from sqlalchemy import text
from dotenv import load_dotenv
import rag
from metrics import ERROR_COUNT, REQUEST_COUNT, REQUEST_LATENCY
from observability import configure_logging
from redis_client import get_redis
from yandex_gpt_client import YandexGPTError, call_yandex_gpt, extract_json
from db import SessionLocal, get_db
from models import Analysis, ChatMessage as DbChatMessage, ChatSession, ErrorLog, User
from schemas import (
    AnalysisCreateRequest,
    AnalysisResponse,
    ChatMessageCreateRequest,
    ChatMessageResponse,
    ChatSessionCreateRequest,
    ChatSessionResponse,
    EmailVerifyRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
    UserUpdateRequest,
    PasswordChangeRequest,
)
from email_utils import get_dev_emails, send_email
from sso import yandex_sso, github_sso
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
)


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
configure_logging()
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    rag.init_rag()
    yield


app = FastAPI(title="Startup Analyzer", lifespan=lifespan)

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


@app.post("/auth/register", response_model=TokenResponse)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    exists = db.query(User).filter(User.email == payload.email).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")
    verify_token = generate_token()
    verify_hash = hash_token(verify_token)
    verify_expires = datetime.utcnow() + timedelta(hours=24)
    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        email_verify_token_hash=verify_hash,
        email_verify_expires_at=verify_expires,
    )
    db.add(user)
    try:
        db.flush()
        token = create_access_token(user.id)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Registration failed") from exc
    db.refresh(user)
    try:
        base_url = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")
        verify_link = f"{base_url}/account?verify={verify_token}"
        send_email(
            payload.email,
            "Verify your email",
            f"Verify your email using this link: {verify_link}",
        )
    except Exception:
        pass
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
        logger.error(f"SSO Error ({provider}): {str(e)}", extra={
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
    redirect = RedirectResponse(url=f"{frontend_url}/dashboard", status_code=302)
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


@app.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        email_verified=user.email_verified,
        created_at=user.created_at,
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

        verify_token = generate_token()
        verify_hash = hash_token(verify_token)
        verify_expires = datetime.utcnow() + timedelta(hours=24)

        user.email_verify_token_hash = verify_hash
        user.email_verify_expires_at = verify_expires

        try:
            base_url = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")
            verify_link = f"{base_url}/account?verify={verify_token}"
            send_email(
                payload.email,
                "Verify your new email",
                f"Please verify your new email using this link: {verify_link}",
            )
        except Exception:
            logger.error("Failed to send verification email during update")

    db.commit()
    db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        email_verified=user.email_verified,
        created_at=user.created_at,
    )


@app.post("/auth/change-password")
def change_password(
    payload: PasswordChangeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="User has no password set (social login?)")

    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid current password")

    user.password_hash = hash_password(payload.new_password)
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

    verify_token = generate_token()
    verify_hash = hash_token(verify_token)
    verify_expires = datetime.utcnow() + timedelta(hours=24)

    user.email_verify_token_hash = verify_hash
    user.email_verify_expires_at = verify_expires
    db.commit()

    try:
        base_url = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")
        verify_link = f"{base_url}/account?verify={verify_token}"
        send_email(
            user.email,
            "Verify your email",
            f"Verify your email using this link: {verify_link}",
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
        raw_text = call_yandex_gpt(SYSTEM_PROMPT, user_prompt)
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


@app.post("/analysis", response_model=AnalysisResponse)
def create_analysis(
    payload: AnalysisCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalysisResponse:
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
        raw_text = call_yandex_gpt(SYSTEM_PROMPT, user_prompt)
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
        investment_score=analysis.investment_score,
        strengths=analysis.strengths,
        weaknesses=analysis.weaknesses,
        recommendations=analysis.recommendations,
        market_summary=analysis.market_summary,
        created_at=analysis.created_at,
    )


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
    return [
        AnalysisResponse(
            id=item.id,
            investment_score=item.investment_score,
            strengths=item.strengths,
            weaknesses=item.weaknesses,
            recommendations=item.recommendations,
            market_summary=item.market_summary,
            created_at=item.created_at,
        )
        for item in analyses
    ]


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
        raw_text = call_yandex_gpt(SYSTEM_CHAT_PROMPT, user_prompt)
    except YandexGPTError as exc:
        status = exc.status_code or 502
        raise HTTPException(status_code=status, detail=exc.message) from exc

    return ChatResponse(reply=raw_text.strip())


@app.post("/chat/sessions", response_model=ChatSessionResponse)
def create_chat_session(
    payload: ChatSessionCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionResponse:
    session = ChatSession(user_id=user.id, title=payload.title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return ChatSessionResponse(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
    )


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
    return [
        ChatSessionResponse(id=s.id, title=s.title, created_at=s.created_at)
        for s in sessions
    ]


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
        raw_text = call_yandex_gpt(SYSTEM_CHAT_PROMPT, user_prompt)
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
    total_sessions = _count(ChatSession, ChatSession.created_at)
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
            "chat_sessions": total_sessions,
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
