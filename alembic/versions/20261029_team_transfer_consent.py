"""Store a resident's consent to leave a specific team after approval."""
from alembic import op
import sqlalchemy as sa

revision = "20261029_team_transfer"
down_revision = "20261014_shared_projects"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accelerator_team_applications", sa.Column("transfer_context", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("accelerator_team_applications", "transfer_context")
