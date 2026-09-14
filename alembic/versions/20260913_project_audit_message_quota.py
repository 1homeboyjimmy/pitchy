"""Use message quota for project audits.

Revision ID: 20260913_audit_message_quota
Revises: 20260913_per_homework_pitchy
"""

from alembic import op
import sqlalchemy as sa


revision = "20260913_audit_message_quota"
down_revision = "20260913_per_homework_pitchy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("accelerator_project_audits") as batch_op:
        batch_op.alter_column(
            "quota_resource",
            existing_type=sa.String(length=30),
            server_default="messages",
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("accelerator_project_audits") as batch_op:
        batch_op.alter_column(
            "quota_resource",
            existing_type=sa.String(length=30),
            server_default="custdev",
            existing_nullable=False,
        )
