from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ClosureDecisionUpdate(BaseModel):
    outcome: Literal["completed", "withdrawn"]
    reason: str = Field(min_length=2, max_length=4000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        return value.strip()


class CohortClosureComplete(BaseModel):
    summary: str | None = Field(default=None, max_length=10000)


class AlumniProfileUpdate(BaseModel):
    headline: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=5000)
    achievements: list[str] = Field(default_factory=list, max_length=20)
    expertise: list[str] = Field(default_factory=list, max_length=20)
    interests: list[str] = Field(default_factory=list, max_length=20)
    contact_url: str | None = Field(default=None, max_length=500)
    accept_directory_terms: bool

    @field_validator("achievements", "expertise", "interests")
    @classmethod
    def clean_list(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            item = " ".join(value.split())[:200]
            if item and item not in cleaned:
                cleaned.append(item)
        return cleaned

    @field_validator("headline", "bio", "contact_url")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class AlumniCheckinUpsert(BaseModel):
    period_date: date
    summary: str = Field(min_length=2, max_length=10000)
    metrics: dict[str, float | int | str | bool | None] = Field(default_factory=dict)

    @field_validator("summary")
    @classmethod
    def clean_summary(cls, value: str) -> str:
        return value.strip()
