"""Add provider-neutral identifiers for T-Bank acquiring."""
from alembic import op
import sqlalchemy as sa

revision = "20260812_payment_provider"
down_revision = "3e5e912aee5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        batch_op.add_column(sa.Column("provider", sa.String(length=30), nullable=False, server_default="yookassa"))
        batch_op.add_column(sa.Column("provider_payment_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("provider_order_id", sa.String(length=255), nullable=True))
        batch_op.create_index("ix_payments_provider", ["provider"], unique=False)
        batch_op.create_index("ix_payments_provider_payment_id", ["provider_payment_id"], unique=False)
        batch_op.create_index("ix_payments_provider_order_id", ["provider_order_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_index("ix_payments_provider_order_id")
        batch_op.drop_index("ix_payments_provider_payment_id")
        batch_op.drop_index("ix_payments_provider")
        batch_op.drop_column("provider_order_id")
        batch_op.drop_column("provider_payment_id")
        batch_op.drop_column("provider")
