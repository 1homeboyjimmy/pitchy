"""Seed the RESEARCH promo code.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-07-28 12:30:00.000000

"""
from datetime import datetime
from decimal import Decimal

from alembic import op
import sqlalchemy as sa


revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


promo_codes = sa.table(
    "promocodes",
    sa.column("code", sa.String(length=50)),
    sa.column("discount_percent", sa.Integer()),
    sa.column("target_tier", sa.String(length=50)),
    sa.column("fixed_price", sa.Numeric(precision=10, scale=2)),
    sa.column("max_uses", sa.Integer()),
    sa.column("current_uses", sa.Integer()),
    sa.column("expires_at", sa.DateTime()),
    sa.column("created_at", sa.DateTime()),
)


def upgrade() -> None:
    bind = op.get_bind()
    exists = bind.execute(
        sa.select(promo_codes.c.code).where(promo_codes.c.code == "RESEARCH")
    ).scalar_one_or_none()
    if exists is not None:
        return

    bind.execute(
        promo_codes.insert().values(
            code="RESEARCH",
            discount_percent=100,
            target_tier="research",
            fixed_price=Decimal("1.00"),
            max_uses=None,
            current_uses=0,
            expires_at=None,
            created_at=datetime.utcnow(),
        )
    )


def downgrade() -> None:
    # Preserve business data: payments may already reference this promo code.
    pass
