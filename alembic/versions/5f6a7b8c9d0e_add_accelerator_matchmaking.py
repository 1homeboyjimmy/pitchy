"""add accelerator matchmaking

Revision ID: 5f6a7b8c9d0e
Revises: 4e5f6a7b8c9d
"""
from alembic import op
import sqlalchemy as sa


revision = "5f6a7b8c9d0e"
down_revision = "4e5f6a7b8c9d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_match_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("expertise", sa.JSON(), nullable=False),
        sa.Column("needs", sa.JSON(), nullable=False),
        sa.Column("industries", sa.JSON(), nullable=False),
        sa.Column("goals", sa.JSON(), nullable=False),
        sa.Column("preferred_formats", sa.JSON(), nullable=False),
        sa.Column("max_matches", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("cohort_id", "user_id", "role", name="uq_accelerator_match_profile_user_role"),
        sa.UniqueConstraint("membership_id", name="uq_accelerator_match_profile_membership"),
    )
    for column in ("cohort_id", "user_id", "membership_id", "role", "active"):
        op.create_index(f"ix_accelerator_match_profiles_{column}", "accelerator_match_profiles", [column])

    op.create_table(
        "accelerator_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("resident_membership_id", sa.Integer(), nullable=False),
        sa.Column("counterpart_profile_id", sa.Integer(), nullable=False),
        sa.Column("counterpart_role", sa.String(20), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("tracker_assignment_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("ended_by_user_id", sa.Integer(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resident_membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["counterpart_profile_id"], ["accelerator_match_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tracker_assignment_id"], ["accelerator_tracker_assignments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["ended_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "resident_membership_id", "counterpart_profile_id",
            name="uq_accelerator_match_resident_counterpart",
        ),
    )
    for column in ("cohort_id", "resident_membership_id", "counterpart_profile_id", "counterpart_role", "status", "created_at"):
        op.create_index(f"ix_accelerator_matches_{column}", "accelerator_matches", [column])


def downgrade():
    op.drop_table("accelerator_matches")
    op.drop_table("accelerator_match_profiles")
