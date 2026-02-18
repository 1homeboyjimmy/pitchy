from __future__ import annotations

from datetime import datetime
from typing import List

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

    class Config:
        from_attributes = True


class ChatSessionDetailResponse(ChatSessionResponse):
    messages: List[ChatMessageResponse] = []


class ChatMessageCreateRequest(BaseModel):
    # session_id passed in path usually, but can be here too
    content: str = Field(..., min_length=1)
    


class UserUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=2)
    email: EmailStr | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Password must contain letters and numbers")
        return value
