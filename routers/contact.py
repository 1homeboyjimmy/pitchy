"""Public contact-form router — forwards submissions to support@pitchy.pro.

First router carved out of main.py. The endpoint here is bit-for-bit
identical to what used to live as @app.post("/contact-form") in main.py;
this module just isolates the model, the in-memory throttle, and the
handler so future contact-form features (file attachments, captcha,
ticket IDs, etc.) don't bloat the monolith further.
"""

from __future__ import annotations

import logging
import time
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr

from email_utils import send_email

router = APIRouter(tags=["public"])
logger = logging.getLogger("app.routers.contact")


class ContactRequest(BaseModel):
    name: str
    email: EmailStr
    subject: str  # one of: tech | billing | api | other
    message: str


_SUBJECT_LABELS = {
    "tech": "Техническая поддержка",
    "billing": "Вопросы оплаты",
    "api": "Интеграция API",
    "other": "Другое",
}

# Naive per-IP throttle: at most 3 submissions / hour.
_throttle: dict[str, list[float]] = {}
_LIMIT_PER_HOUR = 3


@router.post("/contact-form")
async def contact_form(payload: ContactRequest, request: Request) -> dict:
    """Public contact-form submission. Emails support@pitchy.pro with
    Reply-To set to the sender so a reply goes back to them directly.
    """
    name = (payload.name or "").strip()[:200]
    msg = (payload.message or "").strip()
    if not name or len(msg) < 5:
        raise HTTPException(status_code=422,
                            detail="Заполните имя и сообщение (минимум 5 символов)")
    if len(msg) > 5000:
        raise HTTPException(status_code=422,
                            detail="Сообщение слишком длинное (максимум 5000 символов)")

    ip = (request.client.host if request.client else "unknown") or "unknown"
    now = time.time()
    window = [t for t in _throttle.get(ip, []) if now - t < 3600]
    if len(window) >= _LIMIT_PER_HOUR:
        raise HTTPException(status_code=429,
                            detail="Слишком много обращений. Попробуйте через час.")
    window.append(now)
    _throttle[ip] = window

    subject_label = _SUBJECT_LABELS.get(payload.subject, payload.subject)
    email_subject = f"[pitchy.pro/contact] {subject_label} — {name}"
    body = (
        f"Новое обращение через форму на pitchy.pro/contact\n\n"
        f"Имя:    {name}\n"
        f"Email:  {payload.email}\n"
        f"Тема:   {subject_label}\n"
        f"IP:     {ip}\n\n"
        f"--- Сообщение ---\n{msg}\n"
    )

    try:
        await run_in_threadpool(
            send_email,
            "support@pitchy.pro",
            email_subject,
            body,
            "noreply",
            str(payload.email),
        )
    except Exception as e:
        logger.error(f"Contact form failed for {payload.email}: {e}", exc_info=True)
        raise HTTPException(status_code=502,
                            detail="Не удалось отправить письмо. Попробуйте позже.")

    return {"ok": True}
