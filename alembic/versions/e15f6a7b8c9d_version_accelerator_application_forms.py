"""Version accelerator application forms.

Revision ID: e15f6a7b8c9d
Revises: d14e5f6a7b8c
"""

from alembic import op
import sqlalchemy as sa


revision = "e15f6a7b8c9d"
down_revision = "d14e5f6a7b8c"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accelerator_cohorts") as batch:
        batch.add_column(sa.Column("application_form_draft", sa.JSON(), nullable=True))
        batch.add_column(
            sa.Column("application_form_version", sa.Integer(), nullable=False, server_default="1")
        )

    op.create_table(
        "accelerator_application_form_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("schema", sa.JSON(), nullable=False),
        sa.Column("published_by_user_id", sa.Integer(), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["cohort_id"], ["accelerator_cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["published_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("cohort_id", "version", name="uq_accelerator_form_version"),
    )
    op.create_index(
        "ix_accelerator_application_form_versions_cohort_id",
        "accelerator_application_form_versions", ["cohort_id"],
    )
    op.create_index(
        "ix_accelerator_application_form_versions_published_by_user_id",
        "accelerator_application_form_versions", ["published_by_user_id"],
    )
    op.create_index(
        "ix_accelerator_application_form_versions_published_at",
        "accelerator_application_form_versions", ["published_at"],
    )

    with op.batch_alter_table("accelerator_applications") as batch:
        batch.add_column(sa.Column("form_version", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(
            sa.Column("form_schema_snapshot", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )

    connection = op.get_bind()
    cohorts = sa.table(
        "accelerator_cohorts",
        sa.column("id", sa.Integer()),
        sa.column("application_form_schema", sa.JSON()),
        sa.column("created_by_user_id", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
    )
    versions = sa.table(
        "accelerator_application_form_versions",
        sa.column("cohort_id", sa.Integer()),
        sa.column("version", sa.Integer()),
        sa.column("schema", sa.JSON()),
        sa.column("published_by_user_id", sa.Integer()),
        sa.column("published_at", sa.DateTime()),
    )
    applications = sa.table(
        "accelerator_applications",
        sa.column("cohort_id", sa.Integer()),
        sa.column("form_version", sa.Integer()),
        sa.column("form_schema_snapshot", sa.JSON()),
    )
    for cohort in connection.execute(sa.select(cohorts)).mappings():
        schema = cohort["application_form_schema"] or {}
        connection.execute(versions.insert().values(
            cohort_id=cohort["id"],
            version=1,
            schema=schema,
            published_by_user_id=cohort["created_by_user_id"],
            published_at=cohort["created_at"],
        ))
        connection.execute(
            applications.update()
            .where(applications.c.cohort_id == cohort["id"])
            .values(form_version=1, form_schema_snapshot=schema)
        )


def downgrade():
    with op.batch_alter_table("accelerator_applications") as batch:
        batch.drop_column("form_schema_snapshot")
        batch.drop_column("form_version")
    op.drop_table("accelerator_application_form_versions")
    with op.batch_alter_table("accelerator_cohorts") as batch:
        batch.drop_column("application_form_version")
        batch.drop_column("application_form_draft")
