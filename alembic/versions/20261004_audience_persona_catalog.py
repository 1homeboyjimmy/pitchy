"""Add the persistent persona catalog for audience simulations.

Revision ID: 20261004_personas
Revises: e81a2b3c4d5e
"""

from alembic import op
import sqlalchemy as sa


revision = "20261004_personas"
down_revision = "e81a2b3c4d5e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "audience_simulation_personas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dataset_id", sa.String(100), nullable=False),
        sa.Column("persona_id", sa.String(40), nullable=False),
        sa.Column("profile_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("market", sa.String(30), nullable=False),
        sa.Column("profile_label", sa.String(240), nullable=False),
        sa.Column("profile_data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "dataset_id", "persona_id",
            name="uq_audience_sim_personas_dataset_persona",
        ),
    )
    op.create_index(
        "ix_audience_sim_personas_dataset_market",
        "audience_simulation_personas",
        ["dataset_id", "market"],
    )
    op.create_index(
        "ix_audience_sim_personas_dataset_label",
        "audience_simulation_personas",
        ["dataset_id", "profile_label"],
    )


def downgrade():
    op.drop_index("ix_audience_sim_personas_dataset_label", table_name="audience_simulation_personas")
    op.drop_index("ix_audience_sim_personas_dataset_market", table_name="audience_simulation_personas")
    op.drop_table("audience_simulation_personas")
