import json
import hashlib
import time

import custdev_sso as sso


def setup_function():
    sso._memory.clear()
    sso.CLIENT_ID = "custdev"
    sso.REDIRECT_URI = "https://custdev.pitchy.pro/api/auth/callback"
    sso.SERVICE_SECRET = "test-service-secret-" + "x" * 32


def test_code_is_single_use_and_pkce_is_verified():
    verifier = "v" * 64
    import base64
    import hashlib

    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    code = sso.issue_code(user_id=42, code_challenge=challenge)

    payload = sso.consume_code(code)
    assert payload["user_id"] == "42"
    assert sso.verify_pkce(verifier, payload["code_challenge"])
    assert sso.consume_code(code) is None


def test_grant_introspection_and_revocation():
    grant = sso.issue_grant(user_id=42)
    active = sso.introspect_grant(grant.grant_id)
    assert active["sub"] == "42"
    assert "custdev:use" in active["scope"]

    sso.revoke_grant(grant.grant_id)
    assert sso.introspect_grant(grant.grant_id) is None


def test_service_signature_rejects_replayed_nonce(monkeypatch):
    from starlette.requests import Request

    body = json.dumps({"grant_id": "g"}, separators=(",", ":"), sort_keys=True).encode()
    timestamp = str(int(time.time()))
    nonce = "n" * 24
    canonical = "\n".join(
        ("custdev", timestamp, nonce, "POST", "/internal/auth/custdev/introspect", hashlib.sha256(body).hexdigest())
    )
    import hmac

    signature = hmac.new(sso.SERVICE_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    scope = {"type": "http", "method": "POST", "path": "/internal/auth/custdev/introspect", "headers": [
        (b"x-custdev-client", b"custdev"),
        (b"x-custdev-timestamp", timestamp.encode()),
        (b"x-custdev-nonce", nonce.encode()),
        (b"x-custdev-signature", signature.encode()),
        (b"content-type", b"application/json"),
    ], "query_string": b"", "server": ("test", 80), "client": ("127.0.0.1", 1), "scheme": "http"}
    request = Request(scope, receive=lambda: None)
    monkeypatch.setattr(request, "_body", body, raising=False)

    sso._service_signature(request, body)
    try:
        sso._service_signature(request, body)
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("replayed nonce was accepted")
