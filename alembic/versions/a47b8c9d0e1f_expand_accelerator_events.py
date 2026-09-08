"""Expand accelerator events and keep change history.

Revision ID: a47b8c9d0e1f
Revises: g37b8c9d0e1f
"""

from alembic import op
import sqlalchemy as sa


revision = "a47b8c9d0e1f"
down_revision = "g37b8c9d0e1f"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accelerator_events") as batch:
        batch.add_column(sa.Column("map_url", sa.Text(), nullable=True))
        batch.add_column(sa.Column("outcome", sa.Text(), nullable=True))
        batch.add_column(sa.Column("next_step", sa.Text(), nullable=True))
        batch.add_column(sa.Column("post_materials", sa.JSON(), server_default=sa.text("'[]'"), nullable=False))
        batch.add_column(sa.Column("cancellation_reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("cancelled_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("completed_at", sa.DateTime(), nullable=True))
    op.create_table(
        "accelerator_event_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("accelerator_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_accelerator_event_changes_event_id", "accelerator_event_changes", ["event_id"])
    op.create_index("ix_accelerator_event_changes_actor_user_id", "accelerator_event_changes", ["actor_user_id"])
    op.create_index("ix_accelerator_event_changes_action", "accelerator_event_changes", ["action"])
    op.create_index("ix_accelerator_event_changes_created_at", "accelerator_event_changes", ["created_at"])


def downgrade():
    op.drop_index("ix_accelerator_event_changes_created_at", table_name="accelerator_event_changes")
    op.drop_index("ix_accelerator_event_changes_action", table_name="accelerator_event_changes")
    op.drop_index("ix_accelerator_event_changes_actor_user_id", table_name="accelerator_event_changes")
    op.drop_index("ix_accelerator_event_changes_event_id", table_name="accelerator_event_changes")
    op.drop_table("accelerator_event_changes")
    with op.batch_alter_table("accelerator_events") as batch:
        for column in ("completed_at", "cancelled_at", "cancellation_reason", "post_materials", "next_step", "outcome", "map_url"):
            batch.drop_column(column)
