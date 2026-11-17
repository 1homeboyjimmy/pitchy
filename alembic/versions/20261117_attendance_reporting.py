"""Allow a cohort to count attendance against its planned programme."""
from alembic import op
import sqlalchemy as sa

revision = "20261117_attendance_reporting"
down_revision = "20261117_team_attendance"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accelerator_cohorts", sa.Column("attendance_policy", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("accelerator_cohorts", "attendance_policy")
