"""Auth router — registration, login, logout, password reset/change, SSO.

Carved out of main.py to shrink the monolith. SSO providers (yandex_sso /
github_sso / google_sso) and rate-limit helpers stay in main.py for now;
this module pulls them via late imports inside endpoint bodies, which
avoids a circular at module load time (main imports this module to call
include_router; this module imports main only when handlers run).

Endpoints moved:
    POST /auth/register
    POST /auth/verify-email          (code-based — replaces legacy token one)
    POST /auth/login
    POST /auth/logout
    GET  /auth/{provider}/login      (SSO redirect)
    GET  /auth/{provider}/callback   (SSO callback)
    POST /auth/change-password/initiate
    POST /auth/change-password/confirm
    POST /auth/resend-verification
    POST /auth/request-password-reset
    POST /auth/reset-password

The legacy POST /auth/verify-email (long-token) stays in main.py; it
conflicts on path with the code-based one and is effectively dead code.
"""

from __future__ import annotations

import logging
import os
import random
import secrets
import urllib.parse
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    create_access_token,
    get_access_token_cookie_name,
    get_legacy_access_token_cookie_name,
    get_access_token_max_age,
    get_async_current_user,
    hash_password,
    hash_token,
    needs_update,
    verify_password,
    verify_token,
)
from db_async import get_async_db
from email_utils import send_email
from models import User
from custdev_sso import (
    ExchangeRequest,
    IntrospectRequest,
    REDIRECT_URI,
    CLIENT_ID,
    consume_code,
    introspect_grant,
    issue_code,
    issue_grant,
    read_code,
    revoke_grant,
    require_custdev_service,
    validate_authorize_request,
    verify_pkce,
)
from schemas.base import (
    EmailCodeVerifyRequest,
    LoginRequest,
    PasswordChangeConfirmRequest,
    PasswordChangeInitRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(tags=["auth"])
logger = logging.getLogger("app.routers.auth")


@router.get("/auth/sso/custdev/authorize")
async def custdev_authorize(
    client_id: str = Query(..., min_length=1, max_length=100),
    redirect_uri: str = Query(..., min_length=1, max_length=2048),
    state: str = Query(..., min_length=16, max_length=512),
    code_challenge: str = Query(..., min_length=43, max_length=128),
    code_challenge_method: str = Query(..., min_length=1, max_length=10),
    user: User = Depends(get_async_current_user),
):
    """Start the browser SSO leg using the main site's own session cookie."""
    validate_authorize_request(
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        method=code_challenge_method,
    )
    code = issue_code(user_id=user.id, code_challenge=code_challenge)
    target = urllib.parse.urlencode({"code": code, "state": state})
    response = RedirectResponse(url=f"{REDIRECT_URI}?{target}", status_code=302)
    if os.getenv("AUTH_COOKIE_HOST_ONLY", "false").strip().lower() in ("1", "true", "yes"):
        _set_session_cookie(response, create_access_token(user.id))
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.post("/internal/auth/custdev/exchange")
async def custdev_exchange(
    payload: ExchangeRequest,
    db: AsyncSession = Depends(get_async_db),
    _service: None = Depends(require_custdev_service),
):
    """Exchange a one-time SSO code for a short-lived CustDev grant."""
    if payload.grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="Unsupported grant type")
    if payload.client_id != CLIENT_ID or payload.redirect_uri != REDIRECT_URI:
        raise HTTPException(status_code=400, detail="Invalid SSO client")
    code_data = read_code(payload.code)
    if not code_data:
        raise HTTPException(status_code=400, detail="Invalid or expired authorization code")
    if (
        code_data.get("client_id") != payload.client_id
        or code_data.get("redirect_uri") != payload.redirect_uri
        or not verify_pkce(payload.code_verifier, str(code_data.get("code_challenge", "")))
    ):
        raise HTTPException(status_code=400, detail="Invalid authorization code proof")
    # Consume only after PKCE and client binding have been validated. The
    # atomic GETDEL means concurrent exchanges can still produce at most one
    # grant.
    if not consume_code(payload.code):
        raise HTTPException(status_code=400, detail="Invalid or expired authorization code")
    try:
        user_id = int(code_data["user_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid authorization code") from exc
    result = await db.execute(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active or (user.locked_until and user.locked_until > datetime.utcnow()):
        raise HTTPException(status_code=401, detail="User is not active")
    grant = issue_grant(user_id=user.id)
    return {
        "active": True,
        "sub": grant.user_id,
        "scope": list(grant.scope),
        "grant_id": grant.grant_id,
        "expires_at": grant.expires_at,
    }


@router.post("/internal/auth/custdev/introspect")
async def custdev_introspect(
    payload: IntrospectRequest,
    db: AsyncSession = Depends(get_async_db),
    _service: None = Depends(require_custdev_service),
):
    """Validate a CustDev grant without exposing the main JWT."""
    grant = introspect_grant(payload.grant_id)
    if not grant:
        return {"active": False}
    try:
        user_id = int(grant["sub"])
    except (KeyError, TypeError, ValueError):
        return {"active": False}
    result = await db.execute(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active or (user.locked_until and user.locked_until > datetime.utcnow()):
        return {"active": False}
    return {
        "active": True,
        "sub": str(user.id),
        "scope": grant.get("scope", []),
        "expires_at": int(grant["expires_at"]),
    }


@router.post("/internal/auth/custdev/revoke")
async def custdev_revoke(
    payload: IntrospectRequest,
    _service: None = Depends(require_custdev_service),
):
    revoke_grant(payload.grant_id)
    return {"active": False}


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


# Перебор 6-значных кодов (сброс пароля / верификация email). Кроме
# IP-rate-limit считаем попытки per-(scope, email): после лимита код
# инвалидируется, чтобы 1 млн вариантов нельзя было перебрать за время
# жизни кода. Redis — основное хранилище счётчика, in-memory — fallback.
CODE_MAX_ATTEMPTS = int(os.getenv("AUTH_CODE_MAX_ATTEMPTS", "5"))
CODE_ATTEMPT_TTL = 900  # 15 минут — не дольше жизни кода


def _bump_code_attempts(scope: str, identity: str) -> int:
    from redis_client import get_redis

    key = f"codetry:{scope}:{(identity or '').lower()}"
    redis_client = get_redis()
    if redis_client:
        try:
            count = int(redis_client.incr(key))
            if count == 1:
                redis_client.expire(key, CODE_ATTEMPT_TTL)
            return count
        except Exception:
            pass
    bucket = getattr(_bump_code_attempts, "_mem", None)
    if bucket is None:
        from cachetools import TTLCache

        bucket = TTLCache(maxsize=10000, ttl=CODE_ATTEMPT_TTL)
        _bump_code_attempts._mem = bucket
    count = int(bucket.get(key, 0)) + 1
    bucket[key] = count
    return count


def _reset_code_attempts(scope: str, identity: str) -> None:
    from redis_client import get_redis

    key = f"codetry:{scope}:{(identity or '').lower()}"
    redis_client = get_redis()
    if redis_client:
        try:
            redis_client.delete(key)
        except Exception:
            pass
    bucket = getattr(_bump_code_attempts, "_mem", None)
    if bucket is not None:
        bucket.pop(key, None)


def _set_session_cookie(response: Response, token: str) -> None:
    host_only = os.getenv("AUTH_COOKIE_HOST_ONLY", "false").strip().lower() in ("1", "true", "yes")
    domain = None if host_only else os.getenv("COOKIE_DOMAIN", ".pitchy.pro")
    response.set_cookie(
        key=get_access_token_cookie_name(),
        value=token,
        httponly=True,
        secure=os.getenv("APP_ENV", "dev").lower() == "prod",
        samesite="lax",
        max_age=get_access_token_max_age(),
        path="/",
        domain=domain,
    )
    if host_only:
        # Remove the old parent-domain cookie after the host-only session has
        # been established. This is a migration, not a forced logout.
        response.delete_cookie(
            key=get_legacy_access_token_cookie_name(),
            path="/",
            domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
        )


# ===================================================================
# Registration / email verification
# ===================================================================

@router.post("/auth/register")
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    # Late imports to dodge circular: main imports us to register the
    # router; we touch main only when a request actually lands here.
    from main import _check_rate_limit, _check_registration_rate_limit, get_client_ip
    import email_templates

    ip = get_client_ip(request)
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

    verify_code = "".join([str(random.randint(0, 9)) for _ in range(6)])
    verify_hash = hash_token(verify_code)

    verify_token_str = secrets.token_urlsafe(32)
    verify_token_hash = hash_token(verify_token_str)

    verify_expires = datetime.utcnow() + timedelta(hours=24)

    consent_ts = datetime.utcnow()
    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        email_verify_token_hash=verify_token_hash,
        email_verify_code_hash=verify_hash,
        email_verify_expires_at=verify_expires,
        email_verified=False,
        is_active=True,
        privacy_consent_at=consent_ts,
        cookies_consent_at=consent_ts,
        cookie_consent=True,
    )
    db.add(user)
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Registration failed") from exc
    await db.refresh(user)

    try:
        subj, body = email_templates.email_verification(payload.name, verify_code)
        await run_in_threadpool(send_email, payload.email, subj, body)
    except Exception:
        logger.error(f"Failed to send verification email to {payload.email}")

    return {"status": "verification_required", "email": payload.email}


@router.post("/auth/verify-email", response_model=TokenResponse)
async def verify_email_code(
    payload: EmailCodeVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> TokenResponse:
    from main import _check_rate_limit, get_client_ip

    ip = get_client_ip(request)
    _check_rate_limit(ip)

    result = await db.execute(
        select(User).where(User.email == payload.email, User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.email_verified:
        if not user.email_verify_code_hash or not user.email_verify_expires_at:
            raise HTTPException(status_code=400, detail="No pending verification")

        if datetime.utcnow() > user.email_verify_expires_at:
            raise HTTPException(status_code=400, detail="Verification code expired")

        if not verify_token(payload.code, user.email_verify_code_hash):
            if _bump_code_attempts("verify", payload.email) > CODE_MAX_ATTEMPTS:
                # Перебор — гасим код, чтобы нельзя было довести до угадывания.
                user.email_verify_token_hash = None
                user.email_verify_code_hash = None
                user.email_verify_expires_at = None
                await db.commit()
                raise HTTPException(status_code=429, detail="Слишком много попыток. Запросите код заново.")
            raise HTTPException(status_code=400, detail="Invalid verification code")

        user.email_verified = True
        user.email_verify_token_hash = None
        user.email_verify_code_hash = None
        user.email_verify_expires_at = None
        await db.commit()
        _reset_code_attempts("verify", payload.email)

    token = create_access_token(user.id)
    _set_session_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/auth/resend-verification")
async def resend_verification(
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    import email_templates

    if user.email_verified:
        return {"status": "ok", "message": "Already verified"}

    verify_code = "".join([str(random.randint(0, 9)) for _ in range(6)])
    verify_hash = hash_token(verify_code)
    verify_expires = datetime.utcnow() + timedelta(hours=24)

    user.email_verify_token_hash = verify_hash
    user.email_verify_expires_at = verify_expires
    await db.commit()

    try:
        subj, body = email_templates.email_verification(user.name, verify_code)
        send_email(user.email, subj, body)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"status": "ok"}


# ===================================================================
# Login / logout
# ===================================================================

@router.post("/auth/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> TokenResponse:
    from main import _check_rate_limit, get_client_ip

    # Caddy is the direct peer in production.  Use its trusted, overwritten
    # X-Real-IP value so the auth limit applies per visitor rather than to the
    # entire site behind the proxy.
    ip = get_client_ip(request)
    _check_rate_limit(ip)

    result = await db.execute(
        select(User).where(User.email == payload.email, User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is blocked")
    if user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=403, detail="User is temporarily locked")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Email is not verified")
    if not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= 5:
            user.locked_until = datetime.utcnow() + timedelta(minutes=15)
            user.failed_login_attempts = 0
        await db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Rehash legacy pbkdf2 hashes on successful login.
    if needs_update(user.password_hash):
        user.password_hash = hash_password(payload.password)

    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()

    token = create_access_token(user.id)
    _set_session_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/auth/logout")
def logout(response: Response) -> dict:
    host_only = os.getenv("AUTH_COOKIE_HOST_ONLY", "false").strip().lower() in ("1", "true", "yes")
    response.delete_cookie(
        key=get_access_token_cookie_name(),
        path="/",
        domain=None if host_only else os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
    )
    if host_only:
        response.delete_cookie(
            key=get_legacy_access_token_cookie_name(),
            path="/",
            domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
        )
    return {"status": "ok"}


# ===================================================================
# Password change / reset
# ===================================================================

@router.post("/auth/change-password/initiate")
async def initiate_change_password(
    payload: PasswordChangeInitRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    import email_templates

    if not user.password_hash:
        raise HTTPException(status_code=400, detail="User has no password set (social login?)")

    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid current password")

    code = "".join([str(random.randint(0, 9)) for _ in range(6)])
    code_hash = hash_token(code)
    expires = datetime.utcnow() + timedelta(minutes=10)

    user.password_reset_token_hash = code_hash
    user.password_reset_expires_at = expires
    await db.commit()

    try:
        subj, body = email_templates.password_change_code(user.name, code)
        send_email(user.email, subj, body)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to send verification code")

    return {"status": "ok", "message": "Verification code sent"}


@router.post("/auth/change-password/confirm")
async def confirm_change_password(
    payload: PasswordChangeConfirmRequest,
    user: User = Depends(get_async_current_user),
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    import email_templates

    if not user.password_reset_token_hash or not user.password_reset_expires_at:
        raise HTTPException(status_code=400, detail="No pending password change request")

    if datetime.utcnow() > user.password_reset_expires_at:
        raise HTTPException(status_code=400, detail="Verification code expired")

    if not verify_token(payload.code, user.password_reset_token_hash):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    user.password_hash = hash_password(payload.new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    await db.commit()

    try:
        subj, body = email_templates.password_changed_notice(user.name)
        send_email(user.email, subj, body)
    except Exception:
        pass

    return {"status": "ok"}


@router.post("/auth/request-password-reset")
async def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    """Always returns 200 OK regardless of whether the email exists — never
    leak which addresses are registered. Code expires in 15 min and is
    stored hashed.
    """
    from main import _check_rate_limit, get_client_ip
    import email_templates

    ip = get_client_ip(request)
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
        subj, body = email_templates.password_reset_code(code)
        send_email(payload.email, subj, body)
    except Exception:
        # SMTP may be unavailable on dev — code is still readable from /dev/emails.
        pass
    return {"status": "ok"}


@router.post("/auth/reset-password")
async def reset_password(
    payload: PasswordResetConfirm,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
) -> dict:
    from main import _check_rate_limit, get_client_ip

    ip = get_client_ip(request)
    _check_rate_limit(ip)

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

    if not secrets.compare_digest(hash_token(payload.code), user.password_reset_token_hash):
        if _bump_code_attempts("reset", payload.email) > CODE_MAX_ATTEMPTS:
            # Перебор — инвалидируем код сброса, заставляем перезапросить.
            user.password_reset_token_hash = None
            user.password_reset_expires_at = None
            await db.commit()
            raise HTTPException(status_code=429, detail="Слишком много попыток. Запросите код заново.")
        raise HTTPException(status_code=400, detail="Код недействителен или истёк")

    user.password_hash = hash_password(payload.new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    await db.commit()
    _reset_code_attempts("reset", payload.email)
    return {"status": "ok"}


# ===================================================================
# Social login (yandex / github / google)
# ===================================================================

@router.get("/auth/{provider}/login")
async def sso_login(
    provider: str,
    next_path: str | None = Query(None, alias="next"),
):
    from main import yandex_sso, github_sso, google_sso

    if provider == "yandex":
        sso = yandex_sso
    elif provider == "github":
        sso = github_sso
    elif provider == "google":
        sso = google_sso
    else:
        raise HTTPException(status_code=404, detail="Provider not found")

    # fastapi-sso keeps the OAuth client state on the provider instance and
    # requires its async context manager for safe per-request isolation.
    async with sso:
        redirect = await sso.get_login_redirect()

    safe_next = _safe_next_path(next_path)
    if safe_next:
        redirect.set_cookie(
            key="sso_next",
            value=safe_next,
            httponly=True,
            secure=os.getenv("APP_ENV", "dev").lower() == "prod",
            samesite="lax",
            max_age=600,
            path="/",
            domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
        )
    return redirect


@router.get("/auth/{provider}/callback")
async def sso_callback(
    provider: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
):
    from main import yandex_sso, github_sso, google_sso
    from models import SocialAccount

    if provider == "yandex":
        sso = yandex_sso
    elif provider == "github":
        sso = github_sso
    elif provider == "google":
        sso = google_sso
    else:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        # fastapi-sso >= 0.16 resets and locks the OAuth client in this
        # context. Without it, current releases can reject the callback with
        # a generic SSO failure (most visible on Yandex).
        async with sso:
            openid_user = await sso.verify_and_process(request)
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"SSO Error ({provider}): {str(e)}\n{error_details}", extra={
            "query_params": str(request.query_params),
            "provider": provider,
        })
        raise HTTPException(status_code=400, detail="SSO Authentication Failed")

    if not openid_user or not openid_user.email:
        raise HTTPException(status_code=400, detail="No email provided by social login")

    res_social = await db.execute(
        select(SocialAccount).where(
            SocialAccount.provider == provider,
            SocialAccount.provider_id == str(openid_user.id),
        )
    )
    social_acc = res_social.scalar_one_or_none()

    if social_acc:
        res_user = await db.execute(
            select(User).where(User.id == social_acc.user_id, User.deleted_at.is_(None))
        )
        user = res_user.scalar_one_or_none()
    else:
        res_user = await db.execute(
            select(User).where(User.email == openid_user.email, User.deleted_at.is_(None))
        )
        user = res_user.scalar_one_or_none()

        if not user:
            user = User(
                email=openid_user.email,
                name=openid_user.display_name or openid_user.email.split("@")[0],
                password_hash=None,
                is_active=True,
                email_verified=True,  # trusted from OAuth
            )
            db.add(user)
            await db.flush()

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

    token = create_access_token(user.id)
    frontend_url = os.getenv("APP_PUBLIC_URL", "http://localhost:3000")

    sso_next = _safe_next_path(request.cookies.get("sso_next"))
    # НЕ кладём JWT в URL: он осел бы в истории браузера, логах прокси и
    # Referer. Сессия — в httpOnly-cookie (ставится ниже). Фронту нужен лишь
    # необсекретный флаг ?sso=1, чтобы выставить маркер «я залогинен».
    target = f"{frontend_url}/dashboard?sso=1"
    if sso_next:
        target += f"&next={urllib.parse.quote(sso_next, safe='/')}"

    redirect = RedirectResponse(url=target, status_code=302)
    if sso_next:
        redirect.delete_cookie(
            "sso_next",
            path="/",
            domain=os.getenv("COOKIE_DOMAIN", ".pitchy.pro"),
        )
    _set_session_cookie(redirect, token)
    return redirect
