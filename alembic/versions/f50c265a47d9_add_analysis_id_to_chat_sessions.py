"""add_analysis_id_to_chat_sessions

Revision ID: f50c265a47d9
Revises: 9c0f2d889e6b
Create Date: 2026-02-18 19:10:35.675902

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f50c265a47d9'
down_revision = '9c0f2d889e6b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('chat_sessions', sa.Column('analysis_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'chat_sessions', 'analyses', ['analysis_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint(None, 'chat_sessions', type_='foreignkey')
    op.drop_column('chat_sessions', 'analysis_id')
