"""add accelerator homework

Revision ID: 1b2c3d4e5f6a
Revises: 0a1b2c3d4e5f
"""
from alembic import op
import sqlalchemy as sa


revision = "1b2c3d4e5f6a"
down_revision = "0a1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_homework_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("audience", sa.String(30), nullable=False, server_default="cohort"),
        sa.Column("allow_resubmit", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_accelerator_homework_assignments_cohort_id", "accelerator_homework_assignments", ["cohort_id"])
    op.create_index("ix_accelerator_homework_assignments_due_at", "accelerator_homework_assignments", ["due_at"])
    op.create_index("ix_accelerator_homework_assignments_status", "accelerator_homework_assignments", ["status"])

    op.create_table(
        "accelerator_homework_targets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["accelerator_homework_assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("assignment_id", "membership_id", name="uq_accelerator_homework_target_membership"),
    )
    op.create_index("ix_accelerator_homework_targets_assignment_id", "accelerator_homework_targets", ["assignment_id"])
    op.create_index("ix_accelerator_homework_targets_membership_id", "accelerator_homework_targets", ["membership_id"])

    op.create_table(
        "accelerator_homework_submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=True),
        sa.Column("attachments", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="submitted"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["accelerator_homework_assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("assignment_id", "membership_id", name="uq_accelerator_homework_submission_membership"),
    )
    op.create_index("ix_accelerator_homework_submissions_assignment_id", "accelerator_homework_submissions", ["assignment_id"])
    op.create_index("ix_accelerator_homework_submissions_membership_id", "accelerator_homework_submissions", ["membership_id"])
    op.create_index("ix_accelerator_homework_submissions_status", "accelerator_homework_submissions", ["status"])
    op.create_index("ix_accelerator_homework_submissions_submitted_at", "accelerator_homework_submissions", ["submitted_at"])


def downgrade():
    op.drop_table("accelerator_homework_submissions")
    op.drop_table("accelerator_homework_targets")
    op.drop_table("accelerator_homework_assignments")
