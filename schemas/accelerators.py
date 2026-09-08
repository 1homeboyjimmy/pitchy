from __future__ import annotations

from datetime import date, datetime, timezone
import re
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


APPLICATION_FIELD_TYPES = {
    "text", "email", "number", "textarea", "select", "multiselect",
    "scale", "date", "url", "telegram", "file",
}


def validate_timezone_name(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Укажите существующий часовой пояс IANA, например Europe/Moscow") from exc
    return value


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
    sections = value.get("sections", [])
    if not isinstance(sections, list) or len(sections) > 20:
        raise ValueError("Анкета может содержать не более 20 разделов")
    section_keys: set[str] = set()
    for index, section in enumerate(sections, start=1):
        if not isinstance(section, dict):
            raise ValueError(f"Раздел анкеты №{index} должен быть объектом")
        section_key = section.get("key")
        section_title = section.get("title")
        if (
            not isinstance(section_key, str)
            or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", section_key)
            or section_key in section_keys
        ):
            raise ValueError(f"Некорректный или повторяющийся ключ раздела №{index}")
        if not isinstance(section_title, str) or not section_title.strip() or len(section_title) > 200:
            raise ValueError(f"У раздела №{index} должно быть название до 200 символов")
        section_description = section.get("description")
        if section_description is not None and (
            not isinstance(section_description, str) or len(section_description) > 1000
        ):
            raise ValueError(f"Описание раздела №{index} слишком длинное")
        section_keys.add(section_key)
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
        section_key = field.get("section")
        if section_key is not None and section_key not in section_keys:
            raise ValueError(f"Поле {key}: указан неизвестный раздел")
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
        if field_type in {"select", "multiselect"}:
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


class ApplicationFormDraftUpdate(BaseModel):
    form_schema: dict[str, Any] = Field(alias="schema")

    @field_validator("form_schema")
    @classmethod
    def validate_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_application_form_schema(value) or {}


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

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return validate_timezone_name(value)

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

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return validate_timezone_name(value)

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

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        return validate_timezone_name(value) if value is not None else None

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
    telegram: str = Field(min_length=2, max_length=100)
    competencies: list[str] = Field(min_length=1, max_length=20)
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

    @field_validator("telegram")
    @classmethod
    def validate_telegram(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"(?:https?://t\.me/|@)?[A-Za-z0-9_]{5,32}", value):
            raise ValueError("Укажите Telegram в формате @username или t.me/username")
        username = value.rstrip("/").rsplit("/", 1)[-1].lstrip("@")
        return f"@{username}"

    @field_validator("competencies")
    @classmethod
    def validate_competencies(cls, value: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        if not cleaned or any(len(item) > 80 for item in cleaned):
            raise ValueError("Укажите от 1 до 20 компетенций до 80 символов")
        return cleaned


class CohortExpertAssign(BaseModel):
    user_id: int = Field(gt=0)


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


class ProjectAuditFinding(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str = Field(min_length=2, max_length=5000)
    severity: Literal["low", "medium", "high"]
    evidence: str | None = Field(default=None, max_length=3000)


class ProjectAuditRecommendation(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str = Field(min_length=2, max_length=5000)
    priority: Literal["low", "medium", "high"]
    expected_result: str = Field(min_length=2, max_length=3000)


class ProjectAuditGeneratedResult(BaseModel):
    summary: str = Field(min_length=2, max_length=10000)
    overall_score: int = Field(ge=0, le=100)
    strengths: list[str] = Field(default_factory=list, max_length=12)
    findings: list[ProjectAuditFinding] = Field(default_factory=list, max_length=20)
    recommendations: list[ProjectAuditRecommendation] = Field(default_factory=list, max_length=20)
    data_gaps: list[str] = Field(default_factory=list, max_length=20)


class ProjectAuditCreate(BaseModel):
    audit_type: Literal["product", "market", "custdev", "business_model", "grant"]
    focus: str | None = Field(default=None, max_length=5000)
    client_request_id: str = Field(
        min_length=8, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$"
    )

    @field_validator("focus")
    @classmethod
    def strip_audit_focus(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class ProjectAuditTaskCreate(BaseModel):
    recommendation_index: int = Field(ge=0, le=100)
    due_at: datetime | None = None

    @field_validator("due_at")
    @classmethod
    def normalize_audit_task_due_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


class DemoDayCriterion(BaseModel):
    key: str = Field(min_length=2, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    weight: int = Field(ge=1, le=100)
    max_score: int = Field(default=10, ge=2, le=100)


class DemoDayCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    starts_at: datetime | None = None
    criteria: list[DemoDayCriterion] = Field(min_length=1, max_length=10)

    @field_validator("starts_at")
    @classmethod
    def normalize_demo_day_starts_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @model_validator(mode="after")
    def validate_demo_day_criteria(self):
        keys = [criterion.key for criterion in self.criteria]
        if len(keys) != len(set(keys)):
            raise ValueError("Критерии не должны повторяться")
        return self


class DemoDayStatusUpdate(BaseModel):
    status: Literal["open", "scoring", "finalized"]


class DemoDayExpertAssign(BaseModel):
    user_id: int = Field(gt=0)


class DemoDayProjectSelect(BaseModel):
    membership_id: int = Field(gt=0)
    selection_reason: str | None = Field(default=None, max_length=4000)


def normalize_demo_url(value: str | None) -> str | None:
    normalized = (value or "").strip()
    if normalized and not re.match(r"^https?://", normalized, flags=re.IGNORECASE):
        raise ValueError("Ссылка должна начинаться с http:// или https://")
    return normalized or None


class DemoDayMaterialsUpdate(BaseModel):
    pitch_title: str = Field(min_length=2, max_length=300)
    summary: str = Field(min_length=2, max_length=10000)
    presentation_url: str = Field(min_length=8, max_length=2000)
    video_url: str | None = Field(default=None, max_length=2000)
    attachments: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("presentation_url", "video_url")
    @classmethod
    def validate_demo_url(cls, value: str | None) -> str | None:
        return normalize_demo_url(value)

    @field_validator("attachments")
    @classmethod
    def validate_demo_attachments(cls, value: list[str]) -> list[str]:
        result: list[str] = []
        for item in value:
            normalized = normalize_demo_url(item)
            if normalized and normalized not in result:
                result.append(normalized)
        return result


class DemoDayScoreUpsert(BaseModel):
    scores: dict[str, float] = Field(min_length=1, max_length=10)
    comment: str | None = Field(default=None, max_length=10000)
    recommendation: Literal["advance", "consider", "decline"]


class DemoDayProjectDecision(BaseModel):
    score_adjustment: float = Field(default=0, ge=-20, le=20)
    manager_note: str | None = Field(default=None, max_length=5000)
    outcome: Literal["winner", "finalist", "participant", "not_selected"] = "participant"


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
    assignment_type: Literal["text_files", "quiz"] = "text_files"
    submission_mode: Literal["individual", "team"] = "individual"
    quiz_questions: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    passing_score: int | None = Field(default=None, ge=0, le=100)
    max_attempts: int = Field(default=1, ge=1, le=20)

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
        if self.assignment_type == "quiz":
            if not self.quiz_questions:
                raise ValueError("Добавьте хотя бы один вопрос теста")
            if self.passing_score is None:
                raise ValueError("Укажите проходной балл теста")
            question_ids: set[str] = set()
            for index, question in enumerate(self.quiz_questions, start=1):
                question_id = str(question.get("id") or "").strip()
                prompt = str(question.get("prompt") or "").strip()
                options = question.get("options")
                if not question_id or not prompt or question_id in question_ids:
                    raise ValueError(f"Проверьте вопрос теста №{index}")
                if not isinstance(options, list) or len(options) < 2 or len(options) > 12:
                    raise ValueError(f"У вопроса №{index} должно быть от 2 до 12 вариантов")
                correct = 0
                option_ids: set[str] = set()
                for option in options:
                    option_id = str(option.get("id") or "").strip() if isinstance(option, dict) else ""
                    label = str(option.get("label") or "").strip() if isinstance(option, dict) else ""
                    if not option_id or not label or option_id in option_ids:
                        raise ValueError(f"Проверьте варианты ответа вопроса №{index}")
                    option_ids.add(option_id)
                    correct += int(option.get("correct") is True)
                if correct != 1:
                    raise ValueError(f"У вопроса №{index} должен быть один правильный ответ")
                question_ids.add(question_id)
        else:
            self.quiz_questions = []
            self.passing_score = None
            if self.max_attempts != 1:
                self.max_attempts = 1
        return self


class HomeworkSubmissionUpsert(BaseModel):
    answer_text: str | None = Field(default=None, max_length=30000)
    attachments: list[str] = Field(default_factory=list, max_length=10)
    quiz_answers: dict[str, str] = Field(default_factory=dict)

    @field_validator("attachments")
    @classmethod
    def validate_attachments(cls, value: list[str]) -> list[str]:
        cleaned = []
        for item in value:
            item = item.strip()
            if len(item) > 2000 or not item.startswith("/api/accelerators/files/"):
                raise ValueError("Файл ответа должен быть загружен в защищённое хранилище акселератора")
            cleaned.append(item)
        return cleaned

    @model_validator(mode="after")
    def require_answer(self):
        if not (self.answer_text or "").strip() and not self.attachments and not self.quiz_answers:
            raise ValueError("Добавьте текст, файл или ответы теста")
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


class ProgramActionCreate(BaseModel):
    action_type: Literal[
        "chat", "roadmap", "research", "custdev", "grants", "presentation"
    ]
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    required: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


class ProgramStageCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str | None = Field(default=None, max_length=30000)
    unlock_at: datetime | None = None
    required: bool = True
    materials: list[ProgramMaterialCreate] = Field(default_factory=list, max_length=100)
    actions: list[ProgramActionCreate] = Field(default_factory=list, max_length=20)

    @field_validator("unlock_at")
    @classmethod
    def normalize_unlock_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


class AcceleratorArtifactUpdate(BaseModel):
    status: Literal["started", "ready", "failed"] | None = None
    title: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=10000)
    url: str | None = Field(default=None, max_length=2000)
    source_type: Literal[
        "chat_session", "research_job", "roadmap", "grant_application", "external"
    ] | None = None
    source_id: str | None = Field(default=None, max_length=100)
    share_with_organizer: bool | None = None
    share_with_tracker: bool | None = None

    @field_validator("url")
    @classmethod
    def validate_artifact_url(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if value and not value.lower().startswith(("https://", "http://", "/")):
            raise ValueError("Ссылка должна быть внутренним путём или http(s)-адресом")
        return value or None

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
    event_type: Literal["webinar", "workshop", "tracker_session", "expert_session", "networking", "other"] = "webinar"
    host_name: str | None = Field(default=None, max_length=300)
    starts_at: datetime
    ends_at: datetime
    event_format: Literal["online", "offline", "hybrid"] = "online"
    location: str | None = Field(default=None, max_length=500)
    meeting_url: str | None = Field(default=None, max_length=2000)
    online_platform: str | None = Field(default=None, max_length=120)
    recording_url: str | None = Field(default=None, max_length=2000)
    venue_details: str | None = Field(default=None, max_length=2000)
    map_url: str | None = Field(default=None, max_length=2000)
    outcome: str | None = Field(default=None, max_length=10000)
    next_step: str | None = Field(default=None, max_length=5000)
    post_materials: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    homework_links: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
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
        if self.event_format in ("online", "hybrid") and not (self.meeting_url or "").strip():
            raise ValueError("Для онлайн- или гибридного мероприятия укажите ссылку на подключение")
        if self.meeting_url and not self.meeting_url.strip().lower().startswith(("https://", "http://")):
            raise ValueError("Ссылка на подключение должна начинаться с http:// или https://")
        if self.recording_url and not self.recording_url.strip().lower().startswith(("https://", "http://")):
            raise ValueError("Ссылка на запись должна начинаться с http:// или https://")
        if self.map_url and not self.map_url.strip().lower().startswith(("https://", "http://")):
            raise ValueError("Ссылка на карту должна начинаться с http:// или https://")
        material_urls: set[str] = set()
        for material in self.post_materials:
            title = str(material.get("title") or "").strip() if isinstance(material, dict) else ""
            url = str(material.get("url") or "").strip() if isinstance(material, dict) else ""
            if not title or len(title) > 300 or not url.lower().startswith(("https://", "http://")):
                raise ValueError("У каждого итогового материала должны быть название и http(s)-ссылка")
            if url in material_urls:
                raise ValueError("Ссылки на итоговые материалы не должны повторяться")
            material_urls.add(url)
        assignment_ids: set[int] = set()
        for link in self.homework_links:
            assignment_id = link.get("assignment_id") if isinstance(link, dict) else None
            relation = link.get("relation") if isinstance(link, dict) else None
            if not isinstance(assignment_id, int) or assignment_id <= 0 or relation not in {"before", "during", "after"}:
                raise ValueError("Проверьте связанные задания и их роль")
            if assignment_id in assignment_ids:
                raise ValueError("Одно задание нельзя прикрепить к мероприятию дважды")
            assignment_ids.add(assignment_id)
        return self


class EventReschedule(BaseModel):
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(min_length=2, max_length=4000)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def normalize_event_datetime(cls, value: datetime) -> datetime:
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Окончание мероприятия должно быть позже начала")
        return self


class EventCancel(BaseModel):
    reason: str = Field(min_length=2, max_length=4000)


class EventFollowupUpdate(BaseModel):
    recording_url: str | None = Field(default=None, max_length=2000)
    outcome: str | None = Field(default=None, max_length=10000)
    next_step: str | None = Field(default=None, max_length=5000)
    post_materials: list[dict[str, Any]] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_followup(self):
        if self.recording_url and not self.recording_url.strip().lower().startswith(("https://", "http://")):
            raise ValueError("Ссылка на запись должна начинаться с http:// или https://")
        seen: set[str] = set()
        for material in self.post_materials:
            title = str(material.get("title") or "").strip() if isinstance(material, dict) else ""
            url = str(material.get("url") or "").strip() if isinstance(material, dict) else ""
            if not title or len(title) > 300 or not url.lower().startswith(("https://", "http://")):
                raise ValueError("У каждого итогового материала должны быть название и http(s)-ссылка")
            if url in seen:
                raise ValueError("Ссылки на итоговые материалы не должны повторяться")
            seen.add(url)
        return self


PitchyHomeworkTool = Literal[
    "chat", "research", "roadmap", "custdev", "grants", "presentation"
]


class HomeworkPitchyCohortUpdate(BaseModel):
    enabled: bool


class HomeworkPitchyToolsUpdate(BaseModel):
    tools: list[PitchyHomeworkTool] = Field(default_factory=list, max_length=6)

    @field_validator("tools")
    @classmethod
    def unique_tools(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Инструменты Pitchy не должны повторяться")
        return value


class AttendanceMark(BaseModel):
    membership_id: int = Field(gt=0)
    status: Literal["present", "absent", "excused"]
    comment: str | None = Field(default=None, max_length=4000)


class FeedbackRead(BaseModel):
    feedback_ids: list[int] = Field(default_factory=list, max_length=100)

    @field_validator("feedback_ids")
    @classmethod
    def unique_feedback_ids(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value) or len(set(value)) != len(value):
            raise ValueError("Отзывы должны иметь уникальные положительные ID")
        return value


class RecommendationCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: str = Field(min_length=2, max_length=10000)
    section: Literal["program", "homework", "tracking", "matching", "project_audit"] | None = None
    href: str | None = Field(default=None, max_length=2000)

    @field_validator("href")
    @classmethod
    def validate_href(cls, value: str | None) -> str | None:
        normalized = (value or "").strip()
        if normalized and not normalized.startswith(("/", "https://", "http://")):
            raise ValueError("Ссылка должна быть внутренним путём или http(s)-адресом")
        return normalized or None


class TodayAIRecommendation(BaseModel):
    key: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=2, max_length=300)
    description: str = Field(min_length=2, max_length=1000)


class TodayAIRecommendationSelection(BaseModel):
    recommendations: list[TodayAIRecommendation] = Field(default_factory=list, max_length=3)
