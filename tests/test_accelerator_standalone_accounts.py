import string
import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import func, inspect, select

from auth import hash_password, verify_password
from db import Base
from db_async import AsyncSessionLocal
from models import User
from scripts.provision_standalone_accounts import provision


async def table_counts(db):
    connection=await db.connection()
    existing=set(await connection.run_sync(lambda sync:inspect(sync).get_table_names()))
    return {name:(await db.execute(select(func.count()).select_from(table))).scalar_one()
            for name,table in Base.metadata.tables.items() if name in existing}


@pytest.mark.asyncio
async def test_standalone_preview_and_apply_create_only_users():
    async with AsyncSessionLocal() as db:
        actor=User(email=uuid.uuid4().hex+'@example.test',name='Organizer',is_admin=True,is_active=True)
        db.add(actor);await db.flush()
        before=await table_counts(db)
        names=['u'+uuid.uuid4().hex[:20] for _ in range(2)]
        preview,empty=await provision(db,actor=actor,usernames=names)
        assert preview['new_accounts']==2 and preview['dry_run'] and not empty
        assert await table_counts(db)==before
        result,credentials=await provision(db,actor=actor,usernames=names,apply=True)
        after=await table_counts(db)
        assert after.pop('users')==before.pop('users')+2
        assert after==before  # No projects, passports, memberships, quotas, teams or notifications.
        assert result['projects_created']==result['accelerator_records_created']==0
        assert len({c['password'] for c in credentials})==2
        for c in credentials:
            password=c['password']
            assert len(password)==16 and password.isascii() and password[0] in string.ascii_letters
            assert all(any(char in group for char in password) for group in [string.ascii_lowercase,string.ascii_uppercase,string.digits,string.punctuation])
            user=(await db.execute(select(User).where(User.username==c['username']))).scalar_one()
            assert verify_password(password,user.password_hash)
            assert user.email is None and not user.email_verified and not user.is_admin and user.local_login_enabled
        await db.rollback()


@pytest.mark.asyncio
async def test_standalone_existing_account_does_not_change_password_or_create_partial_batch():
    async with AsyncSessionLocal() as db:
        actor=User(email=uuid.uuid4().hex+'@example.test',name='Organizer',is_admin=True,is_active=True)
        existing=User(username='u'+uuid.uuid4().hex[:20],name='Existing',password_hash=hash_password('PreservePassword1!'))
        db.add_all([actor,existing]);await db.flush()
        before=await table_counts(db)
        old_hash=existing.password_hash
        with pytest.raises(HTTPException) as error:
            await provision(db,actor=actor,usernames=['u'+uuid.uuid4().hex[:20],existing.username],apply=True)
        assert error.value.status_code==409
        assert existing.password_hash==old_hash and await table_counts(db)==before
        await db.rollback()


@pytest.mark.asyncio
async def test_standalone_requires_admin_and_unique_normalized_names():
    async with AsyncSessionLocal() as db:
        actor=User(email=uuid.uuid4().hex+'@example.test',name='Resident',is_admin=False,is_active=True)
        db.add(actor);await db.flush()
        before=await table_counts(db)
        with pytest.raises(HTTPException) as error:
            await provision(db,actor=actor,usernames=['valid_user'],apply=True)
        assert error.value.status_code==403
        actor.is_admin=True
        with pytest.raises(ValueError):
            await provision(db,actor=actor,usernames=['valid_user','@VALID_USER'],apply=True)
        with pytest.raises(ValueError):
            await provision(db,actor=actor,usernames=['bad username'],apply=True)
        assert await table_counts(db)==before
        await db.rollback()
