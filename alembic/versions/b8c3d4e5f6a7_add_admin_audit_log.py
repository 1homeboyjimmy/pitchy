"""Add admin_audit_log table

Append-only record of admin actions: block/unblock/make-admin/delete
on users, promocode create/delete, etc. Snapshots admin email and
target id so the trail survives the deletion of either party.

Revision ID: b8c3d4e5f6a7
Revises: a7b1c2d3e4f5
Create Date: 2026-05-15 17:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b8c3d4e5f6a7'
down_revision = 'a7b1c2d3e4f5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'admin_audit_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('admin_id', sa.Integer(), nullable=True),
        sa.Column('admin_email', sa.String(length=320), nullable=True),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('target_type', sa.String(length=32), nullable=True),
        sa.Column('target_id', sa.String(length=120), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('ip_address', sa.String(length=64), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_admin_audit_log_admin_id', 'admin_audit_log', ['admin_id'])
    op.create_index('ix_admin_audit_log_action', 'admin_audit_log', ['action'])
    op.create_index('ix_admin_audit_log_target_id', 'admin_audit_log', ['target_id'])
    op.create_index('ix_admin_audit_log_created_at', 'admin_audit_log', ['created_at'])


def downgrade():
    op.drop_index('ix_admin_audit_log_created_at', table_name='admin_audit_log')
    op.drop_index('ix_admin_audit_log_target_id', table_name='admin_audit_log')
    op.drop_index('ix_admin_audit_log_action', table_name='admin_audit_log')
    op.drop_index('ix_admin_audit_log_admin_id', table_name='admin_audit_log')
    op.drop_table('admin_audit_log')
