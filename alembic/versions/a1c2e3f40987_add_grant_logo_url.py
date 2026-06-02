"""Grants: add logo_url column

Revision ID: a1c2e3f40987
Revises: f2a7b8c9d0e1
Create Date: 2026-06-02 15:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "a1c2e3f40987"
down_revision = "f2a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grants", sa.Column("logo_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("grants", "logo_url")
