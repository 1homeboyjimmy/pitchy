from __future__ import annotations

import os
import smtplib
from datetime import datetime
from email.message import EmailMessage

# Per-mailbox sending uses Yandex 360 SMTP with the same app-passwords
# used for IMAP (Yandex 360 reuses the same app-password for both).
Y360_SMTP_HOST = "smtp.yandex.ru"
Y360_SMTP_PORT = 465  # implicit TLS
DOMAIN = "pitchy.pro"

# Mailboxes we have credentials for. Any other value falls back to legacy
# single-sender SMTP (SMTP_HOST / SMTP_FROM env).
KNOWN_MAILBOXES = {"noreply", "billing", "hello", "support"}


def send_email(to_email: str, subject: str, body: str,
               from_mailbox: str = "noreply") -> None:
    """Send mail.

    If IMAP_PASS_<MAILBOX> is set for the requested mailbox, route through
    Yandex 360 SMTP with that mailbox as sender. Otherwise fall back to the
    legacy single-sender SMTP configured via SMTP_HOST / SMTP_FROM.
    """
    if from_mailbox in KNOWN_MAILBOXES:
        pw = os.getenv(f"IMAP_PASS_{from_mailbox.upper()}", "").strip()
        if pw:
            _send_via_y360(to_email, subject, body, from_mailbox, pw)
            return

    _send_via_legacy(to_email, subject, body)


def _send_via_y360(to_email: str, subject: str, body: str,
                   mailbox: str, password: str) -> None:
    sender = f"{mailbox}@{DOMAIN}"

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    if os.getenv("APP_ENV") == "dev" and os.getenv("FORCE_REAL_EMAIL", "false").lower() != "true":
        _DEV_EMAILS.append({
            "to": to_email, "from": sender, "subject": subject,
            "body": body, "created_at": datetime.utcnow().isoformat(),
        })
        return

    with smtplib.SMTP_SSL(Y360_SMTP_HOST, Y360_SMTP_PORT, timeout=15) as server:
        server.login(sender, password)
        server.send_message(message)


def _send_via_legacy(to_email: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    sender = os.getenv("SMTP_FROM")
    use_tls = os.getenv("SMTP_TLS", "true").lower() == "true"

    if not host or not sender:
        raise RuntimeError("SMTP is not configured (no per-mailbox creds and no SMTP_HOST/SMTP_FROM)")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    if os.getenv("APP_ENV") == "dev" and os.getenv("FORCE_REAL_EMAIL", "false").lower() != "true":
        _DEV_EMAILS.append({
            "to": to_email, "from": sender, "subject": subject,
            "body": body, "created_at": datetime.utcnow().isoformat(),
        })
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
