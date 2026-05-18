"""Validate that the RegisterRequest schema rejects registrations without
explicit privacy + cookies consent. Pure schema-level test — no app boot.
"""

import pytest
from pydantic import ValidationError

from schemas.base import RegisterRequest


BASE_OK = {
    "email": "test@example.com",
    "name": "Test User",
    "password": "Pass1234",
    "accept_privacy": True,
    "accept_cookies": True,
}


def test_valid_registration_passes():
    r = RegisterRequest(**BASE_OK)
    assert r.email == "test@example.com"
    assert r.accept_privacy is True
    assert r.accept_cookies is True


def test_missing_privacy_consent_rejected():
    with pytest.raises(ValidationError):
        RegisterRequest(**{**BASE_OK, "accept_privacy": False})


def test_missing_cookies_consent_rejected():
    with pytest.raises(ValidationError):
        RegisterRequest(**{**BASE_OK, "accept_cookies": False})


def test_both_consents_omitted_rejected():
    payload = {k: v for k, v in BASE_OK.items()
               if k not in ("accept_privacy", "accept_cookies")}
    with pytest.raises(ValidationError):
        RegisterRequest(**payload)


def test_weak_password_rejected():
    # password must contain at least one letter and one digit
    with pytest.raises(ValidationError):
        RegisterRequest(**{**BASE_OK, "password": "12345678"})
    with pytest.raises(ValidationError):
        RegisterRequest(**{**BASE_OK, "password": "abcdefgh"})
