from __future__ import annotations

from datetime import datetime
from typing import List, Any

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=2)
    password: str = Field(..., min_length=8, max_length=72)
    accept_privacy: bool
    accept_cookies: bool

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain letters and numbers")
        return value

    @field_validator("accept_privacy")
    @classmethod
    def must_accept_privacy(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Чтобы зарегистрироваться, нужно согласие с политикой конфиденциальности")
        return value

    @field_validator("accept_cookies")
    @classmethod
    def must_accept_cookies(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Чтобы зарегистрироваться, нужно согласие на использование cookies")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    name: str
    is_admin: bool
    is_active: bool
    email_verified: bool
    created_at: datetime
    is_social: bool = False
    subscription_tier: str = "free"
    subscription_expires_at: datetime | None = None
    cookie_consent: bool | None = None
    privacy_consent_at: datetime | None = None
    cookies_consent_at: datetime | None = None
    deleted_at: datetime | None = None

    class Config:
        from_attributes = True


class PasswordChangeInitRequest(BaseModel):
    current_password: str


class PasswordChangeConfirmRequest(BaseModel):
    code: str
    new_password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    # New flow: identify user by email + numeric code (sent by /auth/request-password-reset).
    # The legacy long-token form is gone — kept the field name "code" for clarity.
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=12)
    new_password: str = Field(..., min_length=8, max_length=72)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        v = value.strip()
        if not v.isdigit():
            raise ValueError("Code must contain digits only")
        return v

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain letters and numbers")
        return value


class EmailVerifyRequest(BaseModel):
    token: str = Field(..., min_length=10)


class EmailCodeVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)


class AnalysisCreateRequest(BaseModel):
    name: str = Field(..., min_length=2)
    description: str = Field(..., min_length=10)
    category: str | None = None
    url: str | None = None
    stage: str | None = None


class AnalysisResponse(BaseModel):
    id: int
    name: str = "Без названия"
    category: str | None = None
    investment_score: int
    strengths: List[str]
    weaknesses: List[str]
    recommendations: List[str]
    market_summary: str
    created_at: datetime


class ChatSessionCreateRequest(BaseModel):
    title: str = Field(..., min_length=2)
    initial_message: str | None = None
    client_id: str | None = None
    assistant_client_id: str | None = None


class ChatSessionResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    analysis_id: int | None = None
    project_id: int | None = None

    class Config:
        from_attributes = True


class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    thoughts: str | None = None
    sources: list[dict] | None = None
    created_at: datetime
    client_id: str | None = None

    class Config:
        from_attributes = True


class ChatSessionDetailResponse(ChatSessionResponse):
    messages: List[ChatMessageResponse] = []
    analysis: AnalysisResponse | None = None


class ChatMessageCreateRequest(BaseModel):
    # session_id passed in path usually, but can be here too
    content: str = Field(..., min_length=1)
    client_id: str | None = None
    assistant_client_id: str | None = None
    use_deep_search: bool = False
    use_research: bool = False
    intent: str | None = None
    # Set to True from the "Регенерировать" button so the backend drops the
    # saved z.ai conversation_id and rebuilds the deck from scratch instead
    # of editing the existing one.
    regenerate_deck: bool = False


class ProjectContext(BaseModel):
    project_name: str | None = None
    problem: str | None = None
    solution: str | None = None
    target_audience: str | None = None
    features: List[str] = []
    raw_text: str | None = None

class ImportContextRequest(BaseModel):
    text: str = Field(..., min_length=10)
    session_id: int | None = None

class ImportContextResponse(BaseModel):
    success: bool
    summary: ProjectContext | None = None
    message: str | None = None

# ——— Project Passport (Паспорт проекта) Schemas ———

class ProjectCreateRequest(BaseModel):
    name: str = Field(default="Новый проект", min_length=2, max_length=200)
    # Опциональный стартовый паспорт (например, из импорта контекста).
    passport: dict[str, Any] | None = None
    # Если задан — привязываем существующий чат к новой папке.
    attach_session_id: int | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    status: str | None = None  # active, archived


class PassportPatchRequest(BaseModel):
    """Частичный апдейт паспорта.

    `fields` — плоская карта "section.field" -> value (например
    {"core.problem": "...", "metrics.mrr": 200000}). Бэкенд мерджит в
    JSONB и проставляет source=manual для затронутых полей, чтобы ИИ
    не перезаписывал их молча.
    """
    fields: dict[str, Any] = Field(default_factory=dict)


class ProjectMemoryItemResponse(BaseModel):
    id: int
    kind: str
    content: str
    confidence: float
    source_session_id: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ProjectResponse(BaseModel):
    id: int
    name: str
    passport: dict[str, Any] = {}
    readiness_index: int = 0
    status: str = "active"
    passport_updated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectListItemResponse(BaseModel):
    id: int
    name: str
    readiness_index: int = 0
    status: str = "active"
    session_count: int = 0
    updated_at: datetime

    class Config:
        from_attributes = True


class PassportResponse(BaseModel):
    """Ответ модалки редактирования паспорта: данные + индекс готовности +
    список незаполненных ключевых секций (для подсветки «не хватает»)."""
    passport: dict[str, Any] = {}
    readiness_index: int = 0
    missing_sections: list[str] = Field(default_factory=list)


