"""Project passport: projects, project_memory, chat_sessions.project_id

Revision ID: e1f6a7b8c9d0
Revises: d0e5f6a7b8c9
Create Date: 2026-06-01 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "e1f6a7b8c9d0"
down_revision = "d0e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), server_default="Новый проект", nullable=False),
        sa.Column("passport", sa.JSON(), nullable=True),
        sa.Column("readiness_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(length=30), server_default="active", nullable=False),
        sa.Column("passport_updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_user_id", "projects", ["user_id"])

    op.create_table(
        "project_memory",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=30), server_default="fact", nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source_session_id", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=3, scale=2), server_default="0.5", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_session_id"], ["chat_sessions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_memory_project_id", "project_memory", ["project_id"])

    with op.batch_alter_table("chat_sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("project_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_chat_sessions_project_id", ["project_id"])
        batch_op.create_foreign_key(
            "fk_chat_sessions_project_id",
            "projects",
            ["project_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("chat_sessions", schema=None) as batch_op:
        batch_op.drop_constraint("fk_chat_sessions_project_id", type_="foreignkey")
        batch_op.drop_index("ix_chat_sessions_project_id")
        batch_op.drop_column("project_id")

    op.drop_index("ix_project_memory_project_id", table_name="project_memory")
    op.drop_table("project_memory")
    op.drop_index("ix_projects_user_id", table_name="projects")
    op.drop_table("projects")
