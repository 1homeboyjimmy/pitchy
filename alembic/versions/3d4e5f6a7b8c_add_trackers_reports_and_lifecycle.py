"""add tracker assignments and resident lifecycle

Revision ID: 3d4e5f6a7b8c
Revises: 2c3d4e5f6a7b
"""
from alembic import op
import sqlalchemy as sa


revision = "3d4e5f6a7b8c"
down_revision = "2c3d4e5f6a7b"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accelerator_memberships") as batch:
        batch.add_column(sa.Column("suspended_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("status_reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("status_changed_by_user_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_accelerator_memberships_status_changed_by_user_id_users",
            "users", ["status_changed_by_user_id"], ["id"], ondelete="SET NULL",
        )

    op.create_table(
        "accelerator_tracker_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tracker_user_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tracker_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("tracker_user_id", "membership_id", name="uq_accelerator_tracker_membership"),
    )
    op.create_index("ix_accelerator_tracker_assignments_tracker_user_id", "accelerator_tracker_assignments", ["tracker_user_id"])
    op.create_index("ix_accelerator_tracker_assignments_membership_id", "accelerator_tracker_assignments", ["membership_id"])

    op.create_table(
        "accelerator_membership_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("from_status", sa.String(30), nullable=True),
        sa.Column("to_status", sa.String(30), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_accelerator_membership_events_membership_id", "accelerator_membership_events", ["membership_id"])
    op.create_index("ix_accelerator_membership_events_to_status", "accelerator_membership_events", ["to_status"])
    op.create_index("ix_accelerator_membership_events_actor_user_id", "accelerator_membership_events", ["actor_user_id"])
    op.create_index("ix_accelerator_membership_events_created_at", "accelerator_membership_events", ["created_at"])

    # Existing rows already have authoritative timestamps and status. Seed one
    # history event so reports do not start with an empty lifecycle timeline.
    op.execute(sa.text("""
        INSERT INTO accelerator_membership_events
            (membership_id, from_status, to_status, actor_user_id, reason, created_at)
        SELECT id, NULL, status, accepted_by_user_id, 'Начальное состояние до включения истории', created_at
        FROM accelerator_memberships
    """))


def downgrade():
    op.drop_table("accelerator_membership_events")
    op.drop_table("accelerator_tracker_assignments")
    with op.batch_alter_table("accelerator_memberships") as batch:
        batch.drop_constraint(
            "fk_accelerator_memberships_status_changed_by_user_id_users", type_="foreignkey"
        )
        batch.drop_column("status_changed_by_user_id")
        batch.drop_column("status_reason")
        batch.drop_column("suspended_at")
