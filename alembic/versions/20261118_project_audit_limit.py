"""Store the monthly project audit limit on each cohort."""
from alembic import op
import sqlalchemy as sa

revision = "20261118_project_audit_limit"
down_revision = "20261117_attendance_reporting"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "accelerator_cohorts",
        sa.Column("project_audit_limit", sa.Integer(), nullable=False, server_default="-1"),
    )


def downgrade():
    op.drop_column("accelerator_cohorts", "project_audit_limit")
