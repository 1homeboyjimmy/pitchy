from __future__ import annotations

import os
import smtplib
from datetime import datetime
from email.message import EmailMessage


def send_email(to_email: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    sender = os.getenv("SMTP_FROM")
    use_tls = os.getenv("SMTP_TLS", "true").lower() == "true"

    if not host or not sender:
        raise RuntimeError("SMTP is not configured")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    # In dev mode, we act as a mock unless FORCE_REAL_EMAIL is set
    if os.getenv("APP_ENV") == "dev" and os.getenv("FORCE_REAL_EMAIL", "false").lower() != "true":
        _DEV_EMAILS.append(
            {
                "to": to_email,
                "subject": subject,
                "body": body,
                "created_at": datetime.utcnow().isoformat(),
            }
        )
        return

    with smtplib.SMTP(host, port, timeout=10) as server:
        if use_tls:
            server.starttls()
        if username and password:
            server.login(username, password)
        server.send_message(message)


_DEV_EMAILS: list[dict] = []


def get_dev_emails() -> list[dict]:
    return list(_DEV_EMAILS)
