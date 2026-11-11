"""Private cohort participant fields; tags can only be assigned by managers."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

PARTICIPANT_TAGS = {
    "student_startup": "Участник Студенческий стартап",
    "startup_diploma": "Участник программы «Стартап как диплом»",
}
PRIVATE_FIELDS = {"study_group", "education_direction", "education_course", "employment"}

class ParticipantProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    study_group: str | None = Field(default=None, max_length=100)
    education_direction: str | None = Field(default=None, max_length=100)
    education_course: str | None = Field(default=None, pattern=r"^(БАК|МАГ|СПЕЦ|АСП)-[1-9][0-9]?$", max_length=20)
    employment: Literal["working", "not_working"] | None = None
    tags: list[Literal["student_startup", "startup_diploma"]] | None = None

def visible_profile(profile: dict, *, private: bool) -> dict:
    return {key: value for key, value in profile.items() if private or key not in PRIVATE_FIELDS}

def registration_required(profile: dict) -> bool:
    return bool(profile.get("registration_required") and profile.get("employment") not in {"working", "not_working"})
