from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AcceleratorTeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    max_members: int = Field(default=5, ge=2, le=20)


class AcceleratorTeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    max_members: int | None = Field(default=None, ge=2, le=20)
    status: Literal["archived"] | None = None
    reason: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def require_change(self):
        if not ({"name", "max_members", "status"} & self.model_fields_set):
            raise ValueError("Укажите изменение команды")
        return self


class AcceleratorTeamInvitationCreate(BaseModel):
    counterpart_profile_id: int = Field(gt=0)
    message: str | None = Field(default=None, max_length=1000)


class AcceleratorTeamInvitationUpdate(BaseModel):
    status: Literal["accepted", "declined"]


class AcceleratorTeamMemberUpdate(BaseModel):
    role: Literal["cofounder", "member"] | None = None
    title: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def require_change(self):
        if not ({"role", "title"} & self.model_fields_set):
            raise ValueError("Укажите роль или зону ответственности")
        return self


class AcceleratorTeamContactUpdate(BaseModel):
    share_contact: bool


class AcceleratorTeamPerson(BaseModel):
    id: int
    name: str
    email: str | None = None


class AcceleratorTeamProject(BaseModel):
    id: int
    name: str


class AcceleratorTeamMemberResponse(BaseModel):
    id: int
    membership_id: int
    role: Literal["owner", "cofounder", "member"]
    title: str | None = None
    status: Literal["active", "left"]
    share_contact: bool
    person: AcceleratorTeamPerson


class AcceleratorTeamBrief(BaseModel):
    id: int
    name: str
    project: AcceleratorTeamProject | None = None


class AcceleratorTeamInvitee(BaseModel):
    membership_id: int
    name: str
    email: str | None = None


class AcceleratorTeamInvitationResponse(BaseModel):
    id: int
    team_id: int
    status: Literal["pending", "accepted", "declined", "cancelled", "expired"]
    message: str | None = None
    expires_at: datetime
    created_at: datetime
    team: AcceleratorTeamBrief
    invitee: AcceleratorTeamInvitee
    invited_by: AcceleratorTeamPerson
    counterpart_profile_id: int | None = None
    can_respond: bool
    can_cancel: bool


class AcceleratorTeamResponse(BaseModel):
    id: int
    name: str
    status: Literal["active", "archived"]
    max_members: int
    owner_membership_id: int
    project: AcceleratorTeamProject | None = None
    can_manage: bool
    members: list[AcceleratorTeamMemberResponse]
    pending_invitations: list[AcceleratorTeamInvitationResponse]


class AcceleratorMembershipTeamResponse(BaseModel):
    team: AcceleratorTeamResponse | None = None
    invitations: list[AcceleratorTeamInvitationResponse]


class AcceleratorTeamListResponse(BaseModel):
    teams: list[AcceleratorTeamResponse]


class AcceleratorTeamInvitationListResponse(BaseModel):
    invitations: list[AcceleratorTeamInvitationResponse]
