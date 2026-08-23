from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, JSON, Numeric, UniqueConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    email_verify_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verify_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verify_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_reset_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    subscription_tier: Mapped[str] = mapped_column(String(50), default="free", server_default="free")
    subscription_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cookie_consent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    privacy_consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cookies_consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    analyses: Mapped[list["Analysis"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    social_accounts: Mapped[list["SocialAccount"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    payments: Mapped[list["Payment"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    project_trees: Mapped[list["ProjectTree"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    tool_results: Mapped[list["ToolResult"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    research_jobs: Mapped[list["ResearchJob"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    projects: Mapped[list["Project"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    custom_subscription: Mapped["CustomSubscription | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True, uselist=False
    )
    usage_events: Mapped[list["SubscriptionUsageEvent"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class Project(Base):
    """Папка проекта (паспорт проекта).

    Контейнер для всех чатов одного проекта. Хранит структурированный
    паспорт (passport JSONB) — золотой источник истины, который читают и
    дозаполняют все фичи (презентации, custdev, дорожная карта, гранты).
    Память между чатами скоупится по project_id, поэтому контекст из
    другого проекта не протекает.
    """
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="Новый проект")
    # Структурированный паспорт. Схема секций (core/market/metrics/team/
    # legal/assets/custom) описана в schemas.base.PassportData.
    # Каждое поле может нести метаданные источника (manual|ai|grant) —
    # хранятся в passport["_meta"][field_path].
    passport: Mapped[dict] = mapped_column(JSON, default=dict)
    # 0..100 — процент заполненности ключевых полей паспорта.
    readiness_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(30), default="active")  # active, archived
    passport_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="projects")
    memories: Mapped[list["ProjectMemory"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)


class ProjectMemory(Base):
    """Извлечённый факт о проекте (активная память).

    Фоновый SLM-проход после значимого чата кладёт сюда 1–5 фактов.
    Перед новым ответом делаем RAG-выборку по project_id, поэтому память
    не пересекается между проектами.
    """
    __tablename__ = "project_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30), default="fact")  # fact, decision, metric, risk, persona
    content: Mapped[str] = mapped_column(Text)
    source_session_id: Mapped[int | None] = mapped_column(ForeignKey("chat_sessions.id", ondelete="SET NULL"), nullable=True)
    confidence: Mapped[float] = mapped_column(Numeric(3, 2), default=0.5)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="memories")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    yookassa_payment_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(30), default="yookassa", server_default="yookassa", index=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    provider_order_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, waiting_for_capture, succeeded, canceled
    tier: Mapped[str] = mapped_column(String(50))  # pro, premium
    is_annual: Mapped[bool] = mapped_column(Boolean, default=False)
    promo_code_id: Mapped[int | None] = mapped_column(ForeignKey("promocodes.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(50), default="legacy", server_default="legacy")
    quota_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    payment_method_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    period_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    promo_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="payments")
    promo_code: Mapped["PromoCode | None"] = relationship(back_populates="payments")


class CustomSubscription(Base):
    """Monthly configurable subscription used by the 2490 RUB billing model."""

    __tablename__ = "custom_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    status: Mapped[str] = mapped_column(String(30), default="pending", server_default="pending")
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    payment_method_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    current_config: Mapped[dict] = mapped_column(JSON, default=dict)
    next_config: Mapped[dict] = mapped_column(JSON, default=dict)
    used: Mapped[dict] = mapped_column(JSON, default=dict)
    renewal_attempted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    renewal_retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    promo_campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("promo_campaigns.id", ondelete="SET NULL"), nullable=True, index=True
    )
    promo_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    promo_post_action: Mapped[str | None] = mapped_column(String(30), nullable=True)
    promo_consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    promo_consent_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    renewal_price_override: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="custom_subscription")


class SubscriptionUsageEvent(Base):
    """Immutable ledger entry for every quota credit/reset/debit."""

    __tablename__ = "subscription_usage_events"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_usage_event_idempotency_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subscription_id: Mapped[int | None] = mapped_column(
        ForeignKey("custom_subscriptions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resource: Mapped[str] = mapped_column(String(30), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(20))  # debit | period_reset
    idempotency_key: Mapped[str] = mapped_column(String(255))
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    user: Mapped["User"] = relationship(back_populates="usage_events")


class Accelerator(Base):
    """Workspace owned by Pitchy and operated by assigned organizers."""

    __tablename__ = "accelerators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("accelerator_organizations.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    organization: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft", index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorOrganization(Base):
    __tablename__ = "accelerator_organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active", server_default="active", index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorStaff(Base):
    """Accelerator-scoped staff assignment; organizers are not global admins."""

    __tablename__ = "accelerator_staff"
    __table_args__ = (
        UniqueConstraint("accelerator_id", "user_id", name="uq_accelerator_staff_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    accelerator_id: Mapped[int] = mapped_column(ForeignKey("accelerators.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30), default="organizer", server_default="organizer")
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorCohort(Base):
    __tablename__ = "accelerator_cohorts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    accelerator_id: Mapped[int] = mapped_column(ForeignKey("accelerators.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft", index=True)
    timezone: Mapped[str] = mapped_column(String(80), default="Europe/Moscow", server_default="Europe/Moscow")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    application_form_schema: Mapped[dict] = mapped_column(JSON, default=dict)
    default_quota_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    default_quota_updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorProgramConfig(Base):
    """Versioned switches for modules that can be implemented independently."""

    __tablename__ = "accelerator_program_configs"
    __table_args__ = (
        UniqueConstraint("cohort_id", name="uq_accelerator_program_config_cohort"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cohort_id: Mapped[int] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    modules: Mapped[dict] = mapped_column(JSON, default=dict)
    locked_modules: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorApplication(Base):
    __tablename__ = "accelerator_applications"
    __table_args__ = (
        UniqueConstraint("cohort_id", "user_id", name="uq_accelerator_application_user"),
        UniqueConstraint("cohort_id", "applicant_email", name="uq_accelerator_application_email"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cohort_id: Mapped[int] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    applicant_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    applicant_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    application_type: Mapped[str] = mapped_column(String(30), default="project", server_default="project")
    status: Mapped[str] = mapped_column(String(30), default="submitted", server_default="submitted", index=True)
    form_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    privacy_consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    program_rules_consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    revision_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revision_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorMembership(Base):
    __tablename__ = "accelerator_memberships"
    __table_args__ = (
        UniqueConstraint("cohort_id", "user_id", name="uq_accelerator_membership_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cohort_id: Mapped[int] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("accelerator_applications.id", ondelete="RESTRICT"), unique=True)
    role: Mapped[str] = mapped_column(String(30), default="resident", server_default="resident")
    status: Mapped[str] = mapped_column(String(30), default="accepted", server_default="accepted", index=True)
    accepted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    accepted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    enrolled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_changed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorTrackerAssignment(Base):
    """A tracker can access only explicitly assigned residents."""

    __tablename__ = "accelerator_tracker_assignments"
    __table_args__ = (
        UniqueConstraint("tracker_user_id", "membership_id", name="uq_accelerator_tracker_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tracker_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    membership_id: Mapped[int] = mapped_column(
        ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True
    )
    assigned_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorMembershipEvent(Base):
    __tablename__ = "accelerator_membership_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    membership_id: Mapped[int] = mapped_column(
        ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str] = mapped_column(String(30), index=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AcceleratorApplicationEvent(Base):
    __tablename__ = "accelerator_application_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("accelerator_applications.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str] = mapped_column(String(30), index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AcceleratorParticipantProfile(Base):
    __tablename__ = "accelerator_participant_profiles"
    __table_args__ = (
        UniqueConstraint("membership_id", name="uq_accelerator_participant_profile_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    profile: Mapped[dict] = mapped_column(JSON, default=dict)
    visibility: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorProgramStage(Base):
    __tablename__ = "accelerator_program_stages"
    __table_args__ = (
        UniqueConstraint("cohort_id", "position", name="uq_accelerator_program_stage_position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cohort_id: Mapped[int] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer)
    unlock_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    required: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft", index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorProgramMaterial(Base):
    __tablename__ = "accelerator_program_materials"
    __table_args__ = (
        UniqueConstraint("stage_id", "position", name="uq_accelerator_program_material_position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stage_id: Mapped[int] = mapped_column(ForeignKey("accelerator_program_stages.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(30), default="link", server_default="link")
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer)
    required: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorProgramMaterialProgress(Base):
    __tablename__ = "accelerator_program_material_progress"
    __table_args__ = (
        UniqueConstraint("material_id", "membership_id", name="uq_accelerator_material_progress_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("accelerator_program_materials.id", ondelete="CASCADE"), index=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorProgramStageProgress(Base):
    __tablename__ = "accelerator_program_stage_progress"
    __table_args__ = (
        UniqueConstraint("stage_id", "membership_id", name="uq_accelerator_stage_progress_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stage_id: Mapped[int] = mapped_column(ForeignKey("accelerator_program_stages.id", ondelete="CASCADE"), index=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorHomeworkAssignment(Base):
    __tablename__ = "accelerator_homework_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cohort_id: Mapped[int] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), index=True)
    stage_id: Mapped[int | None] = mapped_column(
        ForeignKey("accelerator_program_stages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft", index=True)
    audience: Mapped[str] = mapped_column(String(30), default="cohort", server_default="cohort")
    allow_resubmit: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorHomeworkTarget(Base):
    __tablename__ = "accelerator_homework_targets"
    __table_args__ = (
        UniqueConstraint("assignment_id", "membership_id", name="uq_accelerator_homework_target_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("accelerator_homework_assignments.id", ondelete="CASCADE"), index=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorHomeworkSubmission(Base):
    __tablename__ = "accelerator_homework_submissions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "membership_id", name="uq_accelerator_homework_submission_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("accelerator_homework_assignments.id", ondelete="CASCADE"), index=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="submitted", server_default="submitted", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorEvent(Base):
    __tablename__ = "accelerator_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cohort_id: Mapped[int] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), index=True)
    stage_id: Mapped[int | None] = mapped_column(
        ForeignKey("accelerator_program_stages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    event_format: Mapped[str] = mapped_column(String(20), default="online", server_default="online")
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meeting_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft", index=True)
    checkin_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    checkin_opens_minutes: Mapped[int] = mapped_column(Integer, default=120, server_default="120")
    checkin_closes_minutes: Mapped[int] = mapped_column(Integer, default=180, server_default="180")
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorAttendanceRecord(Base):
    __tablename__ = "accelerator_attendance_records"
    __table_args__ = (
        UniqueConstraint("event_id", "membership_id", name="uq_accelerator_attendance_event_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("accelerator_events.id", ondelete="CASCADE"), index=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="present", server_default="present", index=True)
    checkin_method: Mapped[str] = mapped_column(String(20), default="qr", server_default="qr")
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    marked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AcceleratorInvitation(Base):
    __tablename__ = "accelerator_invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("accelerator_applications.id", ondelete="CASCADE"), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorNotificationOutbox(Base):
    __tablename__ = "accelerator_notification_outbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    accelerator_id: Mapped[int] = mapped_column(ForeignKey("accelerators.id", ondelete="CASCADE"), index=True)
    cohort_id: Mapped[int | None] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), nullable=True, index=True)
    recipient_email: Mapped[str] = mapped_column(String(255), index=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    subject: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    idempotency_key: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    available_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorResidentQuotaOverride(Base):
    """An immutable quota assignment; newer active rows supersede older rows."""

    __tablename__ = "accelerator_resident_quota_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(20))  # individual | cohort
    limits: Mapped[dict] = mapped_column(JSON)
    starts_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AcceleratorQuotaUsageEvent(Base):
    __tablename__ = "accelerator_quota_usage_events"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_accelerator_quota_usage_idempotency"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    membership_id: Mapped[int] = mapped_column(ForeignKey("accelerator_memberships.id", ondelete="CASCADE"), index=True)
    quota_override_id: Mapped[int] = mapped_column(ForeignKey("accelerator_resident_quota_overrides.id", ondelete="RESTRICT"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    resource: Mapped[str] = mapped_column(String(30), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    idempotency_key: Mapped[str] = mapped_column(String(255))
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AcceleratorAuditLog(Base):
    __tablename__ = "accelerator_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    accelerator_id: Mapped[int] = mapped_column(ForeignKey("accelerators.id", ondelete="CASCADE"), index=True)
    cohort_id: Mapped[int | None] = mapped_column(ForeignKey("accelerator_cohorts.id", ondelete="CASCADE"), nullable=True, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str] = mapped_column(String(50))
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

class PromoCampaign(Base):
    __tablename__ = "promo_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", index=True)
    benefit_type: Mapped[str] = mapped_column(String(30), default="percent_discount")
    discount_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fixed_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    target_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    max_redemptions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    per_user_limit: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    first_payment_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    code_mode: Mapped[str] = mapped_column(String(20), default="shared", server_default="shared")
    code_prefix: Mapped[str | None] = mapped_column(String(30), nullable=True)
    post_promo_action: Mapped[str] = mapped_column(String(30), default="none", server_default="none")
    renewal_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    renewal_price_policy: Mapped[str] = mapped_column(String(20), default="current", server_default="current")
    renewal_fixed_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    renewal_notice_days: Mapped[int] = mapped_column(Integer, default=3, server_default="3")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    codes: Mapped[list["PromoCode"]] = relationship(back_populates="campaign")
    redemptions: Mapped[list["PromoRedemption"]] = relationship(back_populates="campaign")


class PromoCode(Base):
    __tablename__ = "promocodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    discount_percent: Mapped[int] = mapped_column(Integer)
    target_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fixed_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_uses: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("promo_campaigns.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    assigned_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    payments: Mapped[list["Payment"]] = relationship(back_populates="promo_code")
    campaign: Mapped["PromoCampaign | None"] = relationship(back_populates="codes")
    redemptions: Mapped[list["PromoRedemption"]] = relationship(back_populates="promo_code")


class PromoRedemption(Base):
    __tablename__ = "promo_redemptions"
    __table_args__ = (
        UniqueConstraint("payment_id", name="uq_promo_redemptions_payment_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("promo_campaigns.id", ondelete="SET NULL"), nullable=True, index=True
    )
    promo_code_id: Mapped[int] = mapped_column(
        ForeignKey("promocodes.id", ondelete="RESTRICT"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    payment_id: Mapped[int | None] = mapped_column(
        ForeignKey("payments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="reserved", server_default="reserved", index=True)
    original_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    final_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    auto_renew_consent: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    consent_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    consent_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    campaign: Mapped["PromoCampaign | None"] = relationship(back_populates="redemptions")
    promo_code: Mapped["PromoCode"] = relationship(back_populates="redemptions")


class SocialAccount(Base):
    __tablename__ = "social_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(50))
    provider_id: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="social_accounts")


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    payload_text: Mapped[str] = mapped_column(Text)
    investment_score: Mapped[int] = mapped_column(Integer)
    strengths: Mapped[list[str]] = mapped_column(JSON)
    weaknesses: Mapped[list[str]] = mapped_column(JSON)
    recommendations: Mapped[list[str]] = mapped_column(JSON)
    market_summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="analyses")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    analysis_id: Mapped[int | None] = mapped_column(ForeignKey("analyses.id"), nullable=True)
    # Папка проекта, к которой привязан чат. NULL = чат вне проекта
    # (память папки на него не распространяется).
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)

    user: Mapped["User"] = relationship(back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    analysis: Mapped["Analysis"] = relationship()

class RagLog(Base):
    __tablename__ = "rag_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # URLs with #:~:text= fragments routinely exceed 500 bytes (URL-encoded
    # Russian fragments balloon ~6x). Migration a7b1c2d3e4f5 widens this to TEXT.
    source_url: Mapped[str] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(50))  # e.g. URL, CRAWL, PDF
    status: Mapped[str] = mapped_column(String(50))       # e.g. SUCCESS, FAILED
    chunks_added: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index(
            "uq_chat_messages_session_client_id",
            "session_id",
            "client_id",
            unique=True,
            postgresql_where=text("client_id IS NOT NULL"),
            sqlite_where=text("client_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(30))
    content: Mapped[str] = mapped_column(Text)
    thoughts: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    feedback: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    client_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    research_job_id: Mapped[int | None] = mapped_column(ForeignKey("research_jobs.id", ondelete="SET NULL"), nullable=True, index=True)

    session: Mapped["ChatSession"] = relationship(back_populates="messages")


class ErrorLog(Base):
    __tablename__ = "error_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    path: Mapped[str] = mapped_column(String(255))
    method: Mapped[str] = mapped_column(String(10))
    status_code: Mapped[int] = mapped_column(Integer)
    detail: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ProjectTree(Base):
    __tablename__ = "project_trees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200), default="Новое древо")
    source_type: Mapped[str] = mapped_column(String(50), default="text")  # text, pdf, chat
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    tree_data: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="generating")  # generating, ready, error
    readiness_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="project_trees")
    versions: Mapped[list["ProjectVersion"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    chat_history: Mapped[list["TreeChatHistory"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class ProjectVersion(Base):
    __tablename__ = "project_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project_trees.id"))
    tree_data: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer)
    changed_by: Mapped[str] = mapped_column(String(50))  # "claude", "user", "gigachat"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["ProjectTree"] = relationship(back_populates="versions")


class TreeChatHistory(Base):
    __tablename__ = "tree_chat_history"
    __table_args__ = (
        Index(
            "uq_tree_chat_history_project_client_id",
            "project_id",
            "client_id",
            unique=True,
            postgresql_where=text("client_id IS NOT NULL"),
            sqlite_where=text("client_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project_trees.id"))
    message: Mapped[str] = mapped_column(Text)
    thoughts: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    role: Mapped[str] = mapped_column(String(30))  # "user", "assistant"
    model_used: Mapped[str | None] = mapped_column(String(50), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    client_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    node_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

    project: Mapped["ProjectTree"] = relationship(back_populates="chat_history")


class ToolResult(Base):
    __tablename__ = "tool_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    query: Mapped[str] = mapped_column(Text)
    tool_type: Mapped[str] = mapped_column(String(50))  # "quick-search", "deep-research"
    content: Mapped[str] = mapped_column(Text)
    sources: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="tool_results")


class ResearchJob(Base):
    __tablename__ = "research_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    query: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    phase: Mapped[str] = mapped_column(String(50), default="planning")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    blueprint: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    report: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    events: Mapped[list[dict]] = mapped_column(JSON, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="research_jobs")
    research_sources: Mapped[list["ResearchSource"]] = relationship(back_populates="job", cascade="all, delete-orphan", passive_deletes=True)
    claims: Mapped[list["ResearchClaim"]] = relationship(back_populates="job", cascade="all, delete-orphan", passive_deletes=True)


class ResearchSource(Base):
    __tablename__ = "research_sources"
    __table_args__ = (UniqueConstraint("job_id", "url", name="uq_research_source_job_url"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("research_jobs.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(30), default="web")
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    relevance_score: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    job: Mapped["ResearchJob"] = relationship(back_populates="research_sources")
    evidence: Mapped[list["ResearchEvidence"]] = relationship(back_populates="source", cascade="all, delete-orphan", passive_deletes=True)


class ResearchClaim(Base):
    __tablename__ = "research_claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("research_jobs.id", ondelete="CASCADE"), index=True)
    claim: Mapped[str] = mapped_column(Text)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(80), nullable=True)
    period: Mapped[str | None] = mapped_column(String(160), nullable=True)
    geography: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="unverified")
    confidence: Mapped[float] = mapped_column(Numeric(4, 3), default=0)
    is_estimate: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    job: Mapped["ResearchJob"] = relationship(back_populates="claims")
    evidence: Mapped[list["ResearchEvidence"]] = relationship(back_populates="claim", cascade="all, delete-orphan", passive_deletes=True)


class ResearchEvidence(Base):
    __tablename__ = "research_evidence"
    __table_args__ = (UniqueConstraint("claim_id", "source_id", name="uq_claim_source_evidence"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("research_claims.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("research_sources.id", ondelete="CASCADE"), index=True)
    passage: Mapped[str] = mapped_column(Text)
    supports: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claim: Mapped["ResearchClaim"] = relationship(back_populates="evidence")
    source: Mapped["ResearchSource"] = relationship(back_populates="evidence")

class Grant(Base):
    """Каталог грантовых/акселерационных программ.

    Поля geo/stages/sectors/entity_types — критерии для матчинга с
    паспортом проекта (hard-фильтры). amount/deadline — для карточки и
    блока «сейчас идёт».
    """
    __tablename__ = "grants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    organization: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Для агрегаторов url остаётся страницей обнаружения (и ключом дедупа),
    # а пользователю показываем внешний первоисточник/регистрацию.
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    registration_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Логотип организации-грантодателя. Заполняется парсером/админкой; если не
    # задан явно — выводится из домена сайта программы (favicon).
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount_min: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    amount_max: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    # Гео-охват: "RF" (вся Россия) или код региона ("MSK", "SPB", ...).
    geo: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Локация программы: точный адрес очного мероприятия или город/формат
    # («Москва», «Онлайн»). Для справочных категорий (мероприятия/питчи).
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_format: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Структурные данные справочной карточки: agenda, speakers,
    # participation_terms. JSON позволяет расширять карточку без потери данных.
    event_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # JSON-списки критериев. Пустой список = «без ограничений по критерию».
    stages: Mapped[list[str]] = mapped_column(JSON, default=list)          # pre-seed, seed, ...
    sectors: Mapped[list[str]] = mapped_column(JSON, default=list)         # it, biotech, ...
    entity_types: Mapped[list[str]] = mapped_column(JSON, default=list)    # ИП, ООО, самозанятый, физлицо
    requirements: Mapped[dict | None] = mapped_column(JSON, nullable=True) # доп. условия / поля заявки
    # Шаблон заявки под этот грант (структура разделов: static/generated/user_input).
    # NULL → дефолт из grant_templates.select_application_template (по названию/орг).
    application_template: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    opens_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="open")  # open, upcoming, closed
    # Тип программы для разбивки каталога по категориям:
    # grant / contest / accelerator / event / pitch / support_measure / investor.
    category: Mapped[str] = mapped_column(String(30), default="grant", server_default="grant", index=True)
    source: Mapped[str] = mapped_column(String(50), default="manual")  # manual, parsed
    # Модерация авто-обнаруженных грантов: approved (виден в каталоге),
    # pending (в очереди на проверку), rejected (скрыт). Ручные/старые гранты —
    # approved по умолчанию (server_default в миграции), поэтому не пропадают.
    moderation: Mapped[str] = mapped_column(String(20), default="approved", server_default="approved", index=True)
    # Источник авто-обнаружения, если грант найден краулером (provenance, nullable).
    source_id: Mapped[int | None] = mapped_column(ForeignKey("grant_sources.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    applications: Mapped[list["GrantApplication"]] = relationship(back_populates="grant", cascade="all, delete-orphan", passive_deletes=True)


class GrantApplication(Base):
    """Сгенерированная заявка проекта на грант.

    content — секции заявки (JSON: {"problem": "...", "budget": "..."}).
    Генерируется из паспорта; после генерации часть полей (legal/реквизиты)
    может писаться обратно в паспорт.
    """
    __tablename__ = "grant_applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    grant_id: Mapped[int] = mapped_column(ForeignKey("grants.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft")  # draft, generated, submitted
    # CRM-стадия воронки «Мои гранты», отдельно от content-lifecycle `status`:
    # interested → preparing → submitted → won / rejected.
    stage: Mapped[str] = mapped_column(String(30), default="preparing", server_default="preparing")
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    match_score: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    grant: Mapped["Grant"] = relationship(back_populates="applications")


class GrantMatchCache(Base):
    """Кэш результата матчинга паспорт↔грант, чтобы не пересчитывать на
    каждый рендер списка. Инвалидируется при изменении паспорта."""
    __tablename__ = "grant_match_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    grant_id: Mapped[int] = mapped_column(ForeignKey("grants.id", ondelete="CASCADE"), index=True)
    score: Mapped[int] = mapped_column(Integer, default=0)        # 0..100
    hard_pass: Mapped[bool] = mapped_column(Boolean, default=False)
    reasons: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {"matched": [...], "missing": [...]}
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GrantSource(Base):
    """Источник для авто-обнаружения грантов (#20).

    Админ добавляет официальные страницы/каталоги программ в админке.
    Фоновый обходчик раз в сутки парсит включённые источники и кладёт
    найденные программы в очередь модерации (Grant.moderation='pending').
    """
    __tablename__ = "grant_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(Text)
    # listing — страница со списком программ (обходим ссылки внутри);
    # page — одна страница одной программы (парсим как есть).
    kind: Mapped[str] = mapped_column(String(20), default="listing", server_default="listing")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Максимум программ за один проход — защита от взрывного парсинга.
    max_items: Mapped[int] = mapped_column(Integer, default=6, server_default="6")
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AdminAuditLog(Base):
    """Append-only record of admin actions.

    Stores the admin's email and target id as a snapshot so the trail
    survives even if the acting admin (or their target) is deleted later.
    No FK with CASCADE — we want history, not garbage collection.
    """
    __tablename__ = "admin_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    admin_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
