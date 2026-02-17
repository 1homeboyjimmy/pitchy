from __future__ import annotations

import os
from datetime import datetime, timedelta
import secrets
import hashlib

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from db import get_db
from models import User


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def _secret_key() -> str:
    load_dotenv(override=False)
    secret = os.getenv("APP_SECRET_KEY")
    if not secret:
        raise RuntimeError("APP_SECRET_KEY is missing")
    return secret


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    return pwd_context.verify(password, password_hash)


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

    user = db.query(User).filter(User.id == int(user_id)).first()
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


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token(token: str, token_hash: str | None) -> bool:
    if not token_hash:
        return False
    return secrets.compare_digest(hash_token(token), token_hash)
