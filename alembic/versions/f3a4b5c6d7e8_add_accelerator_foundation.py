"""add accelerator foundation

Revision ID: f3a4b5c6d7e8
Revises: a8c9d0e1f2b3
"""
from alembic import op
import sqlalchemy as sa


revision = "f3a4b5c6d7e8"
down_revision = ("a8c9d0e1f2b3", "20260812_payment_provider")
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerators",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("organization", sa.String(200), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_accelerators_status", "accelerators", ["status"])
    op.create_index("ix_accelerators_created_by_user_id", "accelerators", ["created_by_user_id"])

    op.create_table(
        "accelerator_staff",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("accelerator_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(30), nullable=False, server_default="organizer"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["accelerator_id"], ["accelerators.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("accelerator_id", "user_id", name="uq_accelerator_staff_user"),
    )
    op.create_index("ix_accelerator_staff_accelerator_id", "accelerator_staff", ["accelerator_id"])
    op.create_index("ix_accelerator_staff_user_id", "accelerator_staff", ["user_id"])

    op.create_table(
        "accelerator_cohorts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("accelerator_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("timezone", sa.String(80), nullable=False, server_default="Europe/Moscow"),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("application_form_schema", sa.JSON(), nullable=False),
        sa.Column("default_quota_config", sa.JSON(), nullable=True),
        sa.Column("default_quota_updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["accelerator_id"], ["accelerators.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["default_quota_updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_accelerator_cohorts_accelerator_id", "accelerator_cohorts", ["accelerator_id"])
    op.create_index("ix_accelerator_cohorts_status", "accelerator_cohorts", ["status"])

    op.create_table(
        "accelerator_program_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("modules", sa.JSON(), nullable=False),
        sa.Column("locked_modules", sa.JSON(), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("cohort_id", name="uq_accelerator_program_config_cohort"),
    )
    op.create_index("ix_accelerator_program_configs_cohort_id", "accelerator_program_configs", ["cohort_id"], unique=True)

    op.create_table(
        "accelerator_applications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="submitted"),
        sa.Column("form_payload", sa.JSON(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("cohort_id", "user_id", name="uq_accelerator_application_user"),
    )
    op.create_index("ix_accelerator_applications_cohort_id", "accelerator_applications", ["cohort_id"])
    op.create_index("ix_accelerator_applications_user_id", "accelerator_applications", ["user_id"])
    op.create_index("ix_accelerator_applications_status", "accelerator_applications", ["status"])

    op.create_table(
        "accelerator_memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("role", sa.String(30), nullable=False, server_default="resident"),
        sa.Column("status", sa.String(30), nullable=False, server_default="accepted"),
        sa.Column("accepted_by_user_id", sa.Integer(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(), nullable=False),
        sa.Column("enrolled_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["application_id"], ["accelerator_applications.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["accepted_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("cohort_id", "user_id", name="uq_accelerator_membership_user"),
    )
    op.create_index("ix_accelerator_memberships_cohort_id", "accelerator_memberships", ["cohort_id"])
    op.create_index("ix_accelerator_memberships_user_id", "accelerator_memberships", ["user_id"])
    op.create_index("ix_accelerator_memberships_status", "accelerator_memberships", ["status"])

    op.create_table(
        "accelerator_resident_quota_overrides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("limits", sa.JSON(), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("superseded_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_accelerator_resident_quota_overrides_membership_id", "accelerator_resident_quota_overrides", ["membership_id"])
    op.create_index("ix_accelerator_resident_quota_overrides_starts_at", "accelerator_resident_quota_overrides", ["starts_at"])
    op.create_index("ix_accelerator_resident_quota_overrides_ends_at", "accelerator_resident_quota_overrides", ["ends_at"])
    op.create_index("ix_accelerator_resident_quota_overrides_superseded_at", "accelerator_resident_quota_overrides", ["superseded_at"])

    op.create_table(
        "accelerator_quota_usage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("quota_override_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("resource", sa.String(30), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("reference_type", sa.String(50), nullable=True),
        sa.Column("reference_id", sa.String(255), nullable=True),
        sa.Column("event_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quota_override_id"], ["accelerator_resident_quota_overrides.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("idempotency_key", name="uq_accelerator_quota_usage_idempotency"),
    )
    op.create_index("ix_accelerator_quota_usage_events_membership_id", "accelerator_quota_usage_events", ["membership_id"])
    op.create_index("ix_accelerator_quota_usage_events_quota_override_id", "accelerator_quota_usage_events", ["quota_override_id"])
    op.create_index("ix_accelerator_quota_usage_events_user_id", "accelerator_quota_usage_events", ["user_id"])
    op.create_index("ix_accelerator_quota_usage_events_resource", "accelerator_quota_usage_events", ["resource"])
    op.create_index("ix_accelerator_quota_usage_events_created_at", "accelerator_quota_usage_events", ["created_at"])

    op.create_table(
        "accelerator_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("accelerator_id", sa.Integer(), nullable=False),
        sa.Column("cohort_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("target_type", sa.String(50), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["accelerator_id"], ["accelerators.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_accelerator_audit_logs_accelerator_id", "accelerator_audit_logs", ["accelerator_id"])
    op.create_index("ix_accelerator_audit_logs_cohort_id", "accelerator_audit_logs", ["cohort_id"])
    op.create_index("ix_accelerator_audit_logs_actor_user_id", "accelerator_audit_logs", ["actor_user_id"])
    op.create_index("ix_accelerator_audit_logs_action", "accelerator_audit_logs", ["action"])
    op.create_index("ix_accelerator_audit_logs_created_at", "accelerator_audit_logs", ["created_at"])


def downgrade():
    op.drop_table("accelerator_audit_logs")
    op.drop_table("accelerator_quota_usage_events")
    op.drop_table("accelerator_resident_quota_overrides")
    op.drop_table("accelerator_memberships")
    op.drop_table("accelerator_applications")
    op.drop_table("accelerator_program_configs")
    op.drop_table("accelerator_cohorts")
    op.drop_table("accelerator_staff")
    op.drop_table("accelerators")
