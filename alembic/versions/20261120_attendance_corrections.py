"""Participant requests for organizer-reviewed attendance corrections."""
from alembic import op
import sqlalchemy as sa

revision = "20261120_attendance_corrections"
down_revision = "20261119_linked_project_teams"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("accelerator_attendance_corrections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), sa.ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("membership_id", sa.Integer(), sa.ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("accelerator_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("was_present", sa.Boolean(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("attachments", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("review_comment", sa.Text(), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_attendance_corrections_queue", "accelerator_attendance_corrections", ["cohort_id", "status", "created_at"])
    op.create_index("ix_accelerator_attendance_corrections_membership_id", "accelerator_attendance_corrections", ["membership_id"])
    op.create_index("ix_accelerator_attendance_corrections_event_id", "accelerator_attendance_corrections", ["event_id"])
    op.create_index("uq_attendance_correction_pending", "accelerator_attendance_corrections", ["membership_id", "event_id"], unique=True,
                    postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"))


def downgrade():
    op.drop_table("accelerator_attendance_corrections")
