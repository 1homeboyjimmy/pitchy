"""Local login aliases never depend on Telegram's availability."""
import re


def normalize_username(value: str) -> str:
    value = value.strip().removeprefix("@").lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{4,31}", value):
        raise ValueError("Некорректный Telegram-ник")
    return value
