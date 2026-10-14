"""Validated, atomic direct enrollment; no applications or outbound messages."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import secrets
import string

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select

from accelerator_service import add_audit, assign_quota_override, require_cohort_manager, normalize_resident_limits
from auth import hash_password
from login_identity import normalize_import_identity
from models import (AcceleratorCohort, AcceleratorMembership, AcceleratorMembershipEvent,
                    AcceleratorParticipantProfile, AcceleratorProgramConfig, AcceleratorResidentImport,
                    AcceleratorTeam, AcceleratorTeamMember, AcceleratorProjectMember, Project, ProjectTree, User)
import passport as passport_lib
from project_breakdown import ADDITIONAL_PATH, DESCRIPTION_PATH, build_breakdown


class ImportParticipant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    source_rows: list[int] = Field(min_length=1)
    primary_project: str
    preferred_role: str = ""
    existing_user_id: int | None = None
    existing_membership_id: int | None = None


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
    existing_project_id: int | None = None
    secondary_shared: bool = False
    append_team_members: list[str] = Field(default_factory=list)


class ResidentImportManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    batch_key: str = Field(min_length=1, max_length=100)
    source_url: str
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    participants: list[ImportParticipant] = Field(min_length=1)
    projects: list[ImportProject] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_topology(self):
        usernames = [normalize_import_identity(row.username) for row in self.participants]
        if len(set(usernames)) != len(usernames):
            raise ValueError("Повторный Telegram-ник в пакете")
        participant_map = dict(zip(usernames, self.participants))
        projects = {row.key: row for row in self.projects}
        if len(projects) != len(self.projects):
            raise ValueError("Повторный ключ проекта")
        existing_ids = [p.existing_project_id for p in self.projects if p.existing_project_id is not None]
        if len(set(existing_ids)) != len(existing_ids):
            raise ValueError("Один существующий паспорт указан несколько раз")
        allowed = {field["path"] for field in passport_lib.PASSPORT_FIELDS} | {ADDITIONAL_PATH, DESCRIPTION_PATH}
        import roadmap_service
        allowed |= {field["path"] for field in roadmap_service.all_field_definitions()}
        list_paths = {field["path"] for field in passport_lib.PASSPORT_FIELDS if field.get("list")}
        for project in self.projects:
            project.owner = normalize_import_identity(project.owner)
            project.members = [normalize_import_identity(name) for name in project.members]
            if len(set(project.members)) != len(project.members) or project.owner not in project.members:
                raise ValueError("Некорректный состав или капитан проекта")
            if not set(project.members).issubset(participant_map):
                raise ValueError("Участник проекта отсутствует в пакете")
            project.append_team_members = [normalize_import_identity(name) for name in project.append_team_members]
            if not set(project.append_team_members).issubset(project.members) or (project.append_team_members and project.existing_project_id is None):
                raise ValueError("Дополнение состава допустимо только для проверенного существующего проекта")
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
            if len(project.members) > 1 and not project.secondary_shared and any(participant_map[name].primary_project != project.key for name in project.members):
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
    reused_memberships = {}
    for row in manifest.participants:
        email_login = '@' in row.username
        identity_condition = func.lower(User.email) == row.username if email_login else User.username == row.username
        user = (await db.execute(select(User).where(identity_condition).with_for_update())).scalar_one_or_none()
        if row.existing_user_id is not None:
            mapped_user = await db.get(User, row.existing_user_id)
            mapped_identity_matches = mapped_user and ((mapped_user.email or '').lower() == row.username if email_login else mapped_user.username in (None, row.username))
            if not mapped_identity_matches or (user and mapped_user.id != user.id):
                raise HTTPException(409, "Конфликт существующего аккаунта и логина")
            user = mapped_user
        if user:
            if not user.is_active or user.deleted_at:
                raise HTTPException(409, "Аккаунт заблокирован или удалён")
            if not user.password_hash:
                raise HTTPException(409, "Для существующего аккаунта без пароля необходима отдельная активация")
            existing = (await db.execute(select(AcceleratorMembership).where(
                AcceleratorMembership.cohort_id == cohort_id, AcceleratorMembership.user_id == user.id,
            ))).scalar_one_or_none()
            if existing:
                if row.existing_membership_id != existing.id or existing.role != 'resident' or existing.status != 'enrolled':
                    raise HTTPException(409, "Участник уже состоит в потоке вне этого пакета")
                reused_memberships[row.username] = existing
            elif row.existing_membership_id is not None:
                raise HTTPException(409, "Существующее участие не найдено")
        elif row.existing_membership_id is not None:
            raise HTTPException(409, "Существующее участие не связано с аккаунтом")
        users[row.username] = user
    mapped_ids = [user.id for user in users.values() if user]
    if len(mapped_ids) != len(set(mapped_ids)):
        raise HTTPException(409, "Несколько логинов указывают на один аккаунт")
    reused_projects = {}
    reused_teams = {}
    for spec in manifest.projects:
        if spec.existing_project_id is not None:
            project = (await db.execute(select(Project).where(Project.id == spec.existing_project_id).with_for_update())).scalar_one_or_none()
            owner = users[spec.owner]
            tree = (await db.execute(select(ProjectTree.id).where(ProjectTree.project_id == spec.existing_project_id))).scalar_one_or_none()
            if not project or not owner or project.user_id != owner.id or project.status != 'active' or project.name != spec.name or tree is None:
                raise HTTPException(409, "Существующий паспорт не соответствует проверенному проекту")
            # Reuse never replaces existing content, including manual edits.
            if any(passport_lib._get_path(project.passport or {}, path) != value for path, value in spec.fields.items()):
                raise HTTPException(409, "Существующий паспорт изменился после сверки")
            if spec.append_team_members and (project.passport or {}).get('_meta',{}).get('team',{}).get('source') != 'import':
                raise HTTPException(409, "Состав проекта изменён вручную; автоматическое дополнение запрещено")
            reused_projects[spec.key] = project
        if len(spec.members) <= 1 or spec.secondary_shared:
            continue
        team = (await db.execute(select(AcceleratorTeam).where(AcceleratorTeam.cohort_id == cohort.id,
            AcceleratorTeam.project_id == spec.existing_project_id, AcceleratorTeam.status == 'active').with_for_update())).scalar_one_or_none() if spec.existing_project_id else None
        if team:
            owner_membership = reused_memberships.get(spec.owner)
            if not owner_membership or team.owner_membership_id != owner_membership.id:
                raise HTTPException(409, "Капитан существующей команды изменился")
            current_members = (await db.execute(select(AcceleratorTeamMember.membership_id).where(
                AcceleratorTeamMember.team_id == team.id, AcceleratorTeamMember.status == 'active'))).scalars().all()
            intended = {reused_memberships[name].id for name in spec.members if name in reused_memberships}
            if not set(current_members).issubset(intended):
                raise HTTPException(409, "В команде есть участники вне проверенного пакета")
            reused_teams[spec.key] = team
        for name in spec.members:
            if name not in reused_memberships:
                continue
            active_team = (await db.execute(select(AcceleratorTeamMember.team_id).where(
                AcceleratorTeamMember.membership_id == reused_memberships[name].id, AcceleratorTeamMember.status == 'active'))).scalar_one_or_none()
            if active_team is not None and (team is None or active_team != team.id):
                raise HTTPException(409, "Участник уже состоит в другой активной команде")
    for row in manifest.participants:
        if row.username in reused_memberships:
            main = reused_projects.get(row.primary_project)
            if main is None or reused_memberships[row.username].project_id != main.id:
                raise HTTPException(409, "Основной проект существующего участника изменился; требуется отдельный выбор")
    preview = {"batch_key": manifest.batch_key, "digest": digest, "participants": len(manifest.participants),
               "projects": len(manifest.projects), "teams": sum(len(project.members) > 1 and not project.secondary_shared for project in manifest.projects),
               "shared_projects": sum(len(project.members) > 1 for project in manifest.projects),
               "new_accounts": sum(user is None for user in users.values()), "already_imported": False,
               "reused_memberships": len(reused_memberships), "new_memberships": len(manifest.participants)-len(reused_memberships),
               "reused_projects": len(reused_projects), "new_projects": len(manifest.projects)-len(reused_projects)}
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
            email_login = '@' in row.username
            user = User(email=row.username if email_login else None, username=None if email_login else row.username,
                        name=row.username if email_login else "@" + row.username, password_hash=hash_password(password),
                        email_verified=False, local_login_enabled=True, is_active=True)
            db.add(user)
            await db.flush()
            users[row.username] = user
            credentials.append({"username": row.username, "password": password})
        else:
            if '@' not in row.username:
                user.username = row.username
            user.local_login_enabled = True
    projects = {}
    for spec in manifest.projects:
        if spec.key in reused_projects:
            projects[spec.key] = reused_projects[spec.key]
            continue
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
        if row.username in reused_memberships:
            memberships[row.username] = reused_memberships[row.username]
            continue
        membership = AcceleratorMembership(cohort_id=cohort.id, user_id=users[row.username].id,
            project_id=projects[row.primary_project].id, application_id=None, role="resident", status="enrolled",
            accepted_by_user_id=actor.id, accepted_at=now, enrolled_at=now,
            status_changed_by_user_id=actor.id, status_reason="Прямое зачисление по реестру участников")
        db.add(membership)
        await db.flush()
        memberships[row.username] = membership
        db.add(AcceleratorMembershipEvent(membership_id=membership.id, from_status=None, to_status="enrolled",
                                         actor_user_id=actor.id, reason=membership.status_reason))
        contact = {'email':row.username} if '@' in row.username else {'telegram':'@' + row.username}
        db.add(AcceleratorParticipantProfile(membership_id=membership.id,
            profile={**contact, "preferred_role": row.preferred_role, "source_rows": row.source_rows,
                     "import_batch": manifest.batch_key}, visibility={"organizer": True, "mentor": False, "public": False}))
        if cohort.default_quota_config:
            await assign_quota_override(db, membership=membership, source="cohort", limits=cohort.default_quota_config,
                created_by_user_id=actor.id, starts_at=now, ends_at=cohort.ends_at, reason="Шаблон лимитов при прямом зачислении")
        add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=actor.id,
                  action="resident.imported_enrolled", target_type="membership", target_id=membership.id,
                  details={"batch_key": manifest.batch_key, "project_id": membership.project_id})
    team_ids = []
    project_teams = {}
    for spec in manifest.projects:
        if len(spec.members) == 1 or spec.secondary_shared:
            continue
        team = reused_teams.get(spec.key)
        if team is None:
            team = AcceleratorTeam(cohort_id=cohort.id, project_id=projects[spec.key].id,
                owner_membership_id=memberships[spec.owner].id, name="Команда " + spec.name[:192],
                max_members=max(5, len(spec.members)), recruiting_open=False, status="active", created_by_user_id=actor.id)
            db.add(team)
            await db.flush()
        else:
            team.max_members = max(team.max_members, len(spec.members))
        team_ids.append(team.id)
        project_teams[spec.key] = team
        for username in spec.members:
            existing_member = (await db.execute(select(AcceleratorTeamMember).where(AcceleratorTeamMember.team_id == team.id,
                AcceleratorTeamMember.membership_id == memberships[username].id))).scalar_one_or_none()
            if existing_member:
                if existing_member.status != 'active':
                    raise HTTPException(409, "Участник ранее покинул команду; автоматический возврат запрещён")
                continue
            db.add(AcceleratorTeamMember(team_id=team.id, membership_id=memberships[username].id,
                role="owner" if username == spec.owner else "member", share_contact=False, status="active"))
        add_audit(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id, actor_user_id=actor.id,
                  action="team.imported", target_type="team", target_id=team.id,
                  details={"batch_key": manifest.batch_key, "project_id": team.project_id})
    for spec in manifest.projects:
        if len(spec.members) <= 1:
            continue
        team = project_teams.get(spec.key)
        if team is None:
            primaries = {next(p.primary_project for p in manifest.participants if p.username == name) for name in spec.members}
            if len(primaries) == 1:
                primary_key = next(iter(primaries))
                candidate = project_teams.get(primary_key)
                primary_spec = next(p for p in manifest.projects if p.key == primary_key)
                if candidate and set(primary_spec.members) == set(spec.members):
                    team = candidate
        for name in spec.members:
            grant = (await db.execute(select(AcceleratorProjectMember).where(
                AcceleratorProjectMember.membership_id == memberships[name].id, AcceleratorProjectMember.project_id == projects[spec.key].id))).scalar_one_or_none()
            if grant is None:
                db.add(AcceleratorProjectMember(membership_id=memberships[name].id, project_id=projects[spec.key].id,
                    team_id=team.id if team else None, status='active', created_by_user_id=actor.id))
            elif grant.status != 'active' or grant.team_id != (team.id if team else None):
                raise HTTPException(409, "Доступ к общему проекту изменился после сверки")
        if spec.append_team_members:
            from project_breakdown import sync_project_breakdown
            project = projects[spec.key]
            current_team = list((project.passport or {}).get('team') or [])
            current_team.extend('@' + name + ' — участник проекта' for name in spec.append_team_members)
            project.passport = passport_lib.merge_patch(project.passport, {'team':current_team}, source='import')
            project.readiness_index = passport_lib.compute_readiness(project.passport)
            project.passport_updated_at = now
            await sync_project_breakdown(db, project)
    result = {**preview, "dry_run": False, "users": {name: user.id for name, user in users.items()},
              "projects_by_key": {key: project.id for key, project in projects.items()},
              "memberships": {name: membership.id for name, membership in memberships.items()}, "team_ids": team_ids}
    db.add(AcceleratorResidentImport(cohort_id=cohort.id, batch_key=manifest.batch_key, digest=digest, result=result))
    await db.flush()
    return result, credentials
