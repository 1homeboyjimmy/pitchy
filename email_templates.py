"""Email templates — all Russian, plain text, signed «Команда Pitchy».

Each function returns a (subject, body) tuple. Pass them straight to
email_utils.send_email or to a BackgroundTask.

Texts approved by Egor on 2026-05-17. When changing wording, also update
the comment in upgrade-modal/pricing components if pricing changes.
"""

from __future__ import annotations

from datetime import datetime

# When a real support@pitchy.pro mailbox is wired up, swap this constant
# to "support@pitchy.pro". Until then we point users to the website form.
SUPPORT_CONTACT = "https://pitchy.pro/contact"

SIGNATURE = "\n\n— Команда Pitchy"


def _first_name(name: str | None) -> str:
    """First word of the full name, used in salutations."""
    return name.strip().split()[0] if name and name.strip() else ""


def _greeting(name: str | None) -> str:
    n = _first_name(name)
    return f"Привет, {n}!" if n else "Привет!"


def _now_moscow_human() -> str:
    """Human-readable Moscow time, e.g. '17 мая 2026, 14:35 МСК'."""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("Europe/Moscow"))
    except Exception:
        # Fallback: UTC+3 manually
        from datetime import timedelta, timezone
        now = datetime.now(timezone(timedelta(hours=3)))
    months = ["января", "февраля", "марта", "апреля", "мая", "июня",
              "июля", "августа", "сентября", "октября", "ноября", "декабря"]
    return f"{now.day} {months[now.month - 1]} {now.year}, {now:%H:%M} МСК"


def _date_human(dt: datetime | None) -> str:
    """Human-readable date, e.g. '20 мая 2026'."""
    if not dt:
        return "—"
    months = ["января", "февраля", "марта", "апреля", "мая", "июня",
              "июля", "августа", "сентября", "октября", "ноября", "декабря"]
    return f"{dt.day} {months[dt.month - 1]} {dt.year}"


def _tier_title(tier: str) -> str:
    return {"starter": "Starter", "pro": "Pro", "tester": "Tester"}.get(tier, tier.title())


# ===================================================================
# Account / auth
# ===================================================================

def email_verification(name: str | None, code: str) -> tuple[str, str]:
    """Email confirmation at registration time."""
    subj = f"Pitchy: подтверждение email — код {code}"
    body = (
        f"{_greeting(name)}\n\n"
        f"Спасибо за регистрацию в Pitchy.\n\n"
        f"Ваш код подтверждения email:\n\n"
        f"    {code}\n\n"
        f"Введите его на странице регистрации, чтобы завершить создание\n"
        f"аккаунта. Код действителен 24 часа.\n\n"
        f"Если вы не регистрировались на pitchy.pro — просто проигнорируйте\n"
        f"это письмо, никаких действий с вашей почтой произведено не будет."
        f"{SIGNATURE}"
    )
    return subj, body


def email_change_verification(name: str | None, code: str) -> tuple[str, str]:
    """Confirming the *new* address when the user changes their email."""
    subj = f"Pitchy: подтверждение нового email — код {code}"
    body = (
        f"{_greeting(name)}\n\n"
        f"Вы запросили смену email в аккаунте Pitchy.\n\n"
        f"Код подтверждения нового адреса:\n\n"
        f"    {code}\n\n"
        f"Введите его на странице аккаунта, чтобы завершить смену. Код\n"
        f"действителен 24 часа.\n\n"
        f"Если вы не запрашивали смену email — это важно: ваш аккаунт\n"
        f"пытаются взять. Войдите в Pitchy и смените пароль."
        f"{SIGNATURE}"
    )
    return subj, body


def password_change_code(name: str | None, code: str) -> tuple[str, str]:
    """Code used to confirm an in-account password change."""
    subj = f"Pitchy: код для смены пароля — {code}"
    body = (
        f"{_greeting(name)}\n\n"
        f"Вы запросили смену пароля в Pitchy.\n\n"
        f"Код подтверждения:\n\n"
        f"    {code}\n\n"
        f"Введите его на странице аккаунта, чтобы установить новый пароль.\n"
        f"Код действителен 10 минут.\n\n"
        f"Если вы не запрашивали смену — проигнорируйте письмо, текущий\n"
        f"пароль останется в силе."
        f"{SIGNATURE}"
    )
    return subj, body


def password_changed_notice(name: str | None) -> tuple[str, str]:
    """Notification sent after a successful password change."""
    when = _now_moscow_human()
    subj = "Pitchy: пароль изменён"
    body = (
        f"{_greeting(name)}\n\n"
        f"Пароль аккаунта Pitchy успешно изменён {when}.\n\n"
        f"Если это были не вы — войдите в аккаунт через социальный логин\n"
        f"(Яндекс / Google / GitHub) и немедленно сбросьте пароль через\n"
        f"«Забыли пароль?». Или напишите нам: {SUPPORT_CONTACT}"
        f"{SIGNATURE}"
    )
    return subj, body


