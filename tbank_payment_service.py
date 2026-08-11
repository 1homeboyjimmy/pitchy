"""Small async client for T-Bank Internet Acquiring (dev/prod by configuration).

The terminal password is used only to calculate request tokens and is never
returned to callers or written to logs.
"""
from __future__ import annotations

import hashlib
import os
import hmac
from typing import Any

import httpx


class TBankError(RuntimeError):
    pass


def _config() -> tuple[str, str, str]:
    terminal = os.getenv("TBANK_TERMINAL_KEY", "").strip()
    password = os.getenv("TBANK_PASSWORD", "")
    base_url = os.getenv("TBANK_API_URL", "https://securepay.tinkoff.ru/v2").rstrip("/")
    if not terminal or not password:
        raise TBankError("T-Bank credentials are not configured")
    return terminal, password, base_url


def token(payload: dict[str, Any], password: str) -> str:
    """Build T-Bank SHA-256 token from root scalar fields only."""
    values = {k: v for k, v in payload.items() if k not in {"Token", "Receipt", "DATA"} and not isinstance(v, (dict, list))}
    values["Password"] = password
    raw = "".join(str(values[k]) for k in sorted(values))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_receipt(*, name: str, amount_rub: float, email: str | None) -> dict[str, Any]:
    amount = int(round(amount_rub * 100))
    receipt: dict[str, Any] = {
        "Taxation": os.getenv("TBANK_TAXATION", "osn"),
        "Items": [{
            "Name": name[:128],
            "Price": amount,
            "Quantity": 1,
            "Amount": amount,
            "Tax": os.getenv("TBANK_TAX", "vat20"),
            "PaymentMethod": "full_payment",
            "PaymentObject": "service",
            "MeasurementUnit": "шт",
        }],
    }
    if email:
        receipt["Email"] = email[:64]
    return receipt


async def init_payment(*, order_id: str, amount_rub: float, description: str, email: str | None) -> dict[str, Any]:
    terminal, password, base_url = _config()
    amount = int(round(amount_rub * 100))
    payload: dict[str, Any] = {
        "TerminalKey": terminal,
        "Amount": amount,
        "OrderId": order_id,
        "Description": description[:140],
        "Receipt": build_receipt(name=description, amount_rub=amount_rub, email=email),
        "SuccessURL": os.getenv("TBANK_SUCCESS_URL", ""),
        "FailURL": os.getenv("TBANK_FAIL_URL", ""),
        "NotificationURL": os.getenv("TBANK_NOTIFICATION_URL", ""),
    }
    payload = {k: v for k, v in payload.items() if v not in ("", None)}
    payload["Token"] = token(payload, password)
    async with httpx.AsyncClient(timeout=float(os.getenv("TBANK_TIMEOUT_SECONDS", "20"))) as client:
        response = await client.post(f"{base_url}/Init", json=payload)
    response.raise_for_status()
    data = response.json()
    if not data.get("Success") or not data.get("PaymentURL"):
        raise TBankError(f"T-Bank Init failed: {data.get('Message') or data.get('ErrorCode') or 'unknown error'}")
    return data


async def cancel_payment(*, payment_id: str, amount_rub: float, description: str, email: str | None) -> dict[str, Any]:
    terminal, password, base_url = _config()
    amount = int(round(amount_rub * 100))
    payload: dict[str, Any] = {
        "TerminalKey": terminal,
        "PaymentId": payment_id,
        "Amount": amount,
        "Receipt": build_receipt(name=description, amount_rub=amount_rub, email=email),
    }
    payload["Token"] = token(payload, password)
    async with httpx.AsyncClient(timeout=float(os.getenv("TBANK_TIMEOUT_SECONDS", "20"))) as client:
        response = await client.post(f"{base_url}/Cancel", json=payload)
    response.raise_for_status()
    data = response.json()
    if not data.get("Success"):
        raise TBankError(f"T-Bank Cancel failed: {data.get('Message') or data.get('ErrorCode') or 'unknown error'}")
    return data


def verify_notification(payload: dict[str, Any]) -> bool:
    _, password, _ = _config()
    expected = token(payload, password)
    supplied = str(payload.get("Token", ""))
    return bool(supplied) and hmac.compare_digest(expected, supplied)
