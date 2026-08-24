"""add accelerator program actions and artifacts

Revision ID: 8c9d0e1f2a3b
Revises: 7b8c9d0e1f2a
"""
from alembic import op
import sqlalchemy as sa


revision = "8c9d0e1f2a3b"
down_revision = "7b8c9d0e1f2a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accelerator_program_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stage_id", sa.Integer(), nullable=False),
        sa.Column("action_type", sa.String(30), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["stage_id"], ["accelerator_program_stages.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "stage_id", "position", name="uq_accelerator_program_action_position"
        ),
    )
    op.create_index(
        "ix_accelerator_program_actions_stage_id",
        "accelerator_program_actions",
        ["stage_id"],
    )
    op.create_index(
        "ix_accelerator_program_actions_action_type",
        "accelerator_program_actions",
        ["action_type"],
    )

    # Batch mode keeps the same migration executable in PostgreSQL and in the
    # SQLite database used by integration tests.
    with op.batch_alter_table("chat_sessions") as batch_op:
        batch_op.add_column(
            sa.Column("accelerator_membership_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("accelerator_action_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_chat_sessions_accelerator_membership_id",
            "accelerator_memberships",
            ["accelerator_membership_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_chat_sessions_accelerator_action_id",
            "accelerator_program_actions",
            ["accelerator_action_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_chat_sessions_accelerator_membership_id",
            ["accelerator_membership_id"],
        )
        batch_op.create_index(
            "ix_chat_sessions_accelerator_action_id",
            ["accelerator_action_id"],
        )

    op.create_table(
        "accelerator_artifacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("action_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("artifact_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="started"),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(50), nullable=True),
        sa.Column("source_id", sa.String(100), nullable=True),
        sa.Column("visibility", sa.JSON(), nullable=False),
        sa.Column("shared_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["action_id"], ["accelerator_program_actions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint(
            "action_id", "membership_id", name="uq_accelerator_artifact_action_membership"
        ),
    )
    for column in (
        "action_id",
        "membership_id",
        "project_id",
        "artifact_type",
        "status",
        "source_type",
    ):
        op.create_index(
            f"ix_accelerator_artifacts_{column}", "accelerator_artifacts", [column]
        )


def downgrade():
    op.drop_table("accelerator_artifacts")
    with op.batch_alter_table("chat_sessions") as batch_op:
        batch_op.drop_index("ix_chat_sessions_accelerator_action_id")
        batch_op.drop_index("ix_chat_sessions_accelerator_membership_id")
        batch_op.drop_constraint(
            "fk_chat_sessions_accelerator_action_id", type_="foreignkey"
        )
        batch_op.drop_constraint(
            "fk_chat_sessions_accelerator_membership_id", type_="foreignkey"
        )
        batch_op.drop_column("accelerator_action_id")
        batch_op.drop_column("accelerator_membership_id")
    op.drop_table("accelerator_program_actions")
