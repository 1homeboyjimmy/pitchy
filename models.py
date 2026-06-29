from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, JSON, Numeric, UniqueConstraint
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
    # custdev/legal/assets/custom) описана в schemas.base.PassportData.
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    payments: Mapped[list["Payment"]] = relationship(back_populates="promo_code")


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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(30))
    content: Mapped[str] = mapped_column(Text)
    thoughts: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    feedback: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    client_id: Mapped[str | None] = mapped_column(String(50), nullable=True)

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
