"""Create local-login users only. Never create accelerator records or projects."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import string
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def generate_password():
    groups = (string.ascii_lowercase, string.ascii_uppercase, string.digits, '!@#$%^&*_-+=?')
    tail = [secrets.choice(group) for group in groups] + [secrets.choice(''.join(groups)) for _ in range(11)]
    secrets.SystemRandom().shuffle(tail)
    return secrets.choice(string.ascii_letters) + ''.join(tail)


async def provision(db, *, actor, usernames, apply=False):
    from fastapi import HTTPException
    from sqlalchemy import select, func
    from auth import hash_password
    from login_identity import normalize_username
    from models import User, Project, ProjectTree, AcceleratorMembership

    names = [normalize_username(value) for value in usernames]
    if not names or len(names) != len(set(names)) or len(names) > 100:
        raise ValueError('Expected 1–100 unique Telegram usernames')
    if not actor or not actor.is_admin or not actor.is_active or actor.deleted_at:
        raise HTTPException(403, 'Active platform administrator required')
    existing = (await db.execute(select(User).where(User.username.in_(names)).with_for_update())).scalars().all()
    if existing:
        raise HTTPException(409, 'Existing accounts must be handled separately; no password was changed')
    if not apply:
        return {'new_accounts':len(names),'projects_created':0,'accelerator_records_created':0,'dry_run':True}, []
    credentials = []
    users = []
    generated = set()
    for name in names:
        password = generate_password()
        while password in generated:
            password = generate_password()
        generated.add(password)
        user = User(username=name, email=None, name='@'+name, password_hash=hash_password(password),
                    local_login_enabled=True, email_verified=False, is_active=True, is_admin=False)
        db.add(user)
        users.append(user)
        credentials.append({'username':name,'password':password})
    await db.flush()
    ids = [user.id for user in users]
    for model, column in [(Project,Project.user_id),(ProjectTree,ProjectTree.user_id),
                          (AcceleratorMembership,AcceleratorMembership.user_id)]:
        assert (await db.execute(select(func.count()).select_from(model).where(column.in_(ids)))).scalar_one()==0
    return {'new_accounts':len(names),'user_ids':ids,'projects_created':0,'accelerator_records_created':0,'dry_run':False}, credentials


async def run(args):
    from db_async import AsyncSessionLocal
    from models import User
    from credential_export import encrypt_export
    payload = json.loads(Path(args.payload).read_text(encoding='utf-8'))
    if set(payload) != {'usernames','export_public_key'}:
        raise ValueError('Invalid account provisioning payload')
    output = Path(args.output)
    if args.apply and output.exists():
        raise ValueError('Credential export already exists; refusing to overwrite')
    created_export = False
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                actor = await db.get(User,args.actor_id)
                result,credentials = await provision(db,actor=actor,usernames=payload['usernames'],apply=args.apply)
                if credentials:
                    envelope = encrypt_export({'credentials':credentials,'result':result},payload['export_public_key'])
                    output.parent.mkdir(parents=True,exist_ok=True)
                    fd = os.open(output,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
                    created_export = True
                    with os.fdopen(fd,'w',encoding='utf-8') as handle:
                        json.dump(envelope,handle)
    except BaseException:
        if created_export:
            output.unlink(missing_ok=True)
        raise
    print(json.dumps({k:v for k,v in result.items() if k!='user_ids'}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--payload',required=True)
    parser.add_argument('--actor-id',required=True,type=int)
    parser.add_argument('--output',required=True)
    parser.add_argument('--apply',action='store_true')
    try:
        asyncio.run(run(parser.parse_args()))
    except Exception as exc:
        print('Account provisioning failed: '+type(exc).__name__+': '+getattr(exc,'detail','Check the private payload and operation state'),file=sys.stderr)
        raise SystemExit(1)
