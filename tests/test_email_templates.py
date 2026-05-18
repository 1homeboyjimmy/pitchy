"""Smoke tests for email templates.

These don't try to validate the wording — that's reviewed in the PR. They
just ensure every template:
- Returns a (subject, body) tuple of two strings
- Includes the support contact and team signature
- Renders without raising on edge inputs (None name, weird day counts)
"""

from datetime import datetime, timedelta

import email_templates as t


SUPPORT = "support@pitchy.pro"
SIGN = "— Команда Pitchy"


def _check(result):
    subj, body = result
    assert isinstance(subj, str) and subj.strip(), f"empty subject: {result!r}"
    assert isinstance(body, str) and body.strip(), f"empty body: {result!r}"
    assert SIGN in body, f"signature missing in: {body!r}"
    assert SUPPORT in body, f"support contact missing in: {body!r}"


def test_email_verification_renders():
    _check(t.email_verification("Иван", "123456"))
    _check(t.email_verification(None, "000000"))  # anonymous greeting


def test_email_change_verification_renders():
    _check(t.email_change_verification("Анна", "999999"))


def test_password_change_code_renders():
    _check(t.password_change_code("Boris", "424242"))


def test_password_changed_notice_renders():
    _check(t.password_changed_notice("Иван"))
    _check(t.password_changed_notice(None))


def test_password_reset_code_renders():
    _check(t.password_reset_code("777777"))


def test_payment_succeeded_renders():
    _check(t.payment_succeeded("Иван", "pro", 1490, False,
                               datetime(2026, 6, 18), "pay_abcdefgh"))


def test_payment_canceled_renders():
    _check(t.payment_canceled("Иван", "starter", 590, "pay_xyz12345"))


def test_subscription_expiring_handles_word_agreement():
    # Russian day-word agreement: 1 день / 2-4 дня / 5+ дней
    base_dt = datetime(2026, 6, 1)
    for days, expected_word in [(1, "день"), (2, "дня"), (4, "дня"),
                                 (5, "дней"), (11, "дней"), (21, "день"),
                                 (22, "дня")]:
        subj, body = t.subscription_expiring("Иван", "pro", base_dt, days)
        assert f"{days} {expected_word}" in body, (
            f"expected '{days} {expected_word}' in body for days={days}, got: {body!r}"
        )
        assert SUPPORT in body
        assert SIGN in body
