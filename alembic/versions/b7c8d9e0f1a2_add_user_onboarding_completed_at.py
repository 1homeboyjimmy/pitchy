"""add user onboarding_completed_at

Revision ID: b7c8d9e0f1a2
Revises: a9c1e3f5b7d2
Create Date: 2026-06-29 15:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "a9c1e3f5b7d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("onboarding_completed_at", sa.DateTime(), nullable=True))

    op.execute("UPDATE users SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL")


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("onboarding_completed_at")
