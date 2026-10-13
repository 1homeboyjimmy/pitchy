"""Validated, atomic direct enrollment; no applications or outbound messages."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import secrets
import string

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from accelerator_service import add_audit, assign_quota_override, require_cohort_manager, normalize_resident_limits
from auth import hash_password
from login_identity import normalize_username
from models import (AcceleratorCohort, AcceleratorMembership, AcceleratorMembershipEvent,
                    AcceleratorParticipantProfile, AcceleratorProgramConfig, AcceleratorResidentImport,
                    AcceleratorTeam, AcceleratorTeamMember, Project, ProjectTree, User)
import passport as passport_lib
from project_breakdown import ADDITIONAL_PATH, DESCRIPTION_PATH, build_breakdown


class ImportParticipant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    source_rows: list[int] = Field(min_length=1)
    primary_project: str
    preferred_role: str = ""
    existing_user_id: int | None = None


class ImportProject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=2, max_length=200)
    owner: str
    members: list[str] = Field(min_length=1)
    fields: dict = Field(default_factory=dict)
    source_descriptions: list[dict] = Field(default_factory=list)
    field_sources: dict[str, list[int]] = Field(default_factory=dict)
    reviewed: bool = False
    placeholder: bool = False


class ResidentImportManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    batch_key: str = Field(min_length=1, max_length=100)
    source_url: str
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    participants: list[ImportParticipant] = Field(min_length=1)
    projects: list[ImportProject] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_topology(self):
        usernames = [normalize_username(row.username) for row in self.participants]
        if len(set(usernames)) != len(usernames):
            raise ValueError("Повторный Telegram-ник в пакете")
        participant_map = dict(zip(usernames, self.participants))
        projects = {row.key: row for row in self.projects}
        if len(projects) != len(self.projects):
            raise ValueError("Повторный ключ проекта")
        allowed = {field["path"] for field in passport_lib.PASSPORT_FIELDS} | {ADDITIONAL_PATH, DESCRIPTION_PATH}
        import roadmap_service
        allowed |= {field["path"] for field in roadmap_service.all_field_definitions()}
        list_paths = {field["path"] for field in passport_lib.PASSPORT_FIELDS if field.get("list")}
        for project in self.projects:
            project.owner = normalize_username(project.owner)
            project.members = [normalize_username(name) for name in project.members]
            if len(set(project.members)) != len(project.members) or project.owner not in project.members:
                raise ValueError("Некорректный состав или капитан проекта")
            if not set(project.members).issubset(participant_map):
                raise ValueError("Участник проекта отсутствует в пакете")
            if not project.reviewed or not set(project.fields).issubset(allowed):
                raise ValueError("Паспорт не проверен или содержит неизвестные поля")
            source_rows = set()
            for description in project.source_descriptions:
                if set(description) != {"row", "text"} or not isinstance(description["row"], int) or not isinstance(description["text"], str):
                    raise ValueError("Некорректный исходный ответ")
                source_rows.add(description["row"])
            if not source_rows.issubset({row for name in project.members for row in participant_map[name].source_rows}):
                raise ValueError("Источник проекта принадлежит другому участнику")
            if not project.placeholder and not source_rows:
                raise ValueError("Нет исходных описаний проекта")
            for path, value in project.fields.items():
                if path in list_paths:
                    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                        raise ValueError("Команда и конкуренты должны быть списками строк")
                elif not isinstance(value, (str, int, float)) or isinstance(value, bool):
                    raise ValueError("Некорректный тип поля паспорта")
                if passport_lib._is_filled(value) and not project.placeholder:
                    evidence = project.field_sources.get(path, [])
                    if not evidence or not set(evidence).issubset(source_rows):
                        raise ValueError("Заполненное поле не связано с исходным ответом")
            if project.placeholder and project.fields:
                raise ValueError("Заготовка должна иметь пустой паспорт")
        for username, participant in participant_map.items():
            participant.username = username
            if participant.primary_project not in projects or username not in projects[participant.primary_project].members:
                raise ValueError("Не указан основной проект участника")
        for project in self.projects:
            if len(project.members) > 1 and any(participant_map[name].primary_project != project.key for name in project.members):
                raise ValueError("Общий проект должен быть основным для всей команды")
        return self


def manifest_digest(manifest):
    return hashlib.sha256(json.dumps(manifest.model_dump(), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def generate_password():
    groups = (string.ascii_uppercase, string.ascii_lowercase, string.digits, "!@#$%^&*_-+=?")
    alphabet = "".join(groups)
    result = [secrets.choice(group) for group in groups] + [secrets.choice(alphabet) for _ in range(12)]
    secrets.SystemRandom().shuffle(result)
    return "".join(result)


async def import_residents(db, *, cohort_id: int, actor: User, manifest: ResidentImportManifest, dry_run=True):
    """Caller owns the transaction. Credentials are returned separately, never logged/stored in result."""
    # Lock the cohort to serialize separate imports as well as retries.
    cohort = (await db.execute(select(AcceleratorCohort).where(AcceleratorCohort.id == cohort_id).with_for_update())).scalar_one_or_none()
    if not cohort:
        raise HTTPException(404, "Поток не найден")
    if not actor.is_active or actor.deleted_at:
        raise HTTPException(403, "Организатор недоступен")
    await require_cohort_manager(db, actor, cohort)
    if cohort.status in {"completed", "archived"} or (cohort.ends_at and cohort.ends_at <= datetime.utcnow()):
        raise HTTPException(409, "Поток завершён")
    digest = manifest_digest(manifest)
    previous = (await db.execute(select(AcceleratorResidentImport).where(
        AcceleratorResidentImport.cohort_id == cohort_id, AcceleratorResidentImport.batch_key == manifest.batch_key,
    ))).scalar_one_or_none()
    if previous:
        if previous.digest != digest:
            raise HTTPException(409, "Пакет с этим ключом уже импортирован с другими данными")
        return {**previous.result, "already_imported": True}, []
    if not cohort.default_quota_config:
        raise HTTPException(409, "В потоке не настроены лимиты участников")
    normalize_resident_limits(cohort.default_quota_config)
    if any(len(project.members) > 1 for project in manifest.projects):
        config = (await db.execute(select(AcceleratorProgramConfig).where(AcceleratorProgramConfig.cohort_id == cohort_id))).scalar_one_or_none()
        if not config or not (config.modules or {}).get("matchmaking"):
            raise HTTPException(409, "В потоке должен быть включён модуль команд (матчмейкинг)")
    users = {}
    for row in manifest.participants:
        user = (await db.execute(select(User).where(User.username == row.username).with_for_update())).scalar_one_or_none()
        if row.existing_user_id is not None:
            mapped_user = await db.get(User, row.existing_user_id)
            if not mapped_user or (user and mapped_user.id != user.id) or mapped_user.username not in (None, row.username):
                raise HTTPException(409, "Конфликт существующего аккаунта и логина")
            user = mapped_user
        if user:
            if not user.is_active or user.deleted_at:
                raise HTTPException(409, "Аккаунт заблокирован или удалён")
            if not user.password_hash:
                raise HTTPException(409, "Для существующего аккаунта без пароля необходима отдельная активация")
            existing = (await db.execute(select(AcceleratorMembership.id).where(
                AcceleratorMembership.cohort_id == cohort_id, AcceleratorMembership.user_id == user.id,
            ))).scalar_one_or_none()
            if existing:
                raise HTTPException(409, "Участник уже состоит в потоке вне этого пакета")
        users[row.username] = user
    mapped_ids = [user.id for user in users.values() if user]
    if len(mapped_ids) != len(set(mapped_ids)):
        raise HTTPException(409, "Несколько логинов указывают на один аккаунт")
    preview = {"batch_key": manifest.batch_key, "digest": digest, "participants": len(manifest.participants),
               "projects": len(manifest.projects), "teams": sum(len(project.members) > 1 for project in manifest.projects),
               "new_accounts": sum(user is None for user in users.values()), "already_imported": False}
    if dry_run:
        return {**preview, "dry_run": True}, []
    now = datetime.utcnow()
    credentials = []
    passwords = set()
    for row in manifest.participants:
        user = users[row.username]
        if user is None:
            password = generate_password()
            while password in passwords:
                password = generate_password()
            passwords.add(password)
            user = User(email=None, username=row.username, name="@" + row.username, password_hash=hash_password(password),
                        email_verified=False, local_login_enabled=True, is_active=True)
            db.add(user)
            await db.flush()
            users[row.username] = user
            credentials.append({"username": row.username, "password": password})
        else:
            user.username = row.username
            user.local_login_enabled = True
    projects = {}
    for spec in manifest.projects:
        passport = passport_lib.merge_patch({}, spec.fields, source="import")
        passport["_import"] = {"batch_key": manifest.batch_key, "source_sha256": manifest.source_sha256, "uniform_categories": True}
        for path, evidence in spec.field_sources.items():
            if path in passport.get("_meta", {}):
                passport["_meta"][path]["source_rows"] = evidence
        project = Project(user_id=users[spec.owner].id, name=spec.name, passport=passport,
                          readiness_index=passport_lib.compute_readiness(passport), passport_updated_at=now)
        db.add(project)
        await db.flush()
        projects[spec.key] = project
        db.add(ProjectTree(user_id=users[spec.owner].id, project_id=project.id, title=spec.name,
                           source_type="import", source_text=json.dumps(spec.source_descriptions, ensure_ascii=False),
                           tree_data=build_breakdown(passport), readiness_index=project.readiness_index, status="ready"))
    memberships = {}
    for row in manifest.participants:
        membership = AcceleratorMembership(cohort_id=cohort.id, user_id=users[row.username].id,
            project_id=projects[row.primary_project].id, application_id=None, role="resident", status="enrolled",
            accepted_by_user_id=actor.id, accepted_at=now, enrolled_at=now,
            status_changed_by_user_id=actor.id, status_reason="Прямое зачисление по реестру участников")
        db.add(membership)
        await db.flush()
        memberships[row.username] = membership
        db.add(AcceleratorMembershipEvent(membership_id=membership.id, from_status=None, to_status="enrolled",
                                         actor_user_id=actor.id, reason=membership.status_reason))
        db.add(AcceleratorParticipantProfile(membership_id=membership.id,
            profile={"telegram": "@" + row.username, "preferred_role": row.preferred_role, "source_rows": row.source_rows,
                     "import_batch": manifest.batch_key}, visibility={"organizer": True, "mentor": False, "public": False}))
        if cohort.default_quota_config:
            await assign_quota_override(db, membership=membership, source="cohort", limits=cohort.default_quota_config,
                created_by_user_id=actor.id, starts_at=now, ends_at=cohort.ends_at, reason="Шаблон лимитов при прямом зачислении")
        add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=actor.id,
                  action="resident.imported_enrolled", target_type="membership", target_id=membership.id,
                  details={"batch_key": manifest.batch_key, "project_id": membership.project_id})
    team_ids = []
    for spec in manifest.projects:
        if len(spec.members) == 1:
            continue
        team = AcceleratorTeam(cohort_id=cohort.id, project_id=projects[spec.key].id,
            owner_membership_id=memberships[spec.owner].id, name="Команда " + spec.name[:192],
            max_members=max(5, len(spec.members)), recruiting_open=False, status="active", created_by_user_id=actor.id)
        db.add(team)
        await db.flush()
        team_ids.append(team.id)
        for username in spec.members:
            db.add(AcceleratorTeamMember(team_id=team.id, membership_id=memberships[username].id,
                role="owner" if username == spec.owner else "member", share_contact=False, status="active"))
        add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=actor.id,
                  action="team.imported", target_type="team", target_id=team.id,
                  details={"batch_key": manifest.batch_key, "project_id": team.project_id})
    result = {**preview, "dry_run": False, "users": {name: user.id for name, user in users.items()},
              "projects_by_key": {key: project.id for key, project in projects.items()},
              "memberships": {name: membership.id for name, membership in memberships.items()}, "team_ids": team_ids}
    db.add(AcceleratorResidentImport(cohort_id=cohort.id, batch_key=manifest.batch_key, digest=digest, result=result))
    await db.flush()
    return result, credentials
