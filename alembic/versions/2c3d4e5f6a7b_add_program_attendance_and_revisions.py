"""add accelerator program, attendance and application revisions

Revision ID: 2c3d4e5f6a7b
Revises: 1b2c3d4e5f6a
"""
from alembic import op
import sqlalchemy as sa


revision = "2c3d4e5f6a7b"
down_revision = "1b2c3d4e5f6a"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accelerator_applications") as batch:
        batch.add_column(sa.Column("revision_token_hash", sa.String(64), nullable=True))
        batch.add_column(sa.Column("revision_requested_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("revision_expires_at", sa.DateTime(), nullable=True))
        batch.create_unique_constraint("uq_accelerator_applications_revision_token_hash", ["revision_token_hash"])
        batch.create_index("ix_accelerator_applications_revision_token_hash", ["revision_token_hash"])
        batch.create_index("ix_accelerator_applications_revision_expires_at", ["revision_expires_at"])

    op.create_table(
        "accelerator_program_stages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("unlock_at", sa.DateTime(), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("cohort_id", "position", name="uq_accelerator_program_stage_position"),
    )
    op.create_index("ix_accelerator_program_stages_cohort_id", "accelerator_program_stages", ["cohort_id"])
    op.create_index("ix_accelerator_program_stages_unlock_at", "accelerator_program_stages", ["unlock_at"])
    op.create_index("ix_accelerator_program_stages_status", "accelerator_program_stages", ["status"])

    op.create_table(
        "accelerator_program_materials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stage_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False, server_default="link"),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["stage_id"], ["accelerator_program_stages.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("stage_id", "position", name="uq_accelerator_program_material_position"),
    )
    op.create_index("ix_accelerator_program_materials_stage_id", "accelerator_program_materials", ["stage_id"])

    op.create_table(
        "accelerator_program_material_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("material_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["material_id"], ["accelerator_program_materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("material_id", "membership_id", name="uq_accelerator_material_progress_membership"),
    )
    op.create_index("ix_accelerator_program_material_progress_material_id", "accelerator_program_material_progress", ["material_id"])
    op.create_index("ix_accelerator_program_material_progress_membership_id", "accelerator_program_material_progress", ["membership_id"])

    op.create_table(
        "accelerator_program_stage_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stage_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["stage_id"], ["accelerator_program_stages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("stage_id", "membership_id", name="uq_accelerator_stage_progress_membership"),
    )
    op.create_index("ix_accelerator_program_stage_progress_stage_id", "accelerator_program_stage_progress", ["stage_id"])
    op.create_index("ix_accelerator_program_stage_progress_membership_id", "accelerator_program_stage_progress", ["membership_id"])

    with op.batch_alter_table("accelerator_homework_assignments") as batch:
        batch.add_column(sa.Column("stage_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_accelerator_homework_assignments_stage_id_program_stages",
            "accelerator_program_stages", ["stage_id"], ["id"], ondelete="SET NULL",
        )
        batch.create_index("ix_accelerator_homework_assignments_stage_id", ["stage_id"])

    op.create_table(
        "accelerator_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("stage_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("event_format", sa.String(20), nullable=False, server_default="online"),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column("meeting_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("checkin_code", sa.String(64), nullable=False),
        sa.Column("checkin_opens_minutes", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("checkin_closes_minutes", sa.Integer(), nullable=False, server_default="180"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["accelerator_program_stages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("checkin_code"),
    )
    for column in ("cohort_id", "stage_id", "starts_at", "ends_at", "status", "checkin_code"):
        op.create_index(f"ix_accelerator_events_{column}", "accelerator_events", [column])

    op.create_table(
        "accelerator_attendance_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("membership_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="present"),
        sa.Column("checkin_method", sa.String(20), nullable=False, server_default="qr"),
        sa.Column("checked_in_at", sa.DateTime(), nullable=True),
        sa.Column("marked_by_user_id", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["accelerator_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["accelerator_memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["marked_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("event_id", "membership_id", name="uq_accelerator_attendance_event_membership"),
    )
    for column in ("event_id", "membership_id", "status", "checked_in_at"):
        op.create_index(f"ix_accelerator_attendance_records_{column}", "accelerator_attendance_records", [column])


def downgrade():
    op.drop_table("accelerator_attendance_records")
    op.drop_table("accelerator_events")
    with op.batch_alter_table("accelerator_homework_assignments") as batch:
        batch.drop_index("ix_accelerator_homework_assignments_stage_id")
        batch.drop_constraint("fk_accelerator_homework_assignments_stage_id_program_stages", type_="foreignkey")
        batch.drop_column("stage_id")
    op.drop_table("accelerator_program_stage_progress")
    op.drop_table("accelerator_program_material_progress")
    op.drop_table("accelerator_program_materials")
    op.drop_table("accelerator_program_stages")
    with op.batch_alter_table("accelerator_applications") as batch:
        batch.drop_index("ix_accelerator_applications_revision_expires_at")
        batch.drop_index("ix_accelerator_applications_revision_token_hash")
        batch.drop_constraint("uq_accelerator_applications_revision_token_hash", type_="unique")
        batch.drop_column("revision_expires_at")
        batch.drop_column("revision_requested_at")
        batch.drop_column("revision_token_hash")
