from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


APPLICATION_FIELD_TYPES = {"text", "email", "number", "textarea", "select"}


def validate_application_form_schema(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Схема анкеты должна быть объектом")
    title = value.get("title")
    description = value.get("description")
    if title is not None and (not isinstance(title, str) or len(title) > 300):
        raise ValueError("Заголовок анкеты должен быть строкой до 300 символов")
    if description is not None and (not isinstance(description, str) or len(description) > 4000):
        raise ValueError("Описание анкеты должно быть строкой до 4000 символов")
    required = value.get("required", [])
    if not isinstance(required, list) or len(required) > 100:
        raise ValueError("Список обязательных полей анкеты некорректен")
    if any(not isinstance(key, str) or not key for key in required):
        raise ValueError("Ключ обязательного поля должен быть непустой строкой")
    if len(set(required)) != len(required):
        raise ValueError("Обязательные поля анкеты не должны повторяться")
    fields = value.get("fields", [])
    if not isinstance(fields, list) or len(fields) > 100:
        raise ValueError("Анкета может содержать не более 100 полей")
    seen_keys: set[str] = set()
    for index, field in enumerate(fields, start=1):
        if not isinstance(field, dict):
            raise ValueError(f"Поле анкеты №{index} должно быть объектом")
        key = field.get("key")
        if not isinstance(key, str) or not key or len(key) > 64:
            raise ValueError(f"У поля анкеты №{index} отсутствует системный ключ")
        if not key[0].isalpha() or not key.isascii() or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789_" for ch in key):
            raise ValueError(f"Некорректный системный ключ поля: {key}")
        if key in seen_keys:
            raise ValueError(f"Системный ключ поля повторяется: {key}")
        seen_keys.add(key)
        field_type = field.get("type", "text")
        if field_type not in APPLICATION_FIELD_TYPES:
            raise ValueError(f"Неизвестный тип поля {key}: {field_type}")
        label = field.get("label")
        if label is not None and (not isinstance(label, str) or not label.strip() or len(label) > 300):
            raise ValueError(f"Некорректное название поля: {key}")
        for text_key, max_length in (("description", 1000), ("placeholder", 500)):
            text_value = field.get(text_key)
            if text_value is not None and (not isinstance(text_value, str) or len(text_value) > max_length):
                raise ValueError(f"Поле {key}: значение {text_key} слишком длинное")
        options = field.get("options", [])
        application_types = field.get("application_types")
        if application_types is not None:
            if (
                not isinstance(application_types, list)
                or not application_types
                or len(set(application_types)) != len(application_types)
                or any(item not in {"project", "participant"} for item in application_types)
            ):
                raise ValueError(
                    f"Поле {key}: application_types должен содержать project и/или participant"
                )
        if field_type == "select":
            if not isinstance(options, list) or len(options) < 2 or len(options) > 50:
                raise ValueError(f"Поле {key}: укажите от 2 до 50 вариантов ответа")
            for option in options:
                if isinstance(option, str):
                    if not option.strip() or len(option) > 300:
                        raise ValueError(f"Поле {key}: некорректный вариант ответа")
                elif isinstance(option, dict):
                    if not str(option.get("value", "")).strip() or not str(option.get("label", "")).strip():
                        raise ValueError(f"Поле {key}: вариант должен содержать value и label")
                else:
                    raise ValueError(f"Поле {key}: некорректный вариант ответа")
    return value


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    description: str | None = None


class AcceleratorCreate(BaseModel):
    organization_id: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=2, max_length=200)
    organization: str | None = Field(default=None, max_length=200)
    description: str | None = None


class AcceleratorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=10000)


