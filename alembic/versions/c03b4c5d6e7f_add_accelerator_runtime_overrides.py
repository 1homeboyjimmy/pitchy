"""add accelerator module runtime overrides

Revision ID: c03b4c5d6e7f
Revises: bf2a3b4c5d6e
"""
from alembic import op
import sqlalchemy as sa


revision = "c03b4c5d6e7f"
down_revision = "bf2a3b4c5d6e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_module_runtime_overrides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scope_type", sa.String(20), nullable=False),
        sa.Column("scope_key", sa.String(80), nullable=False),
        sa.Column("accelerator_id", sa.Integer(), nullable=True),
        sa.Column("cohort_id", sa.Integer(), nullable=True),
        sa.Column("module_key", sa.String(50), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["accelerator_id"], ["accelerators.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("scope_key", "module_key", name="uq_accelerator_runtime_scope_module"),
    )
    for column in (
        "scope_type", "scope_key", "accelerator_id", "cohort_id",
        "module_key", "expires_at",
    ):
        op.create_index(
            f"ix_accelerator_module_runtime_overrides_{column}",
            "accelerator_module_runtime_overrides",
            [column],
        )


def downgrade():
    op.drop_table("accelerator_module_runtime_overrides")
