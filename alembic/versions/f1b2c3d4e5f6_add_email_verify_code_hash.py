"""Add email_verify_code_hash to User table

Revision ID: f1b2c3d4e5f6
Revises: e7b9e39bd123
Create Date: 2026-04-17 22:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1b2c3d4e5f6'
down_revision = 'e7b9e39bd123'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use batch_alter_table for better compatibility (especially with SQLite in tests)
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('email_verify_code_hash', sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('email_verify_code_hash')
