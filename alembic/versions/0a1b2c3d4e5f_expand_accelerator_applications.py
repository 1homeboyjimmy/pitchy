"""expand accelerator applications and organizations

Revision ID: 0a1b2c3d4e5f
Revises: f3a4b5c6d7e8
"""
from alembic import op
import sqlalchemy as sa


revision = "0a1b2c3d4e5f"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_organizations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_accelerator_organizations_slug", "accelerator_organizations", ["slug"], unique=True)
    op.create_index("ix_accelerator_organizations_status", "accelerator_organizations", ["status"])

    with op.batch_alter_table("accelerators") as batch:
        batch.add_column(sa.Column("organization_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_accelerators_organization_id_accelerator_organizations", "accelerator_organizations", ["organization_id"], ["id"], ondelete="RESTRICT")
        batch.create_index("ix_accelerators_organization_id", ["organization_id"])

    with op.batch_alter_table("accelerator_applications") as batch:
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("project_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("applicant_name", sa.String(200), nullable=True))
        batch.add_column(sa.Column("applicant_email", sa.String(255), nullable=True))
        batch.add_column(sa.Column("application_type", sa.String(30), nullable=False, server_default="project"))
        batch.add_column(sa.Column("privacy_consent_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("program_rules_consent_at", sa.DateTime(), nullable=True))
        batch.create_foreign_key("fk_accelerator_applications_project_id_projects", "projects", ["project_id"], ["id"], ondelete="SET NULL")
        batch.create_unique_constraint("uq_accelerator_application_email", ["cohort_id", "applicant_email"])
        batch.create_index("ix_accelerator_applications_project_id", ["project_id"])
        batch.create_index("ix_accelerator_applications_applicant_email", ["applicant_email"])

    with op.batch_alter_table("accelerator_memberships") as batch:
        batch.add_column(sa.Column("project_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_accelerator_memberships_project_id_projects", "projects", ["project_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_accelerator_memberships_project_id", ["project_id"])

    with op.batch_alter_table("accelerator_audit_logs") as batch:
        batch.drop_constraint("fk_accelerator_audit_logs_actor_user_id_users", type_="foreignkey")
        batch.alter_column("actor_user_id", existing_type=sa.Integer(), nullable=True)
        batch.create_foreign_key("fk_accelerator_audit_logs_actor_user_id_users", "users", ["actor_user_id"], ["id"], ondelete="SET NULL")

    op.create_table(
        "accelerator_application_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("from_status", sa.String(30), nullable=True),
        sa.Column("to_status", sa.String(30), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["accelerator_applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_accelerator_application_events_application_id", "accelerator_application_events", ["application_id"])
    op.create_index("ix_accelerator_application_events_to_status", "accelerator_application_events", ["to_status"])
    op.create_index("ix_accelerator_application_events_actor_user_id", "accelerator_application_events", ["actor_user_id"])
    op.create_index("ix_accelerator_application_events_created_at", "accelerator_application_events", ["created_at"])

    op.create_table(
        "accelerator_participant_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("profile", sa.JSON(), nullable=False),
        sa.Column("visibility", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("membership_id", name="uq_accelerator_participant_profile_membership"),
    )
    op.create_index("ix_accelerator_participant_profiles_membership_id", "accelerator_participant_profiles", ["membership_id"], unique=True)

    op.create_table(
        "accelerator_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["accelerator_applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("application_id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_accelerator_invitations_application_id", "accelerator_invitations", ["application_id"], unique=True)
    op.create_index("ix_accelerator_invitations_user_id", "accelerator_invitations", ["user_id"])
    op.create_index("ix_accelerator_invitations_token_hash", "accelerator_invitations", ["token_hash"], unique=True)
    op.create_index("ix_accelerator_invitations_expires_at", "accelerator_invitations", ["expires_at"])

    op.create_table(
        "accelerator_notification_outbox",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("accelerator_id", sa.Integer(), nullable=False),
        sa.Column("cohort_id", sa.Integer(), nullable=True),
        sa.Column("recipient_email", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("subject", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["accelerator_id"], ["accelerators.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_accelerator_notification_outbox_accelerator_id", "accelerator_notification_outbox", ["accelerator_id"])
    op.create_index("ix_accelerator_notification_outbox_cohort_id", "accelerator_notification_outbox", ["cohort_id"])
    op.create_index("ix_accelerator_notification_outbox_recipient_email", "accelerator_notification_outbox", ["recipient_email"])
    op.create_index("ix_accelerator_notification_outbox_event_type", "accelerator_notification_outbox", ["event_type"])
    op.create_index("ix_accelerator_notification_outbox_status", "accelerator_notification_outbox", ["status"])
    op.create_index("ix_accelerator_notification_outbox_idempotency_key", "accelerator_notification_outbox", ["idempotency_key"], unique=True)
    op.create_index("ix_accelerator_notification_outbox_available_at", "accelerator_notification_outbox", ["available_at"])


def downgrade():
    op.drop_table("accelerator_notification_outbox")
    op.drop_table("accelerator_invitations")
    op.drop_table("accelerator_participant_profiles")
    op.drop_table("accelerator_application_events")
    with op.batch_alter_table("accelerator_audit_logs") as batch:
        batch.drop_constraint("fk_accelerator_audit_logs_actor_user_id_users", type_="foreignkey")
        batch.alter_column("actor_user_id", existing_type=sa.Integer(), nullable=False)
        batch.create_foreign_key("fk_accelerator_audit_logs_actor_user_id_users", "users", ["actor_user_id"], ["id"], ondelete="RESTRICT")
    with op.batch_alter_table("accelerator_memberships") as batch:
        batch.drop_index("ix_accelerator_memberships_project_id")
        batch.drop_constraint("fk_accelerator_memberships_project_id_projects", type_="foreignkey")
        batch.drop_column("project_id")
    with op.batch_alter_table("accelerator_applications") as batch:
        batch.drop_index("ix_accelerator_applications_applicant_email")
        batch.drop_index("ix_accelerator_applications_project_id")
        batch.drop_constraint("uq_accelerator_application_email", type_="unique")
        batch.drop_constraint("fk_accelerator_applications_project_id_projects", type_="foreignkey")
        batch.drop_column("program_rules_consent_at")
        batch.drop_column("privacy_consent_at")
        batch.drop_column("application_type")
        batch.drop_column("applicant_email")
        batch.drop_column("applicant_name")
        batch.drop_column("project_id")
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=False)
    with op.batch_alter_table("accelerators") as batch:
        batch.drop_index("ix_accelerators_organization_id")
        batch.drop_constraint("fk_accelerators_organization_id_accelerator_organizations", type_="foreignkey")
        batch.drop_column("organization_id")
    op.drop_table("accelerator_organizations")
