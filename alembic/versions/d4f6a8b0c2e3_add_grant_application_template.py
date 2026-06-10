"""Grants: add application_template column

Revision ID: d4f6a8b0c2e3
Revises: c3e5f7a9d1f2
Create Date: 2026-06-10 12:00:00.000000

Шаблон заявки «под конкретный грант» (структура разделов: что статично из
положения, что генерит LLM, что заполняет пользователь). NULL — используется
дефолтный шаблон из кода (grant_templates.select_application_template).
Аддитивная миграция, данные не трогаем.
"""
from alembic import op
import sqlalchemy as sa


revision = "d4f6a8b0c2e3"
down_revision = "c3e5f7a9d1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grants", sa.Column("application_template", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("grants", "application_template")
