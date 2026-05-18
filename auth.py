from __future__ import annotations

import os
from datetime import datetime, timedelta
import secrets
import hashlib

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


def create_access_token(user_id: int) -> str:
    expire_minutes = int(os.getenv("APP_TOKEN_EXPIRE_MINUTES", "1440"))
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(minutes=expire_minutes),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, _secret_key(), algorithm="HS256")


def get_access_token_cookie_name() -> str:
    return "access_token"


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


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token: str | None = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    else:
        token = request.cookies.get(get_access_token_cookie_name())
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, _secret_key(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == int(user_id), User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is blocked")
    if user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=403, detail="User is temporarily locked")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def get_async_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_async_db),
) -> User:
    token: str | None = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    else:
        token = request.cookies.get(get_access_token_cookie_name())
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, _secret_key(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(
        select(User)
        .options(selectinload(User.social_accounts))
        .where(User.id == int(user_id), User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is blocked")
    if user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=403, detail="User is temporarily locked")
    return user


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
