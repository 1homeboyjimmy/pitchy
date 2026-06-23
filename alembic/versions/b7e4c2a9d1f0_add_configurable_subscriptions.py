"""add configurable subscriptions and usage ledger

Revision ID: b7e4c2a9d1f0
Revises: a9c1e3f5b7d2
"""
from alembic import op
import sqlalchemy as sa

revision = "b7e4c2a9d1f0"
down_revision = "a9c1e3f5b7d2"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("payments") as batch:
        batch.add_column(sa.Column("kind", sa.String(50), nullable=False, server_default="legacy"))
        batch.add_column(sa.Column("quota_config", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("payment_method_id", sa.String(255), nullable=True))
        batch.add_column(sa.Column("period_start", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("period_end", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("failure_reason", sa.Text(), nullable=True))

    op.create_table(
        "custom_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("auto_renew", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("payment_method_id", sa.String(255), nullable=True),
        sa.Column("current_period_start", sa.DateTime(), nullable=True),
        sa.Column("current_period_end", sa.DateTime(), nullable=True),
        sa.Column("current_config", sa.JSON(), nullable=False),
        sa.Column("next_config", sa.JSON(), nullable=False),
        sa.Column("used", sa.JSON(), nullable=False),
        sa.Column("renewal_attempted_at", sa.DateTime(), nullable=True),
        sa.Column("renewal_retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_custom_subscriptions_user_id", "custom_subscriptions", ["user_id"], unique=True)
    op.create_index("ix_custom_subscriptions_current_period_end", "custom_subscriptions", ["current_period_end"])

    op.create_table(
        "subscription_usage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subscription_id", sa.Integer(), nullable=True),
        sa.Column("resource", sa.String(30), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("reference_type", sa.String(50), nullable=True),
        sa.Column("reference_id", sa.String(255), nullable=True),
        sa.Column("event_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subscription_id"], ["custom_subscriptions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("idempotency_key", name="uq_usage_event_idempotency_key"),
    )
    op.create_index("ix_subscription_usage_events_user_id", "subscription_usage_events", ["user_id"])
    op.create_index("ix_subscription_usage_events_subscription_id", "subscription_usage_events", ["subscription_id"])
    op.create_index("ix_subscription_usage_events_resource", "subscription_usage_events", ["resource"])
    op.create_index("ix_subscription_usage_events_created_at", "subscription_usage_events", ["created_at"])


def downgrade():
    op.drop_table("subscription_usage_events")
    op.drop_table("custom_subscriptions")
    with op.batch_alter_table("payments") as batch:
        batch.drop_column("failure_reason")
        batch.drop_column("period_end")
        batch.drop_column("period_start")
        batch.drop_column("payment_method_id")
        batch.drop_column("quota_config")
        batch.drop_column("kind")
