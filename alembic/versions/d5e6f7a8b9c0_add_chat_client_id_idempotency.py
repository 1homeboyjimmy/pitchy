"""Add idempotency constraints for chat client IDs.

Revision ID: d5e6f7a8b9c0
Revises: f5a6b7c8d9e0
"""

from alembic import op
import sqlalchemy as sa


revision = "d5e6f7a8b9c0"
down_revision = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve historical duplicates but clear their idempotency key so the
    # unique partial indexes can be created without deleting user messages.
    op.execute("""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY session_id, client_id ORDER BY id
            ) AS row_num
            FROM chat_messages
            WHERE client_id IS NOT NULL
        )
        UPDATE chat_messages SET client_id = NULL
        WHERE id IN (SELECT id FROM ranked WHERE row_num > 1)
    """)
    op.execute("""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY project_id, client_id ORDER BY id
            ) AS row_num
            FROM tree_chat_history
            WHERE client_id IS NOT NULL
        )
        UPDATE tree_chat_history SET client_id = NULL
        WHERE id IN (SELECT id FROM ranked WHERE row_num > 1)
    """)
    op.create_index(
        "uq_chat_messages_session_client_id",
        "chat_messages",
        ["session_id", "client_id"],
        unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL"),
        sqlite_where=sa.text("client_id IS NOT NULL"),
    )
    op.create_index(
        "uq_tree_chat_history_project_client_id",
        "tree_chat_history",
        ["project_id", "client_id"],
        unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL"),
        sqlite_where=sa.text("client_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_tree_chat_history_project_client_id", table_name="tree_chat_history")
    op.drop_index("uq_chat_messages_session_client_id", table_name="chat_messages")
