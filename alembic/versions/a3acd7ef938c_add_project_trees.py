"""add_project_trees

Revision ID: a3acd7ef938c
Revises: de426ffb6999
Create Date: 2026-03-22 21:37:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3acd7ef938c'
down_revision = 'de426ffb6999'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'project_trees',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(200), server_default='Новое древо'),
        sa.Column('source_type', sa.String(50), server_default='text'),
        sa.Column('source_text', sa.Text(), nullable=True),
        sa.Column('tree_data', sa.JSON(), server_default='{}'),
        sa.Column('status', sa.String(50), server_default='generating'),
        sa.Column('readiness_index', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('project_trees')
