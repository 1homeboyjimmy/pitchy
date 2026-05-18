"""Pure-unit tests for password hashing — no DB, no app, no env.

These guard against regressions in the bcrypt-vs-legacy-pbkdf2 verify path.
We were burned by commit b9fc132 which switched to raw bcrypt and broke
login for every user with a $pbkdf2-sha256 hash from the passlib era.
"""

from passlib.hash import pbkdf2_sha256

import auth


def test_bcrypt_roundtrip():
    h = auth.hash_password("Pass1234!")
    assert h.startswith("$2")  # bcrypt prefix
    assert auth.verify_password("Pass1234!", h) is True
    assert auth.verify_password("wrong-password", h) is False


def test_legacy_pbkdf2_hash_still_verifies():
    legacy = pbkdf2_sha256.hash("OldPassword42")
    assert legacy.startswith("$pbkdf2-sha256$")
    assert auth.verify_password("OldPassword42", legacy) is True
    assert auth.verify_password("nope", legacy) is False


def test_needs_update_flags_legacy_only():
    legacy = pbkdf2_sha256.hash("x")
    bcrypt_hash = auth.hash_password("x")
    assert auth.needs_update(legacy) is True       # should be rehashed on next login
    assert auth.needs_update(bcrypt_hash) is False  # already bcrypt
    assert auth.needs_update(None) is False
    assert auth.needs_update("") is False


def test_verify_password_handles_missing_hash():
    assert auth.verify_password("anything", None) is False
    assert auth.verify_password("anything", "") is False
    assert auth.verify_password("anything", "totally-not-a-hash") is False
