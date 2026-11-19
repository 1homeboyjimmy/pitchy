"""Allow project teams to share an attendance roster."""
from alembic import op
import sqlalchemy as sa

revision = "20261119_linked_project_teams"
down_revision = "20261118_project_audit_limit"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accelerator_teams") as batch:
        batch.add_column(sa.Column("attendance_team_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_accelerator_team_attendance_team", "accelerator_teams", ["attendance_team_id"], ["id"], ondelete="RESTRICT")
        batch.create_index("ix_accelerator_teams_attendance_team_id", ["attendance_team_id"])


def downgrade():
    with op.batch_alter_table("accelerator_teams") as batch:
        batch.drop_index("ix_accelerator_teams_attendance_team_id")
        batch.drop_constraint("fk_accelerator_team_attendance_team", type_="foreignkey")
        batch.drop_column("attendance_team_id")
