"""Track concurrent accelerator application form draft edits.

Revision ID: 20260917_form_draft_revision
Revises: 20260913_tracking_signal_states
"""
from alembic import op
import sqlalchemy as sa


revision = "20260917_form_draft_revision"
down_revision = "20260913_tracking_signal_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accelerator_cohorts",
        sa.Column("application_form_draft_revision", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("accelerator_applications", sa.Column("source_type", sa.String(length=30), server_default="pitchy", nullable=False))
    op.add_column("accelerator_applications", sa.Column("source_batch_id", sa.String(length=64), nullable=True))
    op.add_column("accelerator_applications", sa.Column("source_row", sa.Integer(), nullable=True))
    with op.batch_alter_table("accelerator_applications") as batch:
        batch.create_unique_constraint("uq_accelerator_import_row", ["cohort_id", "source_batch_id", "source_row"])


def downgrade() -> None:
    with op.batch_alter_table("accelerator_applications") as batch:
        batch.drop_constraint("uq_accelerator_import_row", type_="unique")
    op.drop_column("accelerator_applications", "source_row")
    op.drop_column("accelerator_applications", "source_batch_id")
    op.drop_column("accelerator_applications", "source_type")
    op.drop_column("accelerator_cohorts", "application_form_draft_revision")
