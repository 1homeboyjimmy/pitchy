from __future__ import annotations

import os
from datetime import datetime, timedelta
import secrets
import hashlib
import logging
import time

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db import get_db
from db_async import get_async_db
from models import User


security = HTTPBearer(auto_error=False)


def _secret_key() -> str:
    load_dotenv(override=False)
    secret = os.getenv("APP_SECRET_KEY")
    if not secret:
        raise RuntimeError("APP_SECRET_KEY is missing")
    return secret


import bcrypt
from passlib.hash import pbkdf2_sha256

def hash_password(password: str) -> str:
    # Double-check: bcrypt expects bytes
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        # Legacy passlib pbkdf2_sha256 hashes (users created before the bcrypt switch).
        # bcrypt.checkpw raises on these, so route them to the right verifier.
        if password_hash.startswith("$pbkdf2-sha256$"):
            return pbkdf2_sha256.verify(password, password_hash)
        return bcrypt.checkpw(
            password.encode('utf-8'),
            password_hash.encode('utf-8')
        )
    except Exception:
        # Fallback for old/empty hashes
        return False

def needs_update(password_hash: str | None) -> bool:
    # Rehash any non-bcrypt (legacy pbkdf2) hash to bcrypt on next successful login
    if not password_hash:
        return False
    return not password_hash.startswith("$2")


def create_access_token(user_id: int, *, auth_time: int | None = None) -> str:
    expire_minutes = int(os.getenv("APP_TOKEN_EXPIRE_MINUTES", "1440"))
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(minutes=expire_minutes),
        "iat": datetime.utcnow(),
        "auth_time": auth_time or int(time.time()),
    }
    return jwt.encode(payload, _secret_key(), algorithm="HS256")


def get_access_token_cookie_name() -> str:
    configured = os.getenv("ACCESS_TOKEN_COOKIE_NAME", "").strip()
    if configured:
        return configured
    return "__Host-pitchy_session" if _host_only_cookie_mode() else "access_token"


def get_legacy_access_token_cookie_name() -> str:
    return "access_token"


def _host_only_cookie_mode() -> bool:
    return os.getenv("AUTH_COOKIE_HOST_ONLY", "false").strip().lower() in ("1", "true", "yes")


def get_access_token_max_age() -> int:
    return int(os.getenv("APP_TOKEN_EXPIRE_MINUTES", "1440")) * 60


def get_user_id_from_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, _secret_key(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    try:
        return int(sub)
    except (TypeError, ValueError):
        return None



def _session_payload(request: Request) -> dict:
    token = request.cookies.get(get_access_token_cookie_name())
    if not token and _host_only_cookie_mode():
        token = request.cookies.get(get_legacy_access_token_cookie_name())
    request.state.auth_reason = "missing_cookie"
    if not token:
        raise HTTPException(401, "Not authenticated")
    request.state.session_tag = hashlib.sha256(token.encode()).hexdigest()[:12]
    try:
        payload = jwt.decode(token, _secret_key(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        request.state.auth_reason = "expired"
        try:
            old = jwt.decode(token, _secret_key(), algorithms=["HS256"], options={"verify_exp": False})
            request.state.auth_user_id = int(old["sub"])
            request.state.session_issued_at = old.get("iat")
            request.state.session_expires_at = old.get("exp")
        except (jwt.PyJWTError, ValueError, TypeError, KeyError):
            pass
        raise HTTPException(401, "Invalid token") from exc
    except jwt.PyJWTError as exc:
        request.state.auth_reason = "invalid_signature_or_claims"
        raise HTTPException(401, "Invalid token") from exc
    try:
        uid = int(payload["sub"])
        started = int(payload.get("auth_time", payload.get("iat", time.time())))
    except (ValueError, TypeError, KeyError) as exc:
        request.state.auth_reason = "invalid_subject"
        raise HTTPException(401, "Invalid token") from exc
    request.state.auth_user_id = uid
    request.state.session_issued_at = payload.get("iat")
    request.state.session_expires_at = payload.get("exp")
    if time.time() - started > 30 * 86400:
        request.state.auth_reason = "absolute_expiry"
        raise HTTPException(401, "Invalid token")
    request.state.session_started_at = started
    request.state.auth_reason = "user_lookup"
    return payload


def _check_session_user(request: Request, user: User | None) -> User:
    if not user:
        request.state.auth_reason = "user_deleted_or_missing"
        raise HTTPException(401, "User not found")
    if not user.is_active:
        request.state.auth_reason = "user_blocked"
        raise HTTPException(403, "User is blocked")
    if user.locked_until and user.locked_until > datetime.utcnow():
        request.state.auth_reason = "user_locked"
        raise HTTPException(403, "User is temporarily locked")
    request.state.auth_reason = "authenticated"
    return user



def renew_session(request: Request, response) -> bool:
    if getattr(request.state, "auth_reason", None) != "authenticated" or response.status_code >= 400:
        return False
    issued = getattr(request.state, "session_issued_at", None)
    if not issued or time.time() - issued < get_access_token_max_age() / 2:
        return False
    from routers.auth import _set_session_cookie
    token = create_access_token(request.state.auth_user_id, auth_time=request.state.session_started_at)
    _set_session_cookie(response, token)
    request.state.auth_reason = "session_renewed"
    request.state.session_tag = hashlib.sha256(token.encode()).hexdigest()[:12]
    request.state.session_issued_at = int(time.time())
    request.state.session_expires_at = int(time.time()) + get_access_token_max_age()
    return True


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    payload = _session_payload(request)
    user = db.query(User).filter(User.id == int(payload["sub"]), User.deleted_at.is_(None)).first()
    return _check_session_user(request, user)


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def get_async_current_user(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
) -> User:
    payload = _session_payload(request)
    result = await db.execute(select(User).options(selectinload(User.social_accounts)).where(
        User.id == int(payload["sub"]), User.deleted_at.is_(None)))
    return _check_session_user(request, result.scalar_one_or_none())


async def require_async_admin(user: User = Depends(get_async_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token(token: str, token_hash: str | None) -> bool:
    if not token_hash:
        return False
    return secrets.compare_digest(hash_token(token), token_hash)
