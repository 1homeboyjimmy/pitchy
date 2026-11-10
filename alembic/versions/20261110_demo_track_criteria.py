"""Configurable demo-day track criteria and summation policy."""
from alembic import op
import sqlalchemy as sa

revision = "20261110_demo_tracks"
down_revision = "20261102_project_homework"
branch_labels = None
depends_on = None

def upgrade():
    for table, column in [("projects", "name"), ("project_trees", "title"), ("accelerator_teams", "name")]:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(column, type_=sa.String(500), existing_type=sa.String(200))
    op.add_column("accelerator_demo_days", sa.Column("evaluation_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))

def downgrade():
    op.drop_column("accelerator_demo_days", "evaluation_config")
