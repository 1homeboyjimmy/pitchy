"""Allow preparing cohorts privately before organizer launch."""
from alembic import op
import sqlalchemy as sa
revision = '20261125_admin_only_cohorts'
down_revision = '20261120_attendance_corrections'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('accelerator_cohorts', sa.Column('admin_only', sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column('accelerator_cohorts', 'admin_only')
