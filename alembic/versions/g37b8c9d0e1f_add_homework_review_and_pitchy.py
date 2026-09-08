"""Add controlled Pitchy homework markers.

Revision ID: g37b8c9d0e1f
Revises: f26a7b8c9d0e
"""

from alembic import op
import sqlalchemy as sa


revision = "g37b8c9d0e1f"
down_revision = "f26a7b8c9d0e"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "accelerator_cohorts",
        sa.Column(
            "homework_pitchy_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "accelerator_homework_assignments",
        sa.Column(
            "pitchy_tools",
            sa.JSON(),
            server_default=sa.text("'[]'"),
            nullable=False,
        ),
    )
    with op.batch_alter_table("accelerator_homework_attempts") as batch:
        batch.add_column(sa.Column("review_status", sa.String(length=30), nullable=True))
        batch.add_column(sa.Column("review_comment", sa.Text(), nullable=True))
        batch.add_column(sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("reviewed_at", sa.DateTime(), nullable=True))
        batch.create_foreign_key(
            "fk_accelerator_homework_attempt_reviewer_users",
            "users",
            ["reviewed_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index(
            "ix_accelerator_homework_attempts_review_status", ["review_status"]
        )
    op.execute(
        """
        UPDATE accelerator_homework_attempts
        SET review_status = CASE
            WHEN passed IS TRUE THEN 'accepted'
            WHEN passed IS FALSE THEN 'needs_revision'
            ELSE COALESCE(
                (
                    SELECT status
                    FROM accelerator_homework_submissions
                    WHERE accelerator_homework_submissions.id = accelerator_homework_attempts.submission_id
                ),
                'submitted'
            )
        END
        WHERE review_status IS NULL
        """
    )


def downgrade():
    with op.batch_alter_table("accelerator_homework_attempts") as batch:
        batch.drop_index("ix_accelerator_homework_attempts_review_status")
        batch.drop_constraint(
            "fk_accelerator_homework_attempt_reviewer_users",
            type_="foreignkey",
        )
        for column in (
            "reviewed_at",
            "reviewed_by_user_id",
            "review_comment",
            "review_status",
        ):
            batch.drop_column(column)
    op.drop_column("accelerator_homework_assignments", "pitchy_tools")
    op.drop_column("accelerator_cohorts", "homework_pitchy_enabled")
