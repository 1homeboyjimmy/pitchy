"""Keep synthetic accelerator residents out of the platform user directory."""
from sqlalchemy import func, or_
from models import User


def real_platform_users():
    # Reserved, non-deliverable namespace used by the demonstration seed.
    # Keep null/legacy addresses: these may belong to real imported users.
    return or_(User.email.is_(None), ~func.lower(User.email).like('%@pitchy-demo.invalid'))
