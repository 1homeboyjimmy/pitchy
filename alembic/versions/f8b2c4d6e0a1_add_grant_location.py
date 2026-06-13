"""Grants: add location (площадка/город мероприятия)

Revision ID: f8b2c4d6e0a1
Revises: e7a1b2c3d4f5
Create Date: 2026-06-13 10:00:00.000000

Локация программы: точный адрес очного мероприятия («Место проведения: …»)
или город/формат («Москва», «Онлайн»). Отображается у справочных категорий
(мероприятия/питчи). NULL — локация не указана. Аддитивно.
"""
from alembic import op
import sqlalchemy as sa


revision = "f8b2c4d6e0a1"
down_revision = "e7a1b2c3d4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grants", sa.Column("location", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("grants", "location")
