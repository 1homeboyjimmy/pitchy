"""add thoughts column

Revision ID: eb9e8e2d4f5a
Revises: fc256ba6b137
Create Date: 2026-03-24 07:07:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'eb9e8e2d4f5a'
down_revision = 'fc256ba6b137'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use batch_alter_table for SQLite compatibility and robust alteration
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('thoughts', sa.Text(), nullable=True))

    with op.batch_alter_table('tree_chat_history', schema=None) as batch_op:
        batch_op.add_column(sa.Column('thoughts', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tree_chat_history', schema=None) as batch_op:
        batch_op.drop_column('thoughts')

    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.drop_column('thoughts')
