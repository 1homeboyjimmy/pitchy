"""Grant applications: add CRM pipeline stage

Revision ID: b2d4f6a8c0e1
Revises: a1c2e3f40987
Create Date: 2026-06-03 14:40:00.000000

CRM «Мои гранты»: добавляем колонку stage — стадию воронки заявки, отдельно
от content-lifecycle `status` (draft/generated/submitted). stage отвечает за
канбан: interested → preparing → submitted → won/rejected.

Миграция аддитивная: существующие заявки получают server_default='preparing',
а уже поданные переносим в 'submitted', чтобы канбан был осмысленным сразу.
Данные не теряются.
"""
from alembic import op
import sqlalchemy as sa


revision = "b2d4f6a8c0e1"
down_revision = "a1c2e3f40987"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "grant_applications",
        sa.Column("stage", sa.String(length=30), nullable=False, server_default="preparing"),
    )
    # Бэкофилл: уже поданные заявки сразу в колонку «Подана».
    op.execute("UPDATE grant_applications SET stage = 'submitted' WHERE status = 'submitted'")


def downgrade() -> None:
    op.drop_column("grant_applications", "stage")
