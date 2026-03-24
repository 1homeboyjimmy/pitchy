from __future__ import annotations

from datetime import datetime
from typing import List, Any

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=2)
    password: str = Field(..., min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain letters and numbers")
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
    token: str = Field(..., min_length=10)
    new_password: str = Field(..., min_length=8, max_length=72)

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

    class Config:
        from_attributes = True


class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
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
    max_uses: int | None = None
    expires_at: datetime | None = None

class PromoCodeResponse(BaseModel):
    id: int
    code: str
    discount_percent: int
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


# ——— Decision Tree Schemas ———

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


class TreeChatResponse(BaseModel):
    status: str = "ok"
    reply: str
    tree_data: dict | None = None
    readiness_index: int | None = None
    hints: list[str] | None = None
    model: str | None = None
    client_id: str | None = None
    assistant_client_id: str | None = None

