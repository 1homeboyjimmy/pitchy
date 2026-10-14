"""Local login aliases never depend on Telegram's availability."""
import re


def normalize_username(value: str) -> str:
    value = value.strip().removeprefix("@").lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{4,31}", value):
        raise ValueError("Некорректный Telegram-ник")
    return value


def normalize_import_identity(value: str) -> str:
    """Organizer-provisioned residents may explicitly use email instead of Telegram."""
    value = value.strip().lower()
    if '@' in value and not value.startswith('@'):
        from pydantic import EmailStr, TypeAdapter
        email = str(TypeAdapter(EmailStr).validate_python(value))
        if len(email) > 255:
            raise ValueError('Слишком длинная почта')
        return email
    return normalize_username(value)
