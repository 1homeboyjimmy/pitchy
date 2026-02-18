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
    with op.batch_alter_table('chat_sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('analysis_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_chat_sessions_analyses', 'analyses', ['analysis_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('chat_sessions', schema=None) as batch_op:
        batch_op.drop_constraint('fk_chat_sessions_analyses', type_='foreignkey')
        batch_op.drop_column('analysis_id')
