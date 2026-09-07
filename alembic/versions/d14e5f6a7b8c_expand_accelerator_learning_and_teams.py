"""Expand accelerator homework, events and team matchmaking.

Revision ID: d14e5f6a7b8c
Revises: c03b4c5d6e7f
"""

from alembic import op
import sqlalchemy as sa


revision = "d14e5f6a7b8c"
down_revision = "c03b4c5d6e7f"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accelerator_cohorts", sa.Column("expert_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_accelerator_cohorts_expert_user_id_users",
        "accelerator_cohorts", "users", ["expert_user_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_accelerator_cohorts_expert_user_id", "accelerator_cohorts", ["expert_user_id"])

    op.add_column("accelerator_teams", sa.Column("recruiting_open", sa.Boolean(), server_default=sa.text("true"), nullable=False))

    op.create_table(
        "accelerator_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("uploader_user_id", sa.Integer(), nullable=True),
        sa.Column("application_id", sa.Integer(), nullable=True),
        sa.Column("submission_id", sa.Integer(), nullable=True),
        sa.Column("purpose", sa.String(length=30), nullable=False),
        sa.Column("original_name", sa.String(length=500), nullable=False),
        sa.Column("stored_name", sa.String(length=160), nullable=False),
        sa.Column("mime_type", sa.String(length=160), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploader_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["application_id"], ["accelerator_applications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["submission_id"], ["accelerator_homework_submissions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token"), sa.UniqueConstraint("stored_name"),
    )
    for name, columns in (
        ("ix_accelerator_files_token", ["token"]),
        ("ix_accelerator_files_cohort_id", ["cohort_id"]),
        ("ix_accelerator_files_uploader_user_id", ["uploader_user_id"]),
        ("ix_accelerator_files_application_id", ["application_id"]),
        ("ix_accelerator_files_submission_id", ["submission_id"]),
        ("ix_accelerator_files_purpose", ["purpose"]),
        ("ix_accelerator_files_created_at", ["created_at"]),
    ):
        op.create_index(name, "accelerator_files", columns)

    op.create_table(
        "accelerator_team_applications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("desired_role", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("responded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("responded_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["accelerator_teams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["responded_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_accelerator_team_applications_team_id", "accelerator_team_applications", ["team_id"])
    op.create_index("ix_accelerator_team_applications_membership_id", "accelerator_team_applications", ["membership_id"])
    op.create_index("ix_accelerator_team_applications_status", "accelerator_team_applications", ["status"])
    op.create_index(
        "uq_accelerator_team_application_pending_membership",
        "accelerator_team_applications", ["membership_id"], unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.add_column("accelerator_homework_assignments", sa.Column("assignment_type", sa.String(length=30), server_default="text_files", nullable=False))
    op.add_column("accelerator_homework_assignments", sa.Column("submission_mode", sa.String(length=20), server_default="individual", nullable=False))
    op.add_column("accelerator_homework_assignments", sa.Column("quiz_config", sa.JSON(), nullable=True))
    op.add_column("accelerator_homework_assignments", sa.Column("passing_score", sa.Integer(), nullable=True))
    op.add_column("accelerator_homework_assignments", sa.Column("max_attempts", sa.Integer(), server_default="1", nullable=False))
    op.create_index("ix_accelerator_homework_assignments_assignment_type", "accelerator_homework_assignments", ["assignment_type"])
    op.create_index("ix_accelerator_homework_assignments_submission_mode", "accelerator_homework_assignments", ["submission_mode"])

    op.add_column("accelerator_homework_submissions", sa.Column("team_id", sa.Integer(), nullable=True))
    op.add_column("accelerator_homework_submissions", sa.Column("quiz_answers", sa.JSON(), nullable=True))
    op.add_column("accelerator_homework_submissions", sa.Column("score", sa.Integer(), nullable=True))
    op.add_column("accelerator_homework_submissions", sa.Column("passed", sa.Boolean(), nullable=True))
    op.create_foreign_key(
        "fk_accelerator_homework_submissions_team_id_teams",
        "accelerator_homework_submissions", "accelerator_teams", ["team_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_accelerator_homework_submissions_team_id", "accelerator_homework_submissions", ["team_id"])
    op.create_index(
        "uq_accelerator_homework_submission_team",
        "accelerator_homework_submissions", ["assignment_id", "team_id"], unique=True,
        postgresql_where=sa.text("team_id IS NOT NULL"),
    )
    op.create_table(
        "accelerator_homework_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("submission_id", sa.Integer(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=True),
        sa.Column("attachments", sa.JSON(), nullable=False),
        sa.Column("quiz_answers", sa.JSON(), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["submission_id"], ["accelerator_homework_submissions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("submission_id", "attempt_number", name="uq_accelerator_homework_attempt_number"),
    )
    op.create_index("ix_accelerator_homework_attempts_submission_id", "accelerator_homework_attempts", ["submission_id"])
    op.create_index("ix_accelerator_homework_attempts_created_at", "accelerator_homework_attempts", ["created_at"])

    op.add_column("accelerator_events", sa.Column("event_type", sa.String(length=30), server_default="webinar", nullable=False))
    op.add_column("accelerator_events", sa.Column("host_name", sa.String(length=300), nullable=True))
    op.add_column("accelerator_events", sa.Column("online_platform", sa.String(length=120), nullable=True))
    op.add_column("accelerator_events", sa.Column("recording_url", sa.Text(), nullable=True))
    op.add_column("accelerator_events", sa.Column("venue_details", sa.Text(), nullable=True))
    op.create_index("ix_accelerator_events_event_type", "accelerator_events", ["event_type"])
    op.create_table(
        "accelerator_event_homework_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("relation", sa.String(length=20), server_default="after", nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["accelerator_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignment_id"], ["accelerator_homework_assignments.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("event_id", "assignment_id", name="uq_accelerator_event_homework_assignment"),
    )
    op.create_index("ix_accelerator_event_homework_links_event_id", "accelerator_event_homework_links", ["event_id"])
    op.create_index("ix_accelerator_event_homework_links_assignment_id", "accelerator_event_homework_links", ["assignment_id"])
    op.create_index("ix_accelerator_event_homework_links_relation", "accelerator_event_homework_links", ["relation"])


def downgrade():
    op.drop_table("accelerator_event_homework_links")
    op.drop_index("ix_accelerator_events_event_type", table_name="accelerator_events")
    for column in ("venue_details", "recording_url", "online_platform", "host_name", "event_type"):
        op.drop_column("accelerator_events", column)
    op.drop_table("accelerator_homework_attempts")
    op.drop_index("uq_accelerator_homework_submission_team", table_name="accelerator_homework_submissions")
    op.drop_index("ix_accelerator_homework_submissions_team_id", table_name="accelerator_homework_submissions")
    op.drop_constraint("fk_accelerator_homework_submissions_team_id_teams", "accelerator_homework_submissions", type_="foreignkey")
    for column in ("passed", "score", "quiz_answers", "team_id"):
        op.drop_column("accelerator_homework_submissions", column)
    op.drop_index("ix_accelerator_homework_assignments_submission_mode", table_name="accelerator_homework_assignments")
    op.drop_index("ix_accelerator_homework_assignments_assignment_type", table_name="accelerator_homework_assignments")
    for column in ("max_attempts", "passing_score", "quiz_config", "submission_mode", "assignment_type"):
        op.drop_column("accelerator_homework_assignments", column)
    op.drop_table("accelerator_team_applications")
    op.drop_column("accelerator_teams", "recruiting_open")
    op.drop_table("accelerator_files")
    op.drop_index("ix_accelerator_cohorts_expert_user_id", table_name="accelerator_cohorts")
    op.drop_constraint("fk_accelerator_cohorts_expert_user_id_users", "accelerator_cohorts", type_="foreignkey")
    op.drop_column("accelerator_cohorts", "expert_user_id")
