"""Add persistent full-research pipeline.

Revision ID: c4d5e6f7a8b9
Revises: b7c8d9e0f1a2
"""
from alembic import op
import sqlalchemy as sa

revision = "c4d5e6f7a8b9"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("research_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("query", sa.Text(), nullable=False), sa.Column("status", sa.String(30), nullable=False, server_default="queued"),
        sa.Column("phase", sa.String(50), nullable=False, server_default="planning"), sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blueprint", sa.JSON()), sa.Column("report", sa.Text()), sa.Column("sources", sa.JSON()),
        sa.Column("events", sa.JSON(), nullable=False, server_default="[]"), sa.Column("error", sa.Text()),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("started_at", sa.DateTime()),
        sa.Column("completed_at", sa.DateTime()), sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.create_index("ix_research_jobs_user_id", "research_jobs", ["user_id"])
    op.create_index("ix_research_jobs_session_id", "research_jobs", ["session_id"])
    op.create_index("ix_research_jobs_status", "research_jobs", ["status"])
    op.create_table("research_sources",
        sa.Column("id", sa.Integer(), primary_key=True), sa.Column("job_id", sa.Integer(), sa.ForeignKey("research_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False), sa.Column("url", sa.Text(), nullable=False), sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source_type", sa.String(30), nullable=False, server_default="web"), sa.Column("rank", sa.Integer()),
        sa.Column("relevance_score", sa.Numeric(8,6)), sa.Column("metadata_json", sa.JSON()), sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("job_id", "url", name="uq_research_source_job_url"))
    op.create_index("ix_research_sources_job_id", "research_sources", ["job_id"])
    op.create_table("research_claims",
        sa.Column("id", sa.Integer(), primary_key=True), sa.Column("job_id", sa.Integer(), sa.ForeignKey("research_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("claim", sa.Text(), nullable=False), sa.Column("value_text", sa.Text()), sa.Column("unit", sa.String(80)),
        sa.Column("period", sa.String(160)), sa.Column("geography", sa.String(160)), sa.Column("status", sa.String(30), nullable=False, server_default="unverified"),
        sa.Column("confidence", sa.Numeric(4,3), nullable=False, server_default="0"), sa.Column("is_estimate", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_research_claims_job_id", "research_claims", ["job_id"])
    op.create_table("research_evidence",
        sa.Column("id", sa.Integer(), primary_key=True), sa.Column("claim_id", sa.Integer(), sa.ForeignKey("research_claims.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=False), sa.Column("passage", sa.Text(), nullable=False),
        sa.Column("supports", sa.Boolean(), nullable=False, server_default=sa.true()), sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("claim_id", "source_id", name="uq_claim_source_evidence"))
    op.create_index("ix_research_evidence_claim_id", "research_evidence", ["claim_id"])
    op.create_index("ix_research_evidence_source_id", "research_evidence", ["source_id"])
    with op.batch_alter_table("chat_messages") as batch_op:
        batch_op.add_column(sa.Column("research_job_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_chat_messages_research_job_id", "research_jobs", ["research_job_id"], ["id"], ondelete="SET NULL")
        batch_op.create_index("ix_chat_messages_research_job_id", ["research_job_id"])


def downgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch_op:
        batch_op.drop_index("ix_chat_messages_research_job_id")
        batch_op.drop_constraint("fk_chat_messages_research_job_id", type_="foreignkey")
        batch_op.drop_column("research_job_id")
    op.drop_table("research_evidence"); op.drop_table("research_claims"); op.drop_table("research_sources"); op.drop_table("research_jobs")
