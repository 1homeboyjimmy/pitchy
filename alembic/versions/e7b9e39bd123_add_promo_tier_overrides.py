"""Add promo tier overrides

Revision ID: e7b9e39bd123
Revises: db92e39bd99e
Create Date: 2026-04-15 17:42:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e7b9e39bd123'
down_revision = 'db92e39bd99e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('promocodes', schema=None) as batch_op:
        batch_op.add_column(sa.Column('target_tier', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('fixed_price', sa.Numeric(precision=10, scale=2), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('promocodes', schema=None) as batch_op:
        batch_op.drop_column('fixed_price')
        batch_op.drop_column('target_tier')
