"""add accelerator progress tracking

Revision ID: 4e5f6a7b8c9d
Revises: 3d4e5f6a7b8c
"""
from alembic import op
import sqlalchemy as sa


revision = "4e5f6a7b8c9d"
down_revision = "3d4e5f6a7b8c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_progress_checkins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("health", sa.String(20), nullable=False, server_default="green"),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("blockers", sa.Text(), nullable=True),
        sa.Column("next_steps", sa.Text(), nullable=False),
        sa.Column("help_needed", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("membership_id", "period_start", name="uq_accelerator_checkin_membership_period"),
    )
    op.create_index("ix_accelerator_progress_checkins_membership_id", "accelerator_progress_checkins", ["membership_id"])
    op.create_index("ix_accelerator_progress_checkins_author_user_id", "accelerator_progress_checkins", ["author_user_id"])
    op.create_index("ix_accelerator_progress_checkins_period_start", "accelerator_progress_checkins", ["period_start"])
    op.create_index("ix_accelerator_progress_checkins_health", "accelerator_progress_checkins", ["health"])
    op.create_index("ix_accelerator_progress_checkins_created_at", "accelerator_progress_checkins", ["created_at"])

    op.create_table(
        "accelerator_tracking_feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_accelerator_tracking_feedback_membership_id", "accelerator_tracking_feedback", ["membership_id"])
    op.create_index("ix_accelerator_tracking_feedback_author_user_id", "accelerator_tracking_feedback", ["author_user_id"])
    op.create_index("ix_accelerator_tracking_feedback_created_at", "accelerator_tracking_feedback", ["created_at"])

    op.create_table(
        "accelerator_tracking_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("completed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["completed_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_accelerator_tracking_tasks_membership_id", "accelerator_tracking_tasks", ["membership_id"])
    op.create_index("ix_accelerator_tracking_tasks_created_by_user_id", "accelerator_tracking_tasks", ["created_by_user_id"])
    op.create_index("ix_accelerator_tracking_tasks_status", "accelerator_tracking_tasks", ["status"])
    op.create_index("ix_accelerator_tracking_tasks_due_at", "accelerator_tracking_tasks", ["due_at"])


def downgrade():
    op.drop_table("accelerator_tracking_tasks")
    op.drop_table("accelerator_tracking_feedback")
    op.drop_table("accelerator_progress_checkins")
