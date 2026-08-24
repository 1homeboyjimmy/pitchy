from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AcceleratorNotificationResponse(BaseModel):
    id: int
    accelerator_id: int | None = None
    cohort_id: int | None = None
    membership_id: int | None = None
    event_type: str
    title: str
    body: str
    action_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    read_at: datetime | None = None
    is_read: bool
    created_at: datetime
    updated_at: datetime


class AcceleratorNotificationPage(BaseModel):
    items: list[AcceleratorNotificationResponse]
    next_cursor: int | None = None


class AcceleratorNotificationUnreadCount(BaseModel):
    count: int


class AcceleratorNotificationReadAllResponse(BaseModel):
    updated: int
    read_at: datetime


class AcceleratorNotificationPreferenceResponse(BaseModel):
    email_enabled: bool


class AcceleratorNotificationPreferenceUpdate(BaseModel):
    email_enabled: bool
