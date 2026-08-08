"""Server-to-server SSO primitives for the CustDev application.

The browser never gives CustDev the main Pitchy signing key and CustDev never
receives the main JWT as its long-lived credential.  The flow is deliberately
small and authorization-code shaped: the main site validates its own session,
issues a one-time code, and exchanges that code for a short-lived, scoped grant.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from redis_client import get_redis


CLIENT_ID = os.getenv("CUSTDEV_SSO_CLIENT_ID", "custdev").strip()
REDIRECT_URI = os.getenv(
    "CUSTDEV_SSO_REDIRECT_URI",
    "http://localhost:5001/api/auth/callback",
).strip()
SERVICE_SECRET = os.getenv("CUSTDEV_SSO_SERVICE_SECRET", "").strip()
CODE_TTL = max(30, min(int(os.getenv("CUSTDEV_SSO_CODE_TTL", "60")), 300))
GRANT_TTL = max(60, min(int(os.getenv("CUSTDEV_SSO_GRANT_TTL", "900")), 3600))
SERVICE_CLOCK_SKEW = max(5, min(int(os.getenv("CUSTDEV_SSO_CLOCK_SKEW", "30")), 120))

_memory: dict[str, tuple[float, str]] = {}
_memory_lock = Lock()


class ExchangeRequest(BaseModel):
    grant_type: str = Field(..., min_length=1, max_length=100)
    client_id: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=20, max_length=256)
    redirect_uri: str = Field(..., min_length=1, max_length=2048)
    code_verifier: str = Field(..., min_length=43, max_length=128)


class IntrospectRequest(BaseModel):
    grant_id: str = Field(..., min_length=32, max_length=256)


@dataclass(frozen=True)
class SsoGrant:
    grant_id: str
    user_id: str
    scope: tuple[str, ...]
    expires_at: int


def _is_production() -> bool:
    return os.getenv("APP_ENV", "dev").strip().lower() == "prod"


def _key(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"custdev:sso:{prefix}:{digest}"


def _redis_set(key: str, value: str, ttl: int) -> None:
    client = get_redis()
    if client is not None:
        client.set(key, value, ex=ttl)
        return
    if _is_production():
        raise HTTPException(status_code=503, detail="SSO storage unavailable")
    with _memory_lock:
        _memory[key] = (time.time() + ttl, value)


def _redis_getdel(key: str) -> str | None:
    client = get_redis()
    if client is not None:
        getdel = getattr(client, "getdel", None)
        if getdel is not None:
            return getdel(key)
        # Redis versions without GETDEL still get an atomic Lua fallback.
        return client.eval(
            "local v=redis.call('get',KEYS[1]); "
            "if v then redis.call('del',KEYS[1]); end; return v",
            1,
            key,
        )
    with _memory_lock:
        item = _memory.pop(key, None)
    if item is None:
        return None
    expires_at, value = item
    return value if expires_at >= time.time() else None


def _redis_get(key: str) -> str | None:
    client = get_redis()
    if client is not None:
        return client.get(key)
    with _memory_lock:
        item = _memory.get(key)
    if item is None:
        return None
    expires_at, value = item
    if expires_at < time.time():
        with _memory_lock:
            _memory.pop(key, None)
        return None
    return value


def _redis_delete(key: str) -> None:
    client = get_redis()
    if client is not None:
        client.delete(key)
        return
    with _memory_lock:
        _memory.pop(key, None)


def _redis_set_once(key: str, value: str, ttl: int) -> bool:
    client = get_redis()
    if client is not None:
        return bool(client.set(key, value, ex=ttl, nx=True))
    with _memory_lock:
        item = _memory.get(key)
        if item and item[0] >= time.time():
            return False
        _memory[key] = (time.time() + ttl, value)
        return True


def _service_signature(request: Request, body: bytes) -> tuple[str, str, str]:
    client_id = request.headers.get("X-Custdev-Client", "").strip()
    timestamp = request.headers.get("X-Custdev-Timestamp", "").strip()
    nonce = request.headers.get("X-Custdev-Nonce", "").strip()
    signature = request.headers.get("X-Custdev-Signature", "").strip()
    if not client_id or not timestamp or not nonce or not signature:
        raise HTTPException(status_code=401, detail="Invalid service credentials")
    try:
        timestamp_int = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid service credentials") from exc
    if abs(int(time.time()) - timestamp_int) > SERVICE_CLOCK_SKEW:
        raise HTTPException(status_code=401, detail="Expired service request")
    if client_id != CLIENT_ID or len(SERVICE_SECRET) < 32:
        raise HTTPException(status_code=401, detail="Invalid service credentials")
    if len(nonce) < 16 or len(nonce) > 128:
        raise HTTPException(status_code=401, detail="Invalid service credentials")
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = "\n".join(
        (client_id, timestamp, nonce, request.method.upper(), request.url.path, body_hash)
    )
    expected = hmac.new(
        SERVICE_SECRET.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid service credentials")
    if not _redis_set_once(_key("nonce", nonce), "1", SERVICE_CLOCK_SKEW * 2):
        raise HTTPException(status_code=401, detail="Replayed service request")
    return client_id, timestamp, nonce


async def require_custdev_service(request: Request) -> None:
    body = await request.body()
    _service_signature(request, body)


def validate_authorize_request(
    *, client_id: str, redirect_uri: str, code_challenge: str, method: str
) -> None:
    if client_id != CLIENT_ID or redirect_uri != REDIRECT_URI:
        raise HTTPException(status_code=400, detail="Invalid SSO client")
    parsed = urlparse(redirect_uri)
    if not parsed.scheme or not parsed.netloc or parsed.fragment:
        raise HTTPException(status_code=400, detail="Invalid redirect URI")
    if _is_production() and parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="HTTPS redirect URI required")
    if method != "S256" or len(code_challenge) != 43:
        raise HTTPException(status_code=400, detail="PKCE S256 is required")


def issue_code(*, user_id: int | str, code_challenge: str) -> str:
    code = secrets.token_urlsafe(32)
    payload = {
        "user_id": str(user_id),
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "code_challenge": code_challenge,
        "created_at": int(time.time()),
    }
    _redis_set(_key("code", code), json.dumps(payload), CODE_TTL)
    return code


def consume_code(code: str) -> dict[str, Any] | None:
    raw = _redis_getdel(_key("code", code))
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def read_code(code: str) -> dict[str, Any] | None:
    raw = _redis_get(_key("code", code))
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    import base64

    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return hmac.compare_digest(challenge, code_challenge)


def issue_grant(*, user_id: int | str) -> SsoGrant:
    grant_id = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + GRANT_TTL
    grant = SsoGrant(grant_id, str(user_id), ("custdev:use",), expires_at)
    _redis_set(
        _key("grant", grant_id),
        json.dumps(
            {
                "sub": grant.user_id,
                "scope": list(grant.scope),
                "expires_at": grant.expires_at,
                "active": True,
            }
        ),
        GRANT_TTL,
    )
    return grant


def introspect_grant(grant_id: str) -> dict[str, Any] | None:
    raw = _redis_get(_key("grant", grant_id))
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not payload.get("active") or int(payload.get("expires_at", 0)) <= int(time.time()):
        return None
    return payload


def revoke_grant(grant_id: str) -> None:
    _redis_delete(_key("grant", grant_id))
