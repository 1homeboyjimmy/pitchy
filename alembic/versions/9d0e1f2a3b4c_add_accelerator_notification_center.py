"""add accelerator in-app notification center

Revision ID: 9d0e1f2a3b4c
Revises: 8c9d0e1f2a3b
"""
from alembic import op
import sqlalchemy as sa


revision = "9d0e1f2a3b4c"
down_revision = "8c9d0e1f2a3b"
branch_labels = None
depends_on = None


def upgrade():
    # Batch mode is required for SQLite integration tests while remaining
    # valid for PostgreSQL in production.
    with op.batch_alter_table("accelerator_notification_outbox") as batch_op:
        batch_op.add_column(
            sa.Column("recipient_user_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_accelerator_notification_outbox_recipient_user_id",
            "users",
            ["recipient_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_accelerator_notification_outbox_recipient_user_id",
            ["recipient_user_id"],
        )

    op.create_table(
        "accelerator_notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("accelerator_id", sa.Integer(), nullable=True),
        sa.Column("cohort_id", sa.Integer(), nullable=True),
        sa.Column("membership_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("action_url", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["accelerator_id"], ["accelerators.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["cohort_id"], ["accelerator_cohorts.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["membership_id"], ["accelerator_memberships.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint(
            "idempotency_key", name="uq_accelerator_notification_idempotency"
        ),
    )
    for column in (
        "user_id",
        "accelerator_id",
        "cohort_id",
        "membership_id",
        "event_type",
        "read_at",
        "created_at",
    ):
        op.create_index(
            f"ix_accelerator_notifications_{column}",
            "accelerator_notifications",
            [column],
        )
    op.create_index(
        "ix_accelerator_notifications_user_read_id",
        "accelerator_notifications",
        ["user_id", "read_at", "id"],
    )

    op.create_table(
        "accelerator_notification_preferences",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "email_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "user_id", name="uq_accelerator_notification_preference_user"
        ),
    )
    op.create_index(
        "ix_accelerator_notification_preferences_user_id",
        "accelerator_notification_preferences",
        ["user_id"],
    )


def downgrade():
    op.drop_table("accelerator_notification_preferences")
    op.drop_table("accelerator_notifications")
    with op.batch_alter_table("accelerator_notification_outbox") as batch_op:
        batch_op.drop_index(
            "ix_accelerator_notification_outbox_recipient_user_id"
        )
        batch_op.drop_constraint(
            "fk_accelerator_notification_outbox_recipient_user_id",
            type_="foreignkey",
        )
        batch_op.drop_column("recipient_user_id")
