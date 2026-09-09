"""Add auditable accelerator closure exceptions.

Revision ID: c69d0e1f2a3b
Revises: b58c9d0e1f2a
"""

from alembic import op
import sqlalchemy as sa


revision = "c69d0e1f2a3b"
down_revision = "b58c9d0e1f2a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_closure_exceptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("closure_id", sa.Integer(), sa.ForeignKey("accelerator_cohort_closures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("blocker_key", sa.String(length=80), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("closure_id", "blocker_key", name="uq_accelerator_closure_exception_key"),
    )
    for column in ("closure_id", "blocker_key", "created_by_user_id"):
        op.create_index(f"ix_accelerator_closure_exceptions_{column}", "accelerator_closure_exceptions", [column])


def downgrade():
    for column in ("created_by_user_id", "blocker_key", "closure_id"):
        op.drop_index(f"ix_accelerator_closure_exceptions_{column}", table_name="accelerator_closure_exceptions")
    op.drop_table("accelerator_closure_exceptions")