def password_reset_code(code: str) -> tuple[str, str]:
    """Code for the «forgot password» flow (user not logged in)."""
    subj = f"Pitchy: код для сброса пароля — {code}"
    body = (
        f"Привет!\n\n"
        f"Вы запросили сброс пароля для аккаунта Pitchy.\n\n"
        f"Код для установки нового пароля:\n\n"
        f"    {code}\n\n"
        f"Введите его на странице сброса. Код действителен 30 минут.\n\n"
        f"Если вы не запрашивали сброс — проигнорируйте письмо."
        f"{SIGNATURE}"
    )
    return subj, body


# ===================================================================
# Payments / subscriptions
# ===================================================================

_TIER_FEATURES = {
    "starter": [
        "— До 10 проектов",
        "— Все премиум-шаблоны",
        "— Экспорт без водяных знаков",
        "— Базовая аналитика",
    ],
    "pro": [
        "— Безлимитные проекты",
        "— Пользовательские шаблоны",
        "— Командная работа",
        "— Продвинутая аналитика",
        "— Приоритетная поддержка 24/7",
    ],
    "tester": ["— Тестовый доступ ко всем функциям"],
}


def payment_succeeded(name: str | None, tier: str, amount: float, is_annual: bool,
                      expires_at: datetime | None, payment_id: str) -> tuple[str, str]:
    """Payment confirmed and subscription activated."""
    tier_t = _tier_title(tier)
    period = "1 год" if is_annual else "1 месяц"
    short_id = (payment_id or "—")[:8]
    expires_h = _date_human(expires_at)
    features = "\n".join(_TIER_FEATURES.get(tier, ["— Подписка активна"]))

    subj = f"Pitchy: подписка {tier_t} активирована до {expires_h}"
    body = (
        f"{_greeting(name)}\n\n"
        f"Платёж принят. Подписка Pitchy {tier_t} активна до {expires_h}.\n\n"
        f"Сумма платежа: {amount:.0f}₽\n"
        f"Период: {period}\n"
        f"Номер платежа: {short_id}\n\n"
        f"Что доступно теперь:\n"
        f"{features}\n\n"
        f"Управление подпиской и история платежей: https://pitchy.pro/account"
        f"{SIGNATURE}"
    )
    return subj, body


def payment_canceled(name: str | None, tier: str, amount: float, payment_id: str) -> tuple[str, str]:
    """Payment failed or was canceled by the bank/user."""
    tier_t = _tier_title(tier)
    short_id = (payment_id or "—")[:8]
    subj = "Pitchy: платёж не прошёл"
    body = (
        f"{_greeting(name)}\n\n"
        f"Платёж по подписке Pitchy {tier_t} не прошёл.\n\n"
        f"Сумма: {amount:.0f}₽\n"
        f"Номер платежа: {short_id}\n\n"
        f"Подписка не активирована, деньги списаны не будут. Это могло\n"
        f"произойти по разным причинам: банк отклонил операцию, недостаточно\n"
        f"средств, отмена с вашей стороны.\n\n"
        f"Попробовать снова: https://pitchy.pro/pricing\n\n"
        f"Если повторяется — напишите нам: {SUPPORT_CONTACT}"
        f"{SIGNATURE}"
    )
    return subj, body


def subscription_expiring(name: str | None, tier: str, expires_at: datetime | None,
                          days_left: int) -> tuple[str, str]:
    """Warning N days before subscription expiry."""
    tier_t = _tier_title(tier)
    expires_h = _date_human(expires_at)
    # Russian word agreement: 1 день / 2-4 дня / 5+ дней
    if days_left % 10 == 1 and days_left % 100 != 11:
        days_word = "день"
    elif 2 <= days_left % 10 <= 4 and not (11 <= days_left % 100 <= 14):
        days_word = "дня"
    else:
        days_word = "дней"

    subj = f"Pitchy: подписка {tier_t} истекает {expires_h}"
    body = (
        f"{_greeting(name)}\n\n"
        f"Подписка Pitchy {tier_t} истекает {expires_h} — "
        f"через {days_left} {days_word}.\n\n"
        f"После окончания подписки аккаунт перейдёт на бесплатный план:\n"
        f"ограничение по сообщениям, отключение продвинутых функций.\n\n"
        f"Продлить: https://pitchy.pro/pricing"
        f"{SIGNATURE}"
    )
    return subj, body
