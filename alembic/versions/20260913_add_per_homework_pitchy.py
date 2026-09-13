"""Store Pitchy availability per homework and event previews.

Revision ID: 20260913_per_homework_pitchy
Revises: 20260909_accelerator_prod_merge
"""

from alembic import op
import sqlalchemy as sa


revision = "20260913_per_homework_pitchy"
down_revision = "20260909_accelerator_prod_merge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accelerator_homework_assignments",
        sa.Column(
            "pitchy_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "accelerator_events",
        sa.Column("preview_url", sa.Text(), nullable=True),
    )
    op.execute(
        """
        UPDATE accelerator_homework_assignments
        SET pitchy_enabled = COALESCE(
            (
                SELECT accelerator_cohorts.homework_pitchy_enabled
                FROM accelerator_cohorts
                WHERE accelerator_cohorts.id = accelerator_homework_assignments.cohort_id
            ),
            false
        )
        """
    )


def downgrade() -> None:
    op.drop_column("accelerator_events", "preview_url")
    op.drop_column("accelerator_homework_assignments", "pitchy_enabled")
