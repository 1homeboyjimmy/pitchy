"""add rag logs

Revision ID: d126ebef2049
Revises: db92e39bd99e
Create Date: 2026-02-24 23:21:50.657320

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd126ebef2049'
down_revision = 'db92e39bd99e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'rag_logs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source_url', sa.String(length=500), nullable=False),
        sa.Column('source_type', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('chunks_added', sa.Integer(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('rag_logs')
