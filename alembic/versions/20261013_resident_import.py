"""Username accounts and direct enrollment with a linked project breakdown."""
from alembic import op
import sqlalchemy as sa

revision = "20261013_resident_import"
down_revision = "20261004_personas"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.alter_column("email", existing_type=sa.String(255), nullable=True)
        batch.add_column(sa.Column("username", sa.String(32), nullable=True))
        batch.add_column(sa.Column("local_login_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.create_index("ix_users_username", ["username"], unique=True)
    with op.batch_alter_table("accelerator_memberships") as batch:
        batch.alter_column("application_id", existing_type=sa.Integer(), nullable=True)
    with op.batch_alter_table("project_trees") as batch:
        batch.add_column(sa.Column("project_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_project_trees_project_id_projects", "projects", ["project_id"], ["id"], ondelete="CASCADE")
        batch.create_index("ix_project_trees_project_id", ["project_id"], unique=True)
    op.create_table(
        "accelerator_resident_imports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), sa.ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("batch_key", sa.String(100), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("cohort_id", "batch_key", name="uq_resident_import_batch"),
    )


def downgrade():
    # Do not silently discard accounts or direct enrollments on rollback.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT COUNT(*) FROM users WHERE email IS NULL")).scalar():
        raise RuntimeError("Cannot downgrade while username-only accounts exist")
    if connection.execute(sa.text("SELECT COUNT(*) FROM accelerator_memberships WHERE application_id IS NULL")).scalar():
        raise RuntimeError("Cannot downgrade while direct enrollments exist")
    op.drop_table("accelerator_resident_imports")
    with op.batch_alter_table("project_trees") as batch:
        batch.drop_index("ix_project_trees_project_id")
        batch.drop_constraint("fk_project_trees_project_id_projects", type_="foreignkey")
        batch.drop_column("project_id")
    with op.batch_alter_table("accelerator_memberships") as batch:
        batch.alter_column("application_id", existing_type=sa.Integer(), nullable=False)
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_username")
        batch.drop_column("local_login_enabled")
        batch.drop_column("username")
        batch.alter_column("email", existing_type=sa.String(255), nullable=False)
