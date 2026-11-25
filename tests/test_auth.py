import importlib
from unittest import mock
import uuid
import sys
from fastapi.testclient import TestClient

# Mock rag module to avoid chromadb import issues on Python 3.14
sys.modules["rag"] = mock.MagicMock()


def test_register_and_login(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "local-test-only-not-a-real-key")
    monkeypatch.setenv("POLZA_API_KEY", "local-test-only-not-a-real-key")
    import main

    importlib.reload(main)
    # Use unique email to avoid collision
    unique_email = f"test_{uuid.uuid4()}@example.com"
    payload = {
        "email": unique_email,
        "name": "Test",
        "password": "Pass1234",
        "accept_privacy": True,
        "accept_cookies": True,
    }

    with TestClient(main.app) as client:
        # Mock random.randint to returning 5 so code is '555555'.
        # Код генерирует routers/auth.py (после выноса auth из main) —
        # мок main.random сюда больше не дотягивается.
        with mock.patch('routers.auth.random.randint', return_value=5):
            res = client.post("/auth/register", json=payload)
            # If email exists from previous failed run, strict check might fail.
            # But with uuid it should be fine.
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "verification_required"

            rejected = client.post("/auth/verify-email", json={"email": unique_email, "code": "000000"})
            assert rejected.status_code == 400
            assert "access_token" not in rejected.json()

            # Verify
            verify_res = client.post("/auth/verify-email", json={
                "email": unique_email,
                "code": "555555"
            })
            assert verify_res.status_code == 200
            assert verify_res.status_code == 200
            assert "access_token" in verify_res.json()
            # Confirmation grants access once, then regular sign-in is required.
            for code in ("555555", "000000"):
                client.cookies.clear()
                repeated = client.post("/auth/verify-email", json={
                    "email": unique_email, "code": code,
                })
                assert repeated.status_code == 400
                assert "access_token" not in repeated.json()
                assert "set-cookie" not in repeated.headers

            # Login check
            login = client.post(
                 "/auth/login",
                 json={"email": payload["email"], "password": payload["password"]},
            )
            assert login.status_code == 200
            assert "access_token" in login.json()
            token = login.json()["access_token"]

            # Verify /me endpoint (POST) for frontend compatibility.
            # Auth — только httpOnly-cookie (Bearer-фолбэк убран в auth.py);
            # кука логина имеет domain=.pitchy.pro и не попадает в jar
            # TestClient, поэтому передаём её явным заголовком.
            me_res = client.post(
                "/me",
                headers={"Cookie": f"access_token={token}"}
            )
            assert me_res.status_code == 200
            me_data = me_res.json()
            assert me_data["email"] == unique_email
            assert me_data["is_social"] is False


def test_repeat_registration_preserves_existing_account(monkeypatch):
    """Resuming signup must not delete projects or replace account credentials."""
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock
    from fastapi import HTTPException, Response
    from starlette.requests import Request
    from auth import hash_password
    from models import User
    from routers.auth import register
    from schemas.base import RegisterRequest
    import routers.auth as auth_router
    import main

    monkeypatch.setattr(main, '_check_rate_limit', lambda *_: None)
    monkeypatch.setattr(main, '_check_registration_rate_limit', lambda *_: None)
    monkeypatch.setattr(main, 'get_client_ip', lambda *_: '127.0.0.1')
    send = Mock()
    monkeypatch.setattr(auth_router, 'send_email', send)
    original_hash = hash_password('Original1234')
    user = User(id=955, email='repeat@example.com', name='Existing owner',
                password_hash=original_hash, email_verified=False, is_active=True,
                local_login_enabled=True, deleted_at=None, locked_until=None)
    result = Mock()
    result.scalar_one_or_none.return_value = user
    db = SimpleNamespace(execute=AsyncMock(return_value=result), commit=AsyncMock(),
                         rollback=AsyncMock(), refresh=AsyncMock(), add=Mock(),
                         delete=AsyncMock(side_effect=AssertionError('Must never delete an existing user')))
    request = Request({'type': 'http', 'headers': []})

    async def run():
        for password in ('WrongPassword123', 'Original1234'):
            payload = RegisterRequest(email=user.email, name='Replacement name', password=password,
                                      accept_privacy=True, accept_cookies=True)
            if password.startswith('Wrong'):
                try:
                    await register(payload, request, Response(), db)
                except HTTPException as exc:
                    assert exc.status_code == 400 and 'восстановите пароль' in exc.detail
                else:
                    raise AssertionError('Wrong password must not resume signup')
                db.commit.assert_not_awaited()
                send.assert_not_called()
            else:
                response = await register(payload, request, Response(), db)
                assert response['status'] == 'verification_required'
                assert user.email_verify_code_hash and user.email_verify_expires_at
                assert send.call_count == 1
            assert user.id == 955 and user.name == 'Existing owner'
            assert user.password_hash == original_hash
            db.delete.assert_not_awaited()
            db.add.assert_not_called()
        user.email_verified = True
        try:
            await register(payload, request, Response(), db)
        except HTTPException as exc:
            assert exc.status_code == 400 and exc.detail == 'Email already registered'
        else:
            raise AssertionError('Verified account must use sign-in')
        assert send.call_count == 1
    asyncio.run(run())
