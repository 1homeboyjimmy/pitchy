"""add persistent state for deterministic tracking signals

Revision ID: 20260913_tracking_signal_states
Revises: 20260913_program_progress_engine
"""
from alembic import op
import sqlalchemy as sa


revision = "20260913_tracking_signal_states"
down_revision = "20260913_program_progress_engine"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accelerator_tracking_signal_states",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("state", sa.String(length=20), server_default="open", nullable=False),
        sa.Column("snoozed_until", sa.DateTime(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("changed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("membership_id", "fingerprint", name="uq_accelerator_tracking_signal_membership_fingerprint"),
    )
    op.create_index("ix_accelerator_tracking_signal_states_membership_id", "accelerator_tracking_signal_states", ["membership_id"])
    op.create_index("ix_accelerator_tracking_signal_states_fingerprint", "accelerator_tracking_signal_states", ["fingerprint"])
    op.create_index("ix_accelerator_tracking_signal_states_state", "accelerator_tracking_signal_states", ["state"])
    op.create_index("ix_accelerator_tracking_signal_states_snoozed_until", "accelerator_tracking_signal_states", ["snoozed_until"])


def downgrade() -> None:
    op.drop_table("accelerator_tracking_signal_states")
