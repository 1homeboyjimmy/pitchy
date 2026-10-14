"""Explicit membership access for multiple shared project passports."""
from alembic import op
import sqlalchemy as sa

revision = '20261014_shared_projects'
down_revision = '20261013_resident_import'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('accelerator_project_members',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('membership_id', sa.Integer(), sa.ForeignKey('accelerator_memberships.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('team_id', sa.Integer(), sa.ForeignKey('accelerator_teams.id', ondelete='CASCADE'), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('membership_id','project_id', name='uq_accelerator_project_member'))
    for field in ('membership_id', 'project_id', 'team_id'):
        op.create_index('ix_accelerator_project_members_' + field, 'accelerator_project_members', [field])


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text('SELECT COUNT(*) FROM accelerator_project_members')).scalar():
        raise RuntimeError('Shared project access exists; downgrade would remove participant permissions')
    op.drop_table('accelerator_project_members')
