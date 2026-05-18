"""Add privacy_consent_at and cookies_consent_at to users (GDPR-style consent record)

Revision ID: c9d4e5f6a7b8
Revises: b8c3d4e5f6a7
Create Date: 2026-05-18 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "c9d4e5f6a7b8"
down_revision = "b8c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("privacy_consent_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("cookies_consent_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("cookies_consent_at")
        batch_op.drop_column("privacy_consent_at")
