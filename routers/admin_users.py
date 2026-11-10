"""Administrator account directory, including imported and legacy accounts."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_async_admin
from db_async import get_async_db
from models import User
from schemas import AdminUserResponse

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[AdminUserResponse])
async def admin_users(
    _: User = Depends(require_async_admin),
    db: AsyncSession = Depends(get_async_db),
) -> list[AdminUserResponse]:
    users = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return [AdminUserResponse.model_validate(user) for user in users]
