"""Grants: add category (тип программы)

Revision ID: e7a1b2c3d4f5
Revises: d4f6a8b0c2e3
Create Date: 2026-06-12 10:00:00.000000

Категория программы для разбивки каталога: grant / contest / accelerator /
event / pitch / support_measure / investor. Существующие записи — это гранты,
поэтому server_default='grant' (бэкафилл без потери данных).
"""
from alembic import op
import sqlalchemy as sa


revision = "e7a1b2c3d4f5"
down_revision = "d4f6a8b0c2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "grants",
        sa.Column("category", sa.String(length=30), nullable=False, server_default="grant"),
    )
    op.create_index("ix_grants_category", "grants", ["category"])


def downgrade() -> None:
    op.drop_index("ix_grants_category", table_name="grants")
    op.drop_column("grants", "category")
