"""add accelerator demo day

Revision ID: 7b8c9d0e1f2a
Revises: 6a7b8c9d0e1f
"""
from alembic import op
import sqlalchemy as sa


revision = "7b8c9d0e1f2a"
down_revision = "6a7b8c9d0e1f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_demo_days",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("criteria", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("finalized_by_user_id", sa.Integer(), nullable=True),
        sa.Column("finalized_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["finalized_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    for column in ("cohort_id", "starts_at", "status", "created_at"):
        op.create_index(f"ix_accelerator_demo_days_{column}", "accelerator_demo_days", [column])

    op.create_table(
        "accelerator_demo_day_experts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("demo_day_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("invited_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["demo_day_id"], ["accelerator_demo_days.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("demo_day_id", "user_id", name="uq_accelerator_demo_day_expert"),
    )
    op.create_index("ix_accelerator_demo_day_experts_demo_day_id", "accelerator_demo_day_experts", ["demo_day_id"])
    op.create_index("ix_accelerator_demo_day_experts_user_id", "accelerator_demo_day_experts", ["user_id"])

    op.create_table(
        "accelerator_demo_day_projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("demo_day_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("selected_by_user_id", sa.Integer(), nullable=False),
        sa.Column("selection_reason", sa.Text(), nullable=True),
        sa.Column("pitch_title", sa.String(300), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("presentation_url", sa.Text(), nullable=True),
        sa.Column("video_url", sa.Text(), nullable=True),
        sa.Column("attachments", sa.JSON(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("score_adjustment", sa.Numeric(6, 2), nullable=False, server_default="0"),
        sa.Column("manager_note", sa.Text(), nullable=True),
        sa.Column("outcome", sa.String(30), nullable=False, server_default="participant"),
        sa.Column("final_score", sa.Numeric(6, 2), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["demo_day_id"], ["accelerator_demo_days.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["selected_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("demo_day_id", "membership_id", name="uq_accelerator_demo_day_membership"),
    )
    for column in ("demo_day_id", "membership_id", "project_id", "outcome", "rank"):
        op.create_index(f"ix_accelerator_demo_day_projects_{column}", "accelerator_demo_day_projects", [column])

    op.create_table(
        "accelerator_demo_day_scores",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("demo_project_id", sa.Integer(), nullable=False),
        sa.Column("expert_user_id", sa.Integer(), nullable=False),
        sa.Column("scores", sa.JSON(), nullable=False),
        sa.Column("normalized_score", sa.Numeric(6, 2), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("recommendation", sa.String(20), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["demo_project_id"], ["accelerator_demo_day_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["expert_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("demo_project_id", "expert_user_id", name="uq_accelerator_demo_day_score"),
    )
    op.create_index("ix_accelerator_demo_day_scores_demo_project_id", "accelerator_demo_day_scores", ["demo_project_id"])
    op.create_index("ix_accelerator_demo_day_scores_expert_user_id", "accelerator_demo_day_scores", ["expert_user_id"])
    op.create_index("ix_accelerator_demo_day_scores_recommendation", "accelerator_demo_day_scores", ["recommendation"])


def downgrade():
    op.drop_table("accelerator_demo_day_scores")
    op.drop_table("accelerator_demo_day_projects")
    op.drop_table("accelerator_demo_day_experts")
    op.drop_table("accelerator_demo_days")
