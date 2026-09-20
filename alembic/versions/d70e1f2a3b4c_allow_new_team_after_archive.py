"""Allow a resident to create a new team after archiving the previous one.

Revision ID: d70e1f2a3b4c
Revises: 20260917_form_draft_revision
"""

from alembic import op
import sqlalchemy as sa


revision = "d70e1f2a3b4c"
down_revision = "20260917_form_draft_revision"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accelerator_teams") as batch_op:
        batch_op.drop_constraint("uq_accelerator_team_project", type_="unique")
        batch_op.drop_constraint("uq_accelerator_team_owner", type_="unique")
    op.create_index(
        "uq_accelerator_team_active_project",
        "accelerator_teams",
        ["cohort_id", "project_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND project_id IS NOT NULL"),
        sqlite_where=sa.text("status = 'active' AND project_id IS NOT NULL"),
    )
    op.create_index(
        "uq_accelerator_team_active_owner",
        "accelerator_teams",
        ["cohort_id", "owner_membership_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
        sqlite_where=sa.text("status = 'active'"),
    )


def downgrade():
    op.drop_index(
        "uq_accelerator_team_active_owner", table_name="accelerator_teams"
    )
    op.drop_index(
        "uq_accelerator_team_active_project", table_name="accelerator_teams"
    )
    with op.batch_alter_table("accelerator_teams") as batch_op:
        batch_op.create_unique_constraint(
            "uq_accelerator_team_owner", ["cohort_id", "owner_membership_id"]
        )
        batch_op.create_unique_constraint(
            "uq_accelerator_team_project", ["cohort_id", "project_id"]
        )
