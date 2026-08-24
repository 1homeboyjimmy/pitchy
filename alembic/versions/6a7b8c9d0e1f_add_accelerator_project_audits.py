"""add accelerator project audits

Revision ID: 6a7b8c9d0e1f
Revises: 5f6a7b8c9d0e
"""
from alembic import op
import sqlalchemy as sa


revision = "6a7b8c9d0e1f"
down_revision = "5f6a7b8c9d0e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_project_audits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
        sa.Column("client_request_id", sa.String(64), nullable=False),
        sa.Column("audit_type", sa.String(30), nullable=False),
        sa.Column("focus", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("overall_score", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("quota_resource", sa.String(30), nullable=False, server_default="custdev"),
        sa.Column("quota_usage_event_id", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["quota_usage_event_id"], ["accelerator_quota_usage_events.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint(
            "membership_id", "client_request_id",
            name="uq_accelerator_project_audit_request",
        ),
    )
    for column in (
        "cohort_id", "membership_id", "project_id", "requested_by_user_id",
        "audit_type", "status", "created_at",
    ):
        op.create_index(
            f"ix_accelerator_project_audits_{column}",
            "accelerator_project_audits",
            [column],
        )

    op.create_table(
        "accelerator_project_audit_task_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("audit_id", sa.Integer(), nullable=False),
        sa.Column("recommendation_index", sa.Integer(), nullable=False),
        sa.Column("tracking_task_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["audit_id"], ["accelerator_project_audits.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["tracking_task_id"], ["accelerator_tracking_tasks.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint(
            "audit_id", "recommendation_index",
            name="uq_accelerator_project_audit_recommendation",
        ),
        sa.UniqueConstraint(
            "tracking_task_id", name="uq_accelerator_project_audit_task"
        ),
    )
    op.create_index(
        "ix_accelerator_project_audit_task_links_audit_id",
        "accelerator_project_audit_task_links",
        ["audit_id"],
    )
    op.create_index(
        "ix_accelerator_project_audit_task_links_tracking_task_id",
        "accelerator_project_audit_task_links",
        ["tracking_task_id"],
    )


def downgrade():
    op.drop_table("accelerator_project_audit_task_links")
    op.drop_table("accelerator_project_audits")
