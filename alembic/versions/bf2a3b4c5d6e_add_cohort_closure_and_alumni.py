"""add cohort closure snapshots and opt-in alumni

Revision ID: bf2a3b4c5d6e
Revises: ae1f2a3b4c5d
"""
from alembic import op
import sqlalchemy as sa


revision = "bf2a3b4c5d6e"
down_revision = "ae1f2a3b4c5d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_cohort_closures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="preparing"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("completed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["completed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("cohort_id", name="uq_accelerator_cohort_closure_cohort"),
    )
    op.create_index("ix_accelerator_cohort_closures_cohort_id", "accelerator_cohort_closures", ["cohort_id"])
    op.create_index("ix_accelerator_cohort_closures_status", "accelerator_cohort_closures", ["status"])

    op.create_table(
        "accelerator_membership_closure_decisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("closure_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["closure_id"], ["accelerator_cohort_closures.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("closure_id", "membership_id", name="uq_accelerator_closure_membership_decision"),
    )
    op.create_index("ix_accelerator_membership_closure_decisions_closure_id", "accelerator_membership_closure_decisions", ["closure_id"])
    op.create_index("ix_accelerator_membership_closure_decisions_membership_id", "accelerator_membership_closure_decisions", ["membership_id"])
    op.create_index("ix_accelerator_membership_closure_decisions_outcome", "accelerator_membership_closure_decisions", ["outcome"])

    op.create_table(
        "accelerator_resident_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("closure_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["closure_id"], ["accelerator_cohort_closures.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("closure_id", "membership_id", name="uq_accelerator_closure_membership_snapshot"),
    )
    for column in ("closure_id", "membership_id", "project_id", "checksum"):
        op.create_index(f"ix_accelerator_resident_snapshots_{column}", "accelerator_resident_snapshots", [column])

    op.create_table(
        "accelerator_alumni_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("headline", sa.String(200), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("achievements", sa.JSON(), nullable=False),
        sa.Column("expertise", sa.JSON(), nullable=False),
        sa.Column("interests", sa.JSON(), nullable=False),
        sa.Column("contact_url", sa.String(500), nullable=True),
        sa.Column("consented_at", sa.DateTime(), nullable=False),
        sa.Column("opted_out_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("membership_id", name="uq_accelerator_alumni_profile_membership"),
    )
    op.create_index("ix_accelerator_alumni_profiles_membership_id", "accelerator_alumni_profiles", ["membership_id"])
    op.create_index("ix_accelerator_alumni_profiles_active", "accelerator_alumni_profiles", ["active"])

    op.create_table(
        "accelerator_alumni_checkins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=False),
        sa.Column("period_date", sa.Date(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["accelerator_alumni_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("profile_id", "period_date", name="uq_accelerator_alumni_checkin_period"),
    )
    for column in ("profile_id", "author_user_id", "period_date"):
        op.create_index(f"ix_accelerator_alumni_checkins_{column}", "accelerator_alumni_checkins", [column])


def downgrade():
    op.drop_table("accelerator_alumni_checkins")
    op.drop_table("accelerator_alumni_profiles")
    op.drop_table("accelerator_resident_snapshots")
    op.drop_table("accelerator_membership_closure_decisions")
    op.drop_table("accelerator_cohort_closures")
