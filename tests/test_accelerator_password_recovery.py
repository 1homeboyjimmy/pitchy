"""Recovery works with imported mixed-case addresses; failures are observable."""
import logging
import smtplib
import sys
from types import SimpleNamespace
from unittest.mock import Mock
import uuid

import pytest
from starlette.requests import Request
from auth import hash_password, verify_password
from db_async import AsyncSessionLocal
from models import User
from routers import auth as routes
from schemas.base import PasswordResetRequest, PasswordResetConfirm


@pytest.mark.asyncio
async def test_reset_imported_address_without_case_sensitivity(monkeypatch):
    monkeypatch.setitem(sys.modules, 'main', SimpleNamespace(_check_rate_limit=lambda ip: None, get_client_ip=lambda request: 'test'))
    sender = Mock()
    monkeypatch.setattr(routes, 'send_email', sender)
    monkeypatch.setattr(routes.secrets, 'choice', lambda chars: '7')
    request = Request({'type': 'http', 'headers': []})
    async with AsyncSessionLocal() as db:
        email = 'Imported'+uuid.uuid4().hex+'@example.com'
        user = User(email=email, name='Imported student', is_active=True, password_hash=hash_password('OldPassword123'))
        db.add(user); await db.commit()
        assert await routes.request_password_reset(PasswordResetRequest(email=email.lower()), request, db) == {'status': 'ok'}
        assert sender.call_args.args[0] == email
        result = await routes.reset_password(PasswordResetConfirm(email=email.upper(), code='777777', new_password='NewPassword123'), request, db)
        assert result == {'status': 'ok'}
        await db.refresh(user)
        assert verify_password('NewPassword123', user.password_hash)
        assert user.password_reset_token_hash is None


@pytest.mark.asyncio
async def test_provider_failure_logged_without_code_or_account_disclosure(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, 'main', SimpleNamespace(_check_rate_limit=lambda ip: None, get_client_ip=lambda request: 'test'))
    monkeypatch.setattr(routes, 'send_email', Mock(side_effect=smtplib.SMTPAuthenticationError(535, b'Authentication failed')))
    monkeypatch.setattr(routes.secrets, 'choice', lambda chars: '8')
    request = Request({'type': 'http', 'headers': []})
    async with AsyncSessionLocal() as db:
        user = User(email=uuid.uuid4().hex+'@example.com', name='Recovery student', is_active=True)
        db.add(user); await db.commit()
        with caplog.at_level(logging.ERROR):
            result = await routes.request_password_reset(PasswordResetRequest(email=user.email), request, db)
        assert result == {'status': 'ok'}
        assert 'password_reset_delivery_failed' in caplog.text and 'smtp_code=535' in caplog.text
        assert user.email not in caplog.text and '888888' not in caplog.text
        unknown = await routes.request_password_reset(PasswordResetRequest(email=uuid.uuid4().hex+'@example.com'), request, db)
        assert unknown == result
