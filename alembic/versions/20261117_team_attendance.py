"""Configure individual or team attendance per cohort."""
from alembic import op
import sqlalchemy as sa

revision = "20261117_team_attendance"
down_revision = "20261110_demo_tracks"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accelerator_cohorts", sa.Column(
        "attendance_scope", sa.String(20), nullable=False, server_default="individual"
    ))


def downgrade():
    op.drop_column("accelerator_cohorts", "attendance_scope")
