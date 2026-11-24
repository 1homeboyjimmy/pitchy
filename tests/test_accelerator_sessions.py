"""Cookie validation, rolling expiry and private diagnostic metadata."""
import json
import logging
import time
import uuid
from datetime import datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request
from sqlalchemy import select

from auth import _session_payload, _secret_key, get_access_token_cookie_name, get_async_current_user, renew_session, create_access_token
from db_async import AsyncSessionLocal
from models import User
from observability import JsonFormatter
from routers.auth import current_session


def request(token=None):
    headers = [(b'cookie', (get_access_token_cookie_name()+'='+token).encode())] if token else []
    return Request({'type': 'http', 'headers': headers})


def signed(uid, age=0, expired=False, started=None):
    now=int(time.time())
    return jwt.encode({'sub':str(uid),'iat':now-age,'exp':now-1 if expired else now+3600,
                       'auth_time':started or now-age},_secret_key(),algorithm='HS256')


@pytest.mark.asyncio
async def test_valid_cookie_bootstrap_and_sliding_expiry(monkeypatch):
    monkeypatch.setenv('APP_TOKEN_EXPIRE_MINUTES','1440')
    monkeypatch.setenv('APP_ENV','prod')
    async with AsyncSessionLocal() as db:
        user=User(email=uuid.uuid4().hex+'@example.com',name='Session test',is_active=True)
        db.add(user);await db.commit()
        started=int(time.time())-13*3600
        req=request(signed(user.id,age=13*3600,started=started))
        verified=await get_async_current_user(req,db)
        response=Response()
        assert (await current_session(response,verified))['user_id']==user.id
        assert response.headers['cache-control']=='no-store'
        assert renew_session(req,response)
        cookie=response.headers['set-cookie']
        assert 'HttpOnly' in cookie and 'Secure' in cookie and 'SameSite=lax' in cookie
        token=cookie.split(';')[0].split('=',1)[1]
        claims=jwt.decode(token,_secret_key(),algorithms=['HS256'])
        assert claims['auth_time']==started and claims['exp']>time.time()+23*3600
        assert req.state.auth_reason=='session_renewed'
        fresh=request(token);await get_async_current_user(fresh,db)
        assert not renew_session(fresh,Response())


@pytest.mark.parametrize('kind,reason',[('missing','missing_cookie'),('expired','expired'),('tampered','invalid_signature_or_claims'),('subject','invalid_subject'),('absolute','absolute_expiry')])
def test_failure_reasons_and_expired_signed_identity(kind,reason):
    token=None if kind=='missing' else signed(1351,expired=kind=='expired',started=int(time.time())-31*86400 if kind=='absolute' else None)
    if kind=='tampered':token=token[:-12]+'x'*12
    if kind=='subject':token=signed('not-an-id')
    req=request(token)
    with pytest.raises(HTTPException) as error:_session_payload(req)
    assert error.value.status_code==401 and req.state.auth_reason==reason
    if kind=='expired':assert req.state.auth_user_id==1351 and req.state.session_expires_at<int(time.time())
    if kind=='tampered':assert not hasattr(req.state,'auth_user_id')


@pytest.mark.asyncio
async def test_deleted_and_blocked_accounts_do_not_renew():
    async with AsyncSessionLocal() as db:
        user=User(email=uuid.uuid4().hex+'@example.com',is_active=False)
        db.add(user);await db.commit()
        req=request(create_access_token(user.id))
        with pytest.raises(HTTPException) as error:await get_async_current_user(req,db)
        assert error.value.status_code==403 and req.state.auth_reason=='user_blocked'
        assert not renew_session(req,Response())
        user.is_active=True;user.deleted_at=datetime.utcnow();await db.commit()
        req=request(create_access_token(user.id))
        with pytest.raises(HTTPException):await get_async_current_user(req,db)
        assert req.state.auth_reason=='user_deleted_or_missing'


def test_diagnostics_include_correlation_not_secret():
    rec=logging.LogRecord('app.auth',logging.INFO,'',0,'auth_session',(),None)
    rec.request_id='request-id';rec.user_id=1351;rec.auth_reason='expired';rec.session_tag='digest';rec.session_issued_at=1;rec.session_expires_at=2
    data=json.loads(JsonFormatter().format(rec))
    assert data['request_id']=='request-id' and data['auth_reason']=='expired' and data['user_id']==1351
    assert 'cookie' not in data and 'token' not in data and 'password' not in data
