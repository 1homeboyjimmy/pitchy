"""Widen rag_logs.source_url to Text (was VARCHAR(500))

URLs with a text-fragment selector (#:~:text=...) routinely exceed
500 bytes once the Russian fragment is percent-encoded, e.g. the
economy.gov.ru URLs that recently caused 500 on /admin/rag/add-url.

Revision ID: a7b1c2d3e4f5
Revises: f1b2c3d4e5f6
Create Date: 2026-05-15 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a7b1c2d3e4f5'
down_revision = 'f1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    # batch_alter_table: на postgres это обычный ALTER, на sqlite (тестовая
    # БД conftest) — пересоздание таблицы; голый op.alter_column падал там
    # с "near ALTER: syntax error" и валил весь тестовый прогон.
    with op.batch_alter_table('rag_logs') as batch_op:
        batch_op.alter_column(
            'source_url',
            existing_type=sa.String(length=500),
            type_=sa.Text(),
            existing_nullable=False,
        )


def downgrade():
    # Lossy: rows with source_url > 500 chars will be truncated.
    with op.batch_alter_table('rag_logs') as batch_op:
        batch_op.alter_column(
            'source_url',
            existing_type=sa.Text(),
            type_=sa.String(length=500),
            existing_nullable=False,
        )
