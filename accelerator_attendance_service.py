"""Short-lived, event-bound QR capabilities and unambiguous event timestamps."""
import base64
import hashlib
import hmac
import os
import re
import time
from datetime import datetime, timezone

from fastapi import HTTPException

from auth import _secret_key

QR_TTL_SECONDS = 600
TOKEN_PATTERN = re.compile(r"^q1\.([1-9][0-9]{0,18})\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$")


def utc_datetime(value: datetime | None):
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _signature(event, expires: int) -> str:
    message = f"pitchy-attendance:q1:{event.id}:{expires}:{event.checkin_code}".encode()
    digest = hmac.new(_secret_key().encode(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def checkin_session(event, *, now: int | None = None) -> dict:
    expires = (int(time.time()) if now is None else now) + QR_TTL_SECONDS
    token = f"q1.{event.id}.{expires}.{_signature(event, expires)}"
    frontend = os.getenv("FRONTEND_URL", "https://pitchy.pro").rstrip("/")
    return {"checkin_url": f"{frontend}/accelerator/check-in/{token}",
            "expires_at": datetime.fromtimestamp(expires, timezone.utc), "token": token}


def token_event_id(token: str) -> int:
    match = TOKEN_PATTERN.fullmatch(token)
    if not match:
        raise HTTPException(404, "Ссылка отметки недействительна. Попросите актуальный QR-код у преподавателя.")
    event_id = int(match[1])
    if event_id > 2_147_483_647:
        raise HTTPException(404, "Ссылка отметки недействительна")
    return event_id


def validate_checkin_token(token: str, event, *, now: int | None = None):
    match = TOKEN_PATTERN.fullmatch(token)
    if not match or int(match[1]) != event.id or not hmac.compare_digest(match[3], _signature(event, int(match[2]))):
        raise HTTPException(404, "Ссылка отметки недействительна")
    timestamp = int(time.time()) if now is None else now
    if int(match[2]) <= timestamp:
        raise HTTPException(409, "QR-код устарел. Отсканируйте актуальный QR-код у преподавателя.")
    if int(match[2]) > timestamp + QR_TTL_SECONDS:
        raise HTTPException(404, "Ссылка отметки недействительна")
