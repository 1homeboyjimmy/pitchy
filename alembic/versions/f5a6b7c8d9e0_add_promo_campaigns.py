"""Add promo campaigns, redemptions, and post-promo renewal settings.

Revision ID: f5a6b7c8d9e0
Revises: c4d5e6f7a8b9
"""

from alembic import op
import sqlalchemy as sa


revision = "f5a6b7c8d9e0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "promo_campaigns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="draft", nullable=False),
        sa.Column("benefit_type", sa.String(length=30), nullable=False),
        sa.Column("discount_percent", sa.Integer(), nullable=True),
        sa.Column("fixed_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("target_tier", sa.String(length=50), nullable=True),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("max_redemptions", sa.Integer(), nullable=True),
        sa.Column("per_user_limit", sa.Integer(), server_default="1", nullable=False),
        sa.Column("first_payment_only", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("code_mode", sa.String(length=20), server_default="shared", nullable=False),
        sa.Column("code_prefix", sa.String(length=30), nullable=True),
        sa.Column("post_promo_action", sa.String(length=30), server_default="none", nullable=False),
        sa.Column("renewal_config", sa.JSON(), nullable=True),
        sa.Column("renewal_price_policy", sa.String(length=20), server_default="current", nullable=False),
        sa.Column("renewal_fixed_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("renewal_notice_days", sa.Integer(), server_default="3", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_promo_campaigns_status", "promo_campaigns", ["status"])

    with op.batch_alter_table("promocodes") as batch_op:
        batch_op.add_column(sa.Column("campaign_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False))
        batch_op.add_column(sa.Column("assigned_user_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_promocodes_campaign_id", ["campaign_id"])
        batch_op.create_index("ix_promocodes_assigned_user_id", ["assigned_user_id"])
        batch_op.create_foreign_key(
            "fk_promocodes_campaign_id_promo_campaigns",
            "promo_campaigns",
            ["campaign_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_promocodes_assigned_user_id_users",
            "users",
            ["assigned_user_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table("payments") as batch_op:
        batch_op.add_column(sa.Column("promo_context", sa.JSON(), nullable=True))

    with op.batch_alter_table("custom_subscriptions") as batch_op:
        batch_op.add_column(sa.Column("promo_campaign_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("promo_ends_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("promo_post_action", sa.String(length=30), nullable=True))
        batch_op.add_column(sa.Column("promo_consent_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("promo_consent_version", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("renewal_price_override", sa.Numeric(10, 2), nullable=True))
        batch_op.create_index("ix_custom_subscriptions_promo_campaign_id", ["promo_campaign_id"])
        batch_op.create_foreign_key(
            "fk_custom_subscriptions_promo_campaign_id_promo_campaigns",
            "promo_campaigns",
            ["promo_campaign_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_table(
        "promo_redemptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=True),
        sa.Column("promo_code_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("payment_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="reserved", nullable=False),
        sa.Column("original_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("discount_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("final_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("auto_renew_consent", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("consent_text", sa.Text(), nullable=True),
        sa.Column("consent_version", sa.String(length=50), nullable=True),
        sa.Column("consent_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["promo_campaigns.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["promo_code_id"], ["promocodes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["payment_id"], ["payments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payment_id", name="uq_promo_redemptions_payment_id"),
    )
    op.create_index("ix_promo_redemptions_campaign_id", "promo_redemptions", ["campaign_id"])
    op.create_index("ix_promo_redemptions_promo_code_id", "promo_redemptions", ["promo_code_id"])
    op.create_index("ix_promo_redemptions_user_id", "promo_redemptions", ["user_id"])
    op.create_index("ix_promo_redemptions_payment_id", "promo_redemptions", ["payment_id"])
    op.create_index("ix_promo_redemptions_status", "promo_redemptions", ["status"])


def downgrade() -> None:
    op.drop_table("promo_redemptions")
    with op.batch_alter_table("custom_subscriptions") as batch_op:
        batch_op.drop_constraint(
            "fk_custom_subscriptions_promo_campaign_id_promo_campaigns", type_="foreignkey"
        )
        batch_op.drop_index("ix_custom_subscriptions_promo_campaign_id")
        batch_op.drop_column("promo_consent_version")
        batch_op.drop_column("promo_consent_at")
        batch_op.drop_column("renewal_price_override")
        batch_op.drop_column("promo_post_action")
        batch_op.drop_column("promo_ends_at")
        batch_op.drop_column("promo_campaign_id")
    with op.batch_alter_table("payments") as batch_op:
        batch_op.drop_column("promo_context")
    with op.batch_alter_table("promocodes") as batch_op:
        batch_op.drop_constraint("fk_promocodes_assigned_user_id_users", type_="foreignkey")
        batch_op.drop_constraint("fk_promocodes_campaign_id_promo_campaigns", type_="foreignkey")
        batch_op.drop_index("ix_promocodes_assigned_user_id")
        batch_op.drop_index("ix_promocodes_campaign_id")
        batch_op.drop_column("assigned_user_id")
        batch_op.drop_column("is_active")
        batch_op.drop_column("campaign_id")
    op.drop_index("ix_promo_campaigns_status", table_name="promo_campaigns")
    op.drop_table("promo_campaigns")
