"""add accelerator resident teams

Revision ID: ae1f2a3b4c5d
Revises: 9d0e1f2a3b4c
"""
from alembic import op
import sqlalchemy as sa


revision = "ae1f2a3b4c5d"
down_revision = "9d0e1f2a3b4c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_teams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("owner_membership_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("max_members", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["owner_membership_id"],
            ["accelerator_memberships.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint(
            "cohort_id", "project_id", name="uq_accelerator_team_project"
        ),
        sa.UniqueConstraint(
            "cohort_id", "owner_membership_id", name="uq_accelerator_team_owner"
        ),
    )
    for column in ("cohort_id", "project_id", "owner_membership_id", "status"):
        op.create_index(
            f"ix_accelerator_teams_{column}", "accelerator_teams", [column]
        )

    op.create_table(
        "accelerator_team_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column(
            "share_contact",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("joined_at", sa.DateTime(), nullable=False),
        sa.Column("left_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"], ["accelerator_teams.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"
        ),
    )
    for column in ("team_id", "membership_id", "role", "status"):
        op.create_index(
            f"ix_accelerator_team_members_{column}",
            "accelerator_team_members",
            [column],
        )
    op.create_index(
        "uq_accelerator_team_member_active_membership",
        "accelerator_team_members",
        ["membership_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
        sqlite_where=sa.text("status = 'active'"),
    )

    op.create_table(
        "accelerator_team_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("invitee_membership_id", sa.Integer(), nullable=False),
        sa.Column("source_match_profile_id", sa.Integer(), nullable=True),
        sa.Column("invited_by_user_id", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("responded_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"], ["accelerator_teams.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["invitee_membership_id"],
            ["accelerator_memberships.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_match_profile_id"],
            ["accelerator_match_profiles.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["invited_by_user_id"], ["users.id"], ondelete="RESTRICT"
        ),
    )
    for column in (
        "team_id",
        "invitee_membership_id",
        "source_match_profile_id",
        "invited_by_user_id",
        "status",
        "expires_at",
    ):
        op.create_index(
            f"ix_accelerator_team_invitations_{column}",
            "accelerator_team_invitations",
            [column],
        )
    op.create_index(
        "uq_accelerator_team_invitation_pending_invitee",
        "accelerator_team_invitations",
        ["team_id", "invitee_membership_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade():
    op.drop_table("accelerator_team_invitations")
    op.drop_table("accelerator_team_members")
    op.drop_table("accelerator_teams")
