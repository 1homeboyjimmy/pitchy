"""Soft-delete for users: add deleted_at column

Revision ID: d0e5f6a7b8c9
Revises: c9d4e5f6a7b8
Create Date: 2026-05-18 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "d0e5f6a7b8c9"
down_revision = "c9d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
        batch_op.create_index("ix_users_deleted_at", ["deleted_at"])


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index("ix_users_deleted_at")
        batch_op.drop_column("deleted_at")
