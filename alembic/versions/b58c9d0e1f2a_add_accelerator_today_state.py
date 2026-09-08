"""Add persistent accelerator today state.

Revision ID: b58c9d0e1f2a
Revises: a47b8c9d0e1f
"""

from alembic import op
import sqlalchemy as sa


revision = "b58c9d0e1f2a"
down_revision = "a47b8c9d0e1f"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accelerator_tracking_feedback") as batch:
        batch.add_column(sa.Column("read_at", sa.DateTime(), nullable=True))
        batch.create_index("ix_accelerator_tracking_feedback_read_at", ["read_at"])

    op.create_table(
        "accelerator_recommendations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), sa.ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("section", sa.String(length=40), nullable=True),
        sa.Column("href", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    for column in ("membership_id", "created_by_user_id", "status", "created_at"):
        op.create_index(f"ix_accelerator_recommendations_{column}", "accelerator_recommendations", [column])

    op.create_table(
        "accelerator_recommendation_dismissals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), sa.ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recommendation_key", sa.String(length=160), nullable=False),
        sa.Column("reason_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("membership_id", "recommendation_key", name="uq_accelerator_recommendation_dismissal_key"),
    )
    for column in ("membership_id", "recommendation_key", "dismissed_at"):
        op.create_index(f"ix_accelerator_recommendation_dismissals_{column}", "accelerator_recommendation_dismissals", [column])

    op.create_table(
        "accelerator_today_recommendation_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), sa.ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("recommendations", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("generated_by", sa.String(length=30), server_default="deterministic", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("membership_id", name="uq_accelerator_today_cache_membership"),
    )
    op.create_index("ix_accelerator_today_recommendation_cache_membership_id", "accelerator_today_recommendation_cache", ["membership_id"])
    op.create_index("ix_accelerator_today_recommendation_cache_state_fingerprint", "accelerator_today_recommendation_cache", ["state_fingerprint"])


def downgrade():
    op.drop_index("ix_accelerator_today_recommendation_cache_state_fingerprint", table_name="accelerator_today_recommendation_cache")
    op.drop_index("ix_accelerator_today_recommendation_cache_membership_id", table_name="accelerator_today_recommendation_cache")
    op.drop_table("accelerator_today_recommendation_cache")
    for column in ("dismissed_at", "recommendation_key", "membership_id"):
        op.drop_index(f"ix_accelerator_recommendation_dismissals_{column}", table_name="accelerator_recommendation_dismissals")
    op.drop_table("accelerator_recommendation_dismissals")
    for column in ("created_at", "status", "created_by_user_id", "membership_id"):
        op.drop_index(f"ix_accelerator_recommendations_{column}", table_name="accelerator_recommendations")
    op.drop_table("accelerator_recommendations")
    with op.batch_alter_table("accelerator_tracking_feedback") as batch:
        batch.drop_index("ix_accelerator_tracking_feedback_read_at")
        batch.drop_column("read_at")