class ProjectOnboardRequest(BaseModel):
    """Онбординг «2 минуты до матча»: одно описание идеи на входе."""
    idea: str = Field(min_length=12, max_length=4000)


class ProjectOnboardResponse(BaseModel):
    """Результат онбординга: созданная папка с черновиком паспорта (source=ai)
    и короткий разбор идеи. Дальше фронт грузит матч по project.id."""
    project: ProjectResponse
    summary: str = ""


# ——— Grants (Гранты) Schemas ———

class GrantResponse(BaseModel):
    id: int
    name: str
    organization: str | None = None
    description: str | None = None
    url: str | None = None
    logo_url: str | None = None
    amount_min: float | None = None
    amount_max: float | None = None
    geo: str | None = None
    location: str | None = None
    stages: list[str] = []
    sectors: list[str] = []
    entity_types: list[str] = []
    requirements: dict[str, Any] | None = None
    application_template: dict[str, Any] | None = None
    # Доступна ли генерация заявки под этот грант (есть реальный шаблон фонда).
    # Заполняется в роутере; в ORM такого поля нет, поэтому дефолт False.
    has_template: bool = False
    opens_at: datetime | None = None
    deadline: datetime | None = None
    status: str = "open"
    category: str = "grant"
    moderation: str = "approved"

    class Config:
        from_attributes = True


class GrantTemplateUpdateRequest(BaseModel):
    """Админ: задать/сбросить шаблон заявки гранта. template=None → дефолт из кода."""
    template: dict[str, Any] | None = None


class GrantMatchResponse(BaseModel):
    """Грант + результат матчинга с паспортом проекта (для списка автоподбора)."""
    grant: GrantResponse
    score: int = 0
    hard_pass: bool = False
    reasons: dict[str, Any] = Field(default_factory=dict)


class GrantCreateRequest(BaseModel):
    """Создание гранта (админ/парсер)."""
    name: str = Field(..., min_length=2, max_length=300)
    organization: str | None = None
    description: str | None = None
    url: str | None = None
    logo_url: str | None = None
    amount_min: float | None = None
    amount_max: float | None = None
    geo: str | None = None
    location: str | None = None
    stages: list[str] = []
    sectors: list[str] = []
    entity_types: list[str] = []
    requirements: dict[str, Any] | None = None
    opens_at: datetime | None = None
    deadline: datetime | None = None
    status: str = "open"
    category: str = "grant"

    @field_validator("url", "logo_url")
    @classmethod
    def _safe_grant_url(cls, v: str | None) -> str | None:
        """URL гранта попадает на фронт как <a href>. Краулер тащит ссылки из
        чужого HTML, поэтому режем всё, кроме http(s) и локальных путей
        (/logos/…). Так javascript:/data:/scheme-relative не дойдут до DOM."""
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        # локальный ассет вида /logos/fsi.svg — ок (но не //host и не /\)
        if s.startswith("/") and not s.startswith("//") and not s.startswith("/\\"):
            return s
        low = s.lower()
        if low.startswith("http://") or low.startswith("https://"):
            return s
        raise ValueError("URL должен быть http(s) или локальным путём")


class GrantExtractRequest(BaseModel):
    """Извлечение черновика гранта по ссылке (админ-парсер)."""
    url: str = Field(..., min_length=4)


class GrantSourceResponse(BaseModel):
    """Источник авто-обнаружения грантов (для админки)."""
    id: int
    name: str
    url: str
    kind: str = "listing"
    enabled: bool = True
    max_items: int = 6
    last_crawled_at: datetime | None = None
    last_status: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GrantSourceCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    url: str = Field(..., min_length=4)
    kind: str = "listing"  # listing | page
    max_items: int = Field(6, ge=1, le=30)


class GrantSourceUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    url: str | None = Field(None, min_length=4)
    kind: str | None = None
    enabled: bool | None = None
    max_items: int | None = Field(None, ge=1, le=30)


class GrantModerateRequest(BaseModel):
    """Решение модерации по найденному гранту."""
    action: str  # approve | reject


class GrantApplicationGenerateRequest(BaseModel):
    project_id: int
    extra_context: str | None = None


class GrantApplicationResponse(BaseModel):
    id: int
    project_id: int
    grant_id: int
    status: str = "draft"
    # CRM-стадия воронки: interested → preparing → submitted → won / rejected.
    stage: str = "preparing"
    content: dict[str, Any] = {}
    match_score: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GrantApplicationUpdateRequest(BaseModel):
    """Ручная правка секций заявки или перемещение по канбану."""
    content: dict[str, Any] | None = None
    status: str | None = None
    stage: str | None = None


class UserUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=2)
    email: EmailStr | None = None
    cookie_consent: bool | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain letters and numbers")
        return value

class PromoCodeCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=50)
    discount_percent: int = Field(..., ge=1, le=100)
    target_tier: str | None = None
    fixed_price: float | None = None
    max_uses: int | None = None
    expires_at: datetime | None = None

