"""add explainable accelerator program progress fields

Revision ID: 20260913_program_progress_engine
Revises: 20260913_audit_message_quota
"""
from alembic import op
import sqlalchemy as sa


revision = "20260913_program_progress_engine"
down_revision = "20260913_audit_message_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("accelerator_program_stages") as batch_op:
        batch_op.add_column(sa.Column("due_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("completion_policy", sa.JSON(), server_default=sa.text("'{}'"), nullable=False))
        batch_op.create_index("ix_accelerator_program_stages_due_at", ["due_at"])
    with op.batch_alter_table("accelerator_program_stage_progress") as batch_op:
        batch_op.add_column(sa.Column("completion_source", sa.String(length=20), server_default="manual", nullable=False))
        batch_op.add_column(sa.Column("waiver_reason", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("completed_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("last_evaluated_at", sa.DateTime(), nullable=True))
        batch_op.create_index("ix_accelerator_program_stage_progress_completion_source", ["completion_source"])
        batch_op.create_foreign_key("fk_stage_progress_completed_by", "users", ["completed_by_user_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("accelerator_program_stage_progress") as batch_op:
        batch_op.drop_constraint("fk_stage_progress_completed_by", type_="foreignkey")
        batch_op.drop_index("ix_accelerator_program_stage_progress_completion_source")
        batch_op.drop_column("last_evaluated_at")
        batch_op.drop_column("completed_by_user_id")
        batch_op.drop_column("waiver_reason")
        batch_op.drop_column("completion_source")
    with op.batch_alter_table("accelerator_program_stages") as batch_op:
        batch_op.drop_index("ix_accelerator_program_stages_due_at")
        batch_op.drop_column("completion_policy")
        batch_op.drop_column("due_at")
