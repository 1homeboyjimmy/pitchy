"""IMAP → Telegram bridge.

Watches Yandex 360 mailboxes via IMAP IDLE (push, not polling) and
forwards each new message to a Telegram chat. Configured entirely
through environment variables — if creds are missing the whole bridge
quietly disables itself instead of crashing the backend.

ENV:
    TELEGRAM_BOT_TOKEN              — bot from @BotFather
    TELEGRAM_MAIL_CHAT_ID           — chat to post into (DM or group)
    IMAP_PASS_SUPPORT               — app-password for support@pitchy.pro
    IMAP_PASS_HELLO                 — app-password for hello@pitchy.pro
    IMAP_PASS_BILLING               — app-password for billing@pitchy.pro
    IMAP_PASS_NOREPLY               — app-password for noreply@pitchy.pro

Any mailbox whose password env var is unset is skipped silently.
"""

from __future__ import annotations

import asyncio
import logging
import os
from email import message_from_bytes
from email.header import decode_header, make_header

import httpx

logger = logging.getLogger("app.mail_bridge")

IMAP_HOST = "imap.yandex.ru"
IMAP_PORT = 993
TG_API = "https://api.telegram.org/bot{token}/sendMessage"
DOMAIN = "pitchy.pro"

# (mailbox login, env-var with app-password)
MAILBOXES: list[tuple[str, str]] = [
    (f"support@{DOMAIN}",  "IMAP_PASS_SUPPORT"),
    (f"hello@{DOMAIN}",    "IMAP_PASS_HELLO"),
    (f"billing@{DOMAIN}",  "IMAP_PASS_BILLING"),
    (f"noreply@{DOMAIN}",  "IMAP_PASS_NOREPLY"),
]


def _decode(value: str | None) -> str:
    """Decode RFC2047 MIME headers (=?utf-8?B?...?=) into plain text."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _extract_body(msg) -> str:
    """Best-effort plain-text body extraction, handles multipart."""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            cdisp = str(part.get("Content-Disposition") or "")
            if ctype == "text/plain" and "attachment" not in cdisp:
                try:
                    return part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8",
                        errors="replace",
                    )
                except Exception:
                    continue
    else:
        try:
            return msg.get_payload(decode=True).decode(
                msg.get_content_charset() or "utf-8",
                errors="replace",
            )
        except Exception:
            return ""
    return ""


def _escape_html(s: str) -> str:
    """Minimal HTML-escape for Telegram parse_mode=HTML."""
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;"))


async def _send_telegram(token: str, chat_id: str, text: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                TG_API.format(token=token),
                json={
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
        if r.status_code != 200:
            logger.error(f"Telegram send failed: {r.status_code} {r.text[:200]}")
    except Exception as e:
        logger.error(f"Telegram send error: {type(e).__name__}: {e}")


def _format_message(mailbox: str, msg) -> str:
    """Compose the Telegram message body."""
    from_ = _decode(msg.get("From", "(unknown sender)"))
    subject = _decode(msg.get("Subject", "(без темы)"))
    body = _extract_body(msg).strip()
    preview = body[:500]
    if len(body) > 500:
        preview += "…"

    return (
        f"📧 <b>{_escape_html(mailbox)}</b>\n"
        f"<b>От:</b> {_escape_html(from_)}\n"
        f"<b>Тема:</b> {_escape_html(subject)}\n\n"
        f"<pre>{_escape_html(preview)}</pre>"
    )


async def _watch_mailbox(mailbox: str, password: str, token: str, chat_id: str) -> None:
    """One IMAP IDLE loop per mailbox; reconnects on any error.

    On startup, snapshots the current UID list so we don't replay historical
    mail (otherwise every backend restart would re-spam the chat). Only
    UIDs that appear AFTER startup get forwarded.
    """
    # Local import — aioimaplib is only needed when bridge is enabled.
    try:
        import aioimaplib
    except ImportError:
        logger.error("aioimaplib not installed — mail bridge cannot start. Add to requirements.txt.")
        return

    backoff = 30
    while True:
        try:
            client = aioimaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=30)
            await client.wait_hello_from_server()

            login_res = await client.login(mailbox, password)
            if login_res.result != "OK":
                logger.error(f"IMAP login failed for {mailbox}: {login_res.lines}")
                await asyncio.sleep(backoff)
                continue

            await client.select("INBOX")

            # Snapshot existing UIDs so we don't replay history.
            search_res = await client.uid_search("ALL")
            seen: set[bytes] = set(search_res.lines[0].split()) if search_res.lines else set()
            logger.info(f"Mail bridge connected to {mailbox} (baseline UIDs: {len(seen)})")
            backoff = 30  # reset after successful connect

            while True:
                # IDLE — Yandex closes IDLE after 29 min, so refresh just under that.
                idle_task = await client.idle_start(timeout=29 * 60)
                try:
                    await asyncio.wait_for(client.wait_server_push(), timeout=29 * 60)
                except asyncio.TimeoutError:
                    pass  # idle window expired, will restart below
                finally:
                    client.idle_done()
                    try:
                        await asyncio.wait_for(idle_task, 30)
                    except Exception:
                        pass

                # Check for new UIDs since last snapshot.
                search_res = await client.uid_search("ALL")
                current = set(search_res.lines[0].split()) if search_res.lines else set()
                new_uids = sorted(u for u in current - seen)

                for uid in new_uids:
                    try:
                        fetch_res = await client.uid("fetch", uid.decode(), "(BODY.PEEK[])")
                        if len(fetch_res.lines) < 2:
                            continue
                        # aioimaplib returns: [b'1 FETCH ...', b'<raw bytes>', b')']
                        raw = fetch_res.lines[1]
                        msg = message_from_bytes(raw if isinstance(raw, (bytes, bytearray)) else raw.encode())
                        text = _format_message(mailbox, msg)
                        await _send_telegram(token, chat_id, text)
                        seen.add(uid)
                    except Exception as e:
                        logger.error(f"Failed to forward UID {uid!r} from {mailbox}: "
                                     f"{type(e).__name__}: {e}", exc_info=True)
                        # Still mark as seen so we don't retry forever on a bad message.
                        seen.add(uid)

        except Exception as e:
            logger.error(f"Mail bridge {mailbox} disconnected: "
                         f"{type(e).__name__}: {e}; reconnecting in {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)  # exponential up to 5 min


async def run_mail_bridge() -> None:
    """Entry point — call once at backend startup."""
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_MAIL_CHAT_ID", "").strip()

    if not token or not chat_id:
        logger.info("Mail-to-Telegram bridge disabled: TELEGRAM_BOT_TOKEN or TELEGRAM_MAIL_CHAT_ID not set")
        return

    accounts: list[tuple[str, str]] = []
    for mailbox, env_var in MAILBOXES:
        pw = os.getenv(env_var, "").strip()
        if pw:
            accounts.append((mailbox, pw))
        else:
            logger.info(f"Mail bridge: {env_var} not set, skipping {mailbox}")

    if not accounts:
        logger.info("Mail-to-Telegram bridge disabled: no mailbox passwords set")
        return

    logger.info(f"Mail-to-Telegram bridge starting for {len(accounts)} mailbox(es) → chat {chat_id}")
    await asyncio.gather(
        *[_watch_mailbox(m, p, token, chat_id) for m, p in accounts],
        return_exceptions=True,
    )
