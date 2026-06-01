"""Grants: grants, grant_applications, grant_match_cache

Revision ID: f2a7b8c9d0e1
Revises: e1f6a7b8c9d0
Create Date: 2026-06-01 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "f2a7b8c9d0e1"
down_revision = "e1f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("organization", sa.String(length=300), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("amount_min", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("amount_max", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("geo", sa.String(length=50), nullable=True),
        sa.Column("stages", sa.JSON(), nullable=True),
        sa.Column("sectors", sa.JSON(), nullable=True),
        sa.Column("entity_types", sa.JSON(), nullable=True),
        sa.Column("requirements", sa.JSON(), nullable=True),
        sa.Column("opens_at", sa.DateTime(), nullable=True),
        sa.Column("deadline", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="open", nullable=False),
        sa.Column("source", sa.String(length=50), server_default="manual", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_grants_deadline", "grants", ["deadline"])

    op.create_table(
        "grant_applications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("grant_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="draft", nullable=False),
        sa.Column("content", sa.JSON(), nullable=True),
        sa.Column("match_score", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grant_id"], ["grants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_grant_applications_user_id", "grant_applications", ["user_id"])
    op.create_index("ix_grant_applications_project_id", "grant_applications", ["project_id"])
    op.create_index("ix_grant_applications_grant_id", "grant_applications", ["grant_id"])

    op.create_table(
        "grant_match_cache",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("grant_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), server_default="0", nullable=False),
        sa.Column("hard_pass", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("reasons", sa.JSON(), nullable=True),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grant_id"], ["grants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_grant_match_cache_project_id", "grant_match_cache", ["project_id"])
    op.create_index("ix_grant_match_cache_grant_id", "grant_match_cache", ["grant_id"])


def downgrade() -> None:
    op.drop_index("ix_grant_match_cache_grant_id", table_name="grant_match_cache")
    op.drop_index("ix_grant_match_cache_project_id", table_name="grant_match_cache")
    op.drop_table("grant_match_cache")
    op.drop_index("ix_grant_applications_grant_id", table_name="grant_applications")
    op.drop_index("ix_grant_applications_project_id", table_name="grant_applications")
    op.drop_index("ix_grant_applications_user_id", table_name="grant_applications")
    op.drop_table("grant_applications")
    op.drop_index("ix_grants_deadline", table_name="grants")
    op.drop_table("grants")
