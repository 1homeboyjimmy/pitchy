"""add grant sources + moderation queue

Авто-обнаружение грантов (#20):
- таблица grant_sources — официальные источники, которые админ добавляет
  в админке; фоновый обходчик парсит их раз в сутки;
- grants.moderation — статус модерации найденных программ. Старые/ручные
  гранты получают server_default='approved', поэтому остаются видимыми;
  краулер кладёт новые как 'pending' (видны только в очереди модерации);
- grants.source_id — какой источник нашёл грант (provenance, nullable).

Полностью аддитивная миграция: ничего не удаляет и не переписывает.

Revision ID: c3e5f7a9d1f2
Revises: b2d4f6a8c0e1
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa


revision = "c3e5f7a9d1f2"
down_revision = "b2d4f6a8c0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grant_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="listing"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("max_items", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("last_crawled_at", sa.DateTime(), nullable=True),
        sa.Column("last_status", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.add_column(
        "grants",
        sa.Column("moderation", sa.String(length=20), nullable=False, server_default="approved"),
    )
    op.create_index("ix_grants_moderation", "grants", ["moderation"])

    op.add_column("grants", sa.Column("source_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_grants_source_id_grant_sources",
        "grants",
        "grant_sources",
        ["source_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_grants_source_id_grant_sources", "grants", type_="foreignkey")
    op.drop_column("grants", "source_id")
    op.drop_index("ix_grants_moderation", table_name="grants")
    op.drop_column("grants", "moderation")
    op.drop_table("grant_sources")
