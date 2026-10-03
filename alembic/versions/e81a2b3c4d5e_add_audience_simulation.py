"""Add private campaign-backed audience simulations.

Revision ID: e81a2b3c4d5e
Revises: d70e1f2a3b4c
"""

from alembic import op
import sqlalchemy as sa


revision = "e81a2b3c4d5e"
down_revision = "d70e1f2a3b4c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "audience_simulation_campaigns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(80), nullable=False),
        sa.Column("status", sa.String(20), server_default="draft", nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("settings", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audience_simulation_campaigns_code", "audience_simulation_campaigns", ["code"], unique=True)
    op.create_index("ix_audience_simulation_campaigns_status", "audience_simulation_campaigns", ["status"])

    op.create_table(
        "audience_simulation_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("audience_simulation_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("access_token_hash", sa.String(64), nullable=True),
        sa.Column("status", sa.String(40), server_default="preparing", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("idea", sa.Text(), nullable=False),
        sa.Column("audience", sa.Text(), nullable=True),
        sa.Column("price", sa.String(300), nullable=True),
        sa.Column("input_data", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("evidence", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("findings", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("selection", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("responses", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("aggregate", sa.JSON(), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=True),
        sa.Column("events", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("config_snapshot", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    for column in ("campaign_id", "owner_user_id", "access_token_hash", "status", "created_at"):
        op.create_index(f"ix_audience_simulation_runs_{column}", "audience_simulation_runs", [column])
    op.create_index("ix_audience_sim_runs_campaign_created", "audience_simulation_runs", ["campaign_id", "created_at"])

    op.create_table(
        "audience_simulation_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("audience_simulation_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("audience_simulation_runs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("consent_at", sa.DateTime(), nullable=False),
        sa.Column("consent_version", sa.String(40), server_default="forum-2026-v1", nullable=False),
        sa.Column("campaign_badge", sa.String(200), server_default="Форум «Цифровые решения»", nullable=False),
        sa.Column("event_score", sa.Numeric(6, 2), nullable=True),
        sa.Column("score_version", sa.String(40), nullable=True),
        sa.Column("reward_status", sa.String(30), server_default="not_issued", nullable=False),
        sa.Column("reward_issued_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reward_issued_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("campaign_id", "user_id", name="uq_audience_sim_campaign_user"),
        sa.UniqueConstraint("run_id", name="uq_audience_simulation_participants_run_id"),
    )
    op.create_index("ix_audience_simulation_participants_campaign_id", "audience_simulation_participants", ["campaign_id"])
    op.create_index("ix_audience_simulation_participants_user_id", "audience_simulation_participants", ["user_id"])

    op.create_table(
        "audience_simulation_access_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("audience_simulation_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("claimed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    for column in ("run_id", "token_hash", "purpose", "expires_at"):
        op.create_index(
            f"ix_audience_simulation_access_tokens_{column}",
            "audience_simulation_access_tokens",
            [column],
            unique=column == "token_hash",
        )


def downgrade():
    op.drop_table("audience_simulation_access_tokens")
    op.drop_table("audience_simulation_participants")
    op.drop_table("audience_simulation_runs")
    op.drop_table("audience_simulation_campaigns")