class AcceleratorSetupCreate(BaseModel):
    organization_id: int | None = Field(default=None, gt=0)
    organization_name: str | None = Field(default=None, min_length=2, max_length=200)
    organization_description: str | None = Field(default=None, max_length=10000)
    accelerator_name: str = Field(min_length=2, max_length=200)
    accelerator_description: str | None = Field(default=None, max_length=10000)
    cohort_name: str = Field(min_length=2, max_length=200)
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=80)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    application_form_schema: dict[str, Any] = Field(default_factory=dict)
    modules: dict[str, bool] = Field(default_factory=dict)
    default_quota_config: dict[str, int] | None = None

    @field_validator("application_form_schema")
    @classmethod
    def validate_form_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_application_form_schema(value) or {}

    @field_validator("default_quota_config")
    @classmethod
    def validate_quota_config(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        expected = {"messages", "roadmaps", "custdev", "grants"}
        if set(value) != expected:
            raise ValueError("Лимиты должны содержать messages, roadmaps, custdev и grants")
        if any(not isinstance(limit, int) or limit < -1 for limit in value.values()):
            raise ValueError("Лимит должен быть -1 (безлимит) или неотрицательным")
        return value

    @model_validator(mode="after")
    def validate_setup(self):
        if bool(self.organization_id) == bool((self.organization_name or "").strip()):
            raise ValueError("Выберите существующую организацию или укажите название новой")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("Дата окончания потока должна быть позже даты начала")
        return self


class CohortCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=80)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    application_form_schema: dict[str, Any] = Field(default_factory=dict)

    @field_validator("application_form_schema")
    @classmethod
    def validate_form_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_application_form_schema(value) or {}


class CohortUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    timezone: str | None = Field(default=None, min_length=1, max_length=80)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    application_form_schema: dict[str, Any] | None = None

    @field_validator("application_form_schema")
    @classmethod
    def validate_form_schema(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return validate_application_form_schema(value)


class OrganizerAssign(BaseModel):
    user_id: int = Field(gt=0)


class TrackerAssign(BaseModel):
    user_id: int = Field(gt=0)
    membership_ids: list[int] = Field(default_factory=list, max_length=500)

    @field_validator("membership_ids")
    @classmethod
    def validate_memberships(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value) or len(set(value)) != len(value):
            raise ValueError("Резиденты должны быть уникальными положительными ID")
        return value


class TrackerAssignmentsUpdate(BaseModel):
    membership_ids: list[int] = Field(default_factory=list, max_length=500)

    @field_validator("membership_ids")
    @classmethod
    def validate_memberships(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value) or len(set(value)) != len(value):
            raise ValueError("Резиденты должны быть уникальными положительными ID")
        return value


class ApplicationCreate(BaseModel):
    form_payload: dict[str, Any]
    project_id: int | None = Field(default=None, gt=0)
    application_type: Literal["project", "participant"] = "project"
    accept_privacy: bool
    accept_program_rules: bool

    @field_validator("accept_privacy", "accept_program_rules")
    @classmethod
    def require_consent(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Для подачи заявки необходимо согласие")
        return value


class PublicApplicationCreate(BaseModel):
    applicant_name: str = Field(min_length=2, max_length=200)
    applicant_email: EmailStr
    application_type: Literal["project", "participant"] = "project"
    form_payload: dict[str, Any]
    accept_privacy: bool
    accept_program_rules: bool
    website: str = Field(default="", max_length=0)  # honeypot

    @field_validator("accept_privacy", "accept_program_rules")
    @classmethod
    def require_consent(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Для подачи заявки необходимо согласие")
        return value


class ApplicationReview(BaseModel):
    comment: str | None = Field(default=None, max_length=4000)


class ApplicationStatusUpdate(ApplicationReview):
    status: Literal["under_review", "needs_info", "waitlisted", "rejected", "archived"]

    @model_validator(mode="after")
    def require_needs_info_comment(self):
        if self.status == "needs_info" and not (self.comment or "").strip():
            raise ValueError("При возврате заявки укажите, что именно нужно исправить")
        return self


class ApplicationRevisionUpdate(BaseModel):
    form_payload: dict[str, Any]


class ProgramConfigUpdate(BaseModel):
    version: int = Field(ge=1)
    modules: dict[str, bool]


class ResidentQuotaLimits(BaseModel):
    messages: int
    roadmaps: int
    custdev: int
    grants: int

    @field_validator("messages", "roadmaps", "custdev", "grants")
    @classmethod
    def validate_limit(cls, value: int) -> int:
        if value < -1:
            raise ValueError("лимит должен быть -1 (безлимит) или неотрицательным")
        return value


class ResidentQuotaAssign(BaseModel):
    limits: ResidentQuotaLimits
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    reason: str | None = Field(default=None, max_length=2000)


class CohortQuotaAssign(ResidentQuotaAssign):
    apply_to_existing: bool = True
    overwrite_personal: bool = False


class StatusUpdate(BaseModel):
    status: Literal["draft", "accepting", "active", "completed", "archived"]


class MembershipStatusUpdate(BaseModel):
    status: Literal["enrolled", "suspended", "completed", "withdrawn"]
    reason: str = Field(min_length=2, max_length=4000)

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Укажите причину изменения статуса")
        return value


class ProgressCheckinUpsert(BaseModel):
    period_start: date | None = None
    health: Literal["green", "yellow", "red"] = "green"
    summary: str = Field(min_length=2, max_length=10000)
    blockers: str | None = Field(default=None, max_length=10000)
    next_steps: str = Field(min_length=2, max_length=10000)
    help_needed: str | None = Field(default=None, max_length=10000)

    @field_validator("summary", "next_steps")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Заполните обязательное поле")
        return value

    @field_validator("blockers", "help_needed")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class TrackingFeedbackCreate(BaseModel):
    body: str = Field(min_length=2, max_length=10000)

    @field_validator("body")
    @classmethod
    def strip_body(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Добавьте содержательный комментарий")
        return value


class TrackingTaskCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    due_at: datetime | None = None

    @field_validator("due_at")
    @classmethod
    def normalize_due_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


class TrackingTaskUpdate(BaseModel):
    status: Literal["open", "done", "cancelled"]


def normalize_match_tags(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = " ".join(raw.strip().split())
        key = value.casefold()
        if value and key not in seen:
            result.append(value)
            seen.add(key)
    return result


class MatchProfileData(BaseModel):
    bio: str | None = Field(default=None, max_length=5000)
    expertise: list[str] = Field(default_factory=list, max_length=30)
    needs: list[str] = Field(default_factory=list, max_length=30)
    industries: list[str] = Field(default_factory=list, max_length=20)
    goals: list[str] = Field(default_factory=list, max_length=20)
    preferred_formats: list[str] = Field(default_factory=list, max_length=10)
    max_matches: int = Field(default=5, ge=1, le=100)
    active: bool = True

    @field_validator("bio")
    @classmethod
    def strip_match_bio(cls, value: str | None) -> str | None:
        return (value or "").strip() or None

    @field_validator("expertise", "needs", "industries", "goals", "preferred_formats")
    @classmethod
    def validate_match_tags(cls, value: list[str]) -> list[str]:
        if any(not isinstance(item, str) or len(item.strip()) > 100 for item in value):
            raise ValueError("Каждый тег должен быть строкой до 100 символов")
        return normalize_match_tags(value)


class MatchPoolProfileCreate(MatchProfileData):
    user_id: int = Field(gt=0)
    role: Literal["tracker", "expert"]


class MatchCreate(BaseModel):
    counterpart_profile_id: int = Field(gt=0)


class MatchStatusUpdate(BaseModel):
    status: Literal["active", "ended"]


class InvitationAccept(BaseModel):
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("Пароль должен содержать буквы и цифры")
        return value


class HomeworkAssignmentCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str = Field(min_length=1, max_length=30000)
    due_at: datetime | None = None
    audience: Literal["cohort", "selected"] = "cohort"
    target_membership_ids: list[int] = Field(default_factory=list, max_length=500)
    allow_resubmit: bool = True
    stage_id: int | None = Field(default=None, gt=0)

    @field_validator("due_at")
    @classmethod
    def normalize_due_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @field_validator("target_membership_ids")
    @classmethod
    def validate_targets(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value):
            raise ValueError("ID резидента должен быть положительным")
        if len(set(value)) != len(value):
            raise ValueError("Резиденты в списке не должны повторяться")
        return value

    @model_validator(mode="after")
    def validate_audience(self):
        if self.audience == "selected" and not self.target_membership_ids:
            raise ValueError("Выберите хотя бы одного резидента")
        if self.audience == "cohort":
            self.target_membership_ids = []
        return self


class HomeworkSubmissionUpsert(BaseModel):
    answer_text: str | None = Field(default=None, max_length=30000)
    attachments: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("attachments")
    @classmethod
    def validate_attachments(cls, value: list[str]) -> list[str]:
        cleaned = []
        for item in value:
            item = item.strip()
            if len(item) > 2000 or not item.lower().startswith(("https://", "http://")):
                raise ValueError("Материал должен быть корректной http(s)-ссылкой")
            cleaned.append(item)
        return cleaned

    @model_validator(mode="after")
    def require_answer(self):
        if not (self.answer_text or "").strip() and not self.attachments:
            raise ValueError("Добавьте текст ответа или ссылку на материал")
        return self


class HomeworkReview(BaseModel):
    status: Literal["accepted", "needs_revision"]
    comment: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def require_revision_comment(self):
        if self.status == "needs_revision" and not (self.comment or "").strip():
            raise ValueError("При возврате на доработку укажите комментарий")
        return self


class ProgramMaterialCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    kind: Literal["link", "video", "text"] = "link"
    url: str | None = Field(default=None, max_length=2000)
    content: str | None = Field(default=None, max_length=30000)
    required: bool = True

    @model_validator(mode="after")
    def validate_body(self):
        if self.kind in ("link", "video"):
            if not (self.url or "").strip().lower().startswith(("https://", "http://")):
                raise ValueError("Для ссылки или видео укажите корректный http(s)-адрес")
        elif not (self.content or "").strip():
            raise ValueError("Для текстового материала добавьте содержание")
        return self


class ProgramStageCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=30000)
    unlock_at: datetime | None = None
    required: bool = True
    materials: list[ProgramMaterialCreate] = Field(default_factory=list, max_length=100)

    @field_validator("unlock_at")
    @classmethod
    def normalize_unlock_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


class ProgramStageReorder(BaseModel):
    stage_ids: list[int] = Field(min_length=1, max_length=500)

    @field_validator("stage_ids")
    @classmethod
    def validate_stage_ids(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value) or len(set(value)) != len(value):
            raise ValueError("Этапы должны быть уникальными положительными ID")
        return value


class EventCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=30000)
    starts_at: datetime
    ends_at: datetime
    event_format: Literal["online", "offline", "hybrid"] = "online"
    location: str | None = Field(default=None, max_length=500)
    meeting_url: str | None = Field(default=None, max_length=2000)
    stage_id: int | None = Field(default=None, gt=0)
    checkin_opens_minutes: int = Field(default=120, ge=0, le=1440)
    checkin_closes_minutes: int = Field(default=180, ge=0, le=1440)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def normalize_event_datetime(cls, value: datetime) -> datetime:
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @model_validator(mode="after")
    def validate_event(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Окончание мероприятия должно быть позже начала")
        if self.event_format in ("offline", "hybrid") and not (self.location or "").strip():
            raise ValueError("Для очного или гибридного мероприятия укажите место")
        if self.meeting_url and not self.meeting_url.strip().lower().startswith(("https://", "http://")):
            raise ValueError("Ссылка на подключение должна начинаться с http:// или https://")
        return self


class AttendanceMark(BaseModel):
    membership_id: int = Field(gt=0)
    status: Literal["present", "absent", "excused"]
    comment: str | None = Field(default=None, max_length=4000)
