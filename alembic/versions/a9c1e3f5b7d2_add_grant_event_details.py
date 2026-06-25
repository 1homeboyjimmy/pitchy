"""Grants: add rich event details and canonical links.

Revision ID: a9c1e3f5b7d2
Revises: b7e4c2a9d1f0
Create Date: 2026-06-17 15:00:00.000000

Перецеплено на голову main b7e4c2a9d1f0 (configurable_subscriptions) при
переносе фичи Unicorn Road с dev: на dev down_revision был f8b2c4d6e0a1,
но на main у этой ревизии уже есть потомок — иначе было бы две головы.
Колонки добавляются в grants, от подписок не зависят — порядок безопасен.
"""
from alembic import op
import sqlalchemy as sa


revision = "a9c1e3f5b7d2"
down_revision = "b7e4c2a9d1f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grants", sa.Column("source_url", sa.Text(), nullable=True))
    op.add_column("grants", sa.Column("registration_url", sa.Text(), nullable=True))
    op.add_column("grants", sa.Column("event_format", sa.String(length=20), nullable=True))
    op.add_column("grants", sa.Column("event_details", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("grants", "event_details")
    op.drop_column("grants", "event_format")
    op.drop_column("grants", "registration_url")
    op.drop_column("grants", "source_url")