class PromoCodeResponse(BaseModel):
    id: int
    code: str
    discount_percent: int
    target_tier: str | None = None
    fixed_price: float | None = None
    max_uses: int | None
    current_uses: int
    expires_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class PaymentResponse(BaseModel):
    id: int
    user_id: int
    user_email: str
    user_name: str
    yookassa_payment_id: str
    amount: float
    currency: str
    status: str
    tier: str
    is_annual: bool
    promo_code: str | None = None
    created_at: datetime
    updated_at: datetime


class SubscriptionResponse(BaseModel):
    user_id: int
    email: str
    name: str
    subscription_tier: str
    subscription_expires_at: datetime | None
    is_active: bool
    last_payment_date: datetime | None = None
    last_payment_amount: float | None = None
    last_payment_status: str | None = None
    promo_code_used: str | None = None
    total_payments: int = 0
    total_spent: float = 0


class IntentCreateRequest(BaseModel):
    initial_message: str = Field(..., min_length=1)
    client_id: str | None = None

class IntentResponse(BaseModel):
    intent_id: str

class ChatSessionFromIntentRequest(BaseModel):
    intent_id: str
    assistant_client_id: str | None = None

class ChatSessionAutoRequest(BaseModel):
    initial_message: str = Field(..., min_length=1)
    client_id: str | None = None
    assistant_client_id: str | None = None


# ——— Smart Roadmap (Интерактивная дорожная карта) Schemas ———

class TreeInputSchema(BaseModel):
    field: str
    label: str
    type: str = "text"  # select, text, number
    options: list[str] | None = None
    placeholder: str | None = None
    required: bool = False
    status: str = "empty"
    value: Any = None

class TreeNextActionSchema(BaseModel):
    title: str
    target_block: str | None = None
    reason: str | None = None

class TreeNodeDataSchema(BaseModel):
    description: str | None = None
    completion_criteria: dict[str, str] = {}
    inputs: list[TreeInputSchema] = []
    form_schema: list[dict[str, Any]] = []  # Для рендера форм в сайдбаре
    summary: dict[str, str] = {}  # Выжимка от ИИ (таблица)
    feedback: str | None = None   # Развернутый фидбек от ИИ
    outputs: dict[str, str] = {}
    next_action: TreeNextActionSchema | None = None
    chat_hint: str | None = None
    risks: list[str] = []
    dependencies: list[str] = []
    aiRecommendation: str | None = None
    sourceRef: str | None = None

class TreeNodeSchema(BaseModel):
    id: str
    type: str = "core"  # core, optional, conditional
    status: str = "empty"  # empty, partial, completed, critical, skipped
    label: str
    category: str | None = None
    level: int = 0
    required: bool = True
    priority: int = 0
    impact_score: float = 0.0
    data: TreeNodeDataSchema = TreeNodeDataSchema()
    parent_id: str | None = "root"
    children_ids: list[str] = []


class TreeEdgeSchema(BaseModel):
    id: str
    source: str
    target: str


class TreeDataSchema(BaseModel):
    nodes: List[TreeNodeSchema] = []
    edges: List[TreeEdgeSchema] = []


class TreeCreateRequest(BaseModel):
    description: str = Field(..., min_length=10)


class TreeResponse(BaseModel):
    id: int
    title: str
    tree_data: dict = {}
    readiness_index: int = 0
    status: str = "generating"
    source_type: str = "text"
    created_at: datetime

    class Config:
        from_attributes = True


class TreeNodeUpdateRequest(BaseModel):
    node_id: str
    data: TreeNodeDataSchema | None = None
    status: str | None = None


class TreeChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    active_node_id: str | None = None
    client_id: str | None = None
    assistant_client_id: str | None = None
    use_deep_search: bool = False


class TreeChatResponse(BaseModel):
    status: str = "ok"
    reply: str
    tree_data: dict | None = None
    readiness_index: int | None = None
    hints: list[str] | None = None
    model: str | None = None
    client_id: str | None = None
    assistant_client_id: str | None = None
    thoughts: str | None = None


class TreeEvaluateRequest(BaseModel):
    node_id: str
    form_data: dict[str, Any]


class RagSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    # Optional category filter — must match values from the SLM dispatcher
    # taxonomy (e.g. "platform_manual", "market_rf", "finance", ...).
    # Omit for an unfiltered search across the whole knowledge base.
    categories: list[str] | None = None
    # If true, return only the chunks array without the glued `context`
    # string (saves bytes on the wire for large top_k).
    chunks_only: bool = False


class RagChunk(BaseModel):
    text: str
    score: float | None = None
    metadata: dict | None = None


class RagSearchResponse(BaseModel):
    # Pre-joined context for callers that just want one string to feed
    # into an LLM. Empty if `chunks_only=True` on the request.
    context: str
    chunks: list[RagChunk] = Field(default_factory=list)
    # How many chunks were actually returned (≤ top_k).
    count: int = 0

class ToolResultResponse(BaseModel):
    id: int
    query: str
    tool_type: str
    content: str
    sources: list[dict] | None = None
    created_at: datetime

    class Config:
        from_attributes = True

class ToolSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)

class ToolResearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
