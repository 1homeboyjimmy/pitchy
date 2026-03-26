"""add node_id to tree_chat_history

Revision ID: f1a2b3c4d5e6
Revises: eb9e8e2d4f5a
Create Date: 2026-03-26 17:20:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'eb9e8e2d4f5a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use batch_alter_table for compatibility
    with op.batch_alter_table('tree_chat_history', schema=None) as batch_op:
        batch_op.add_column(sa.Column('node_id', sa.String(length=50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tree_chat_history', schema=None) as batch_op:
        batch_op.drop_column('node_id')
