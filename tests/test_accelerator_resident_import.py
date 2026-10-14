from copy import deepcopy
from datetime import datetime, timedelta
import json
import string
from unittest.mock import patch
from types import SimpleNamespace
import sys
import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import func, select

from accelerator_resident_import import ResidentImportManifest, generate_password, import_residents
from auth import hash_password, verify_password
from db_async import AsyncSessionLocal
from models import (Accelerator, AcceleratorApplication, AcceleratorCohort, AcceleratorMembership,
    AcceleratorNotificationOutbox, AcceleratorProgramConfig, AcceleratorResidentImport,
    AcceleratorResidentQuotaOverride, AcceleratorTeam, AcceleratorTeamMember, Project, ProjectTree, User)
from project_access import get_accessible_project
from project_breakdown import CATEGORIES, build_breakdown, save_breakdown_fields, sync_project_breakdown
from accelerator_project_selection import project_options, select_project


@pytest.mark.asyncio
async def test_username_login_email_compatibility_and_shared_lockout():
    from routers.auth import login
    from schemas.base import LoginRequest
    from starlette.requests import Request
    from starlette.responses import Response
    manifest = ResidentImportManifest.model_validate(manifest_data(False))
    request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1000)})
    mock_main = SimpleNamespace(_check_rate_limit=lambda ip: None, get_client_ip=lambda request: "127.0.0.1")
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        result, credentials = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
        await db.commit()
        credential = credentials[0]
        user = await db.get(User, result["users"][credential["username"]])
        with patch.dict(sys.modules, {"main": mock_main}):
            token = await login(LoginRequest(email=" @" + credential["username"].upper() + " ", password=credential["password"]), request, Response(), db)
            assert token.access_token and not user.email_verified
            user.email = uuid.uuid4().hex + "@example.test"
            user.email_verified = True
            await db.commit()
            assert (await login(LoginRequest(email=user.email.upper(), password=credential["password"]), request, Response(), db)).access_token
            for index in range(5):
                with pytest.raises(HTTPException) as error:
                    await login(LoginRequest(email=user.email if index % 2 else user.username, password="Wrong123!"), request, Response(), db)
                assert error.value.status_code == 401
            with pytest.raises(HTTPException) as error:
                await login(LoginRequest(email=user.username, password=credential["password"]), request, Response(), db)
            assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_username_only_account_receives_in_app_notifications_without_email():
    from accelerator_notification_service import enqueue_notification, process_notification_event
    from models import AcceleratorNotification
    manifest = ResidentImportManifest.model_validate(manifest_data(False))
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        result, _ = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
        user_id = next(iter(result["users"].values()))
        event = await enqueue_notification(db, accelerator_id=cohort.accelerator_id, cohort_id=cohort.id,
            recipient_email=None, recipient_user_id=user_id, event_type="test", subject="Новое задание", body="Задание",
            idempotency_key=uuid.uuid4().hex)
        await db.commit()
        assert event.status == "suppressed"
        assert (await db.execute(select(AcceleratorNotification).where(AcceleratorNotification.user_id == user_id))).scalar_one().title == "Новое задание"
        with patch("accelerator_notification_service.send_email") as sender:
            await process_notification_event(event.id)
            sender.assert_not_called()


def manifest_data(team=True):
    prefix = "u" + uuid.uuid4().hex[:10]
    names = [prefix + "a", prefix + "b"] if team else [prefix + "a"]
    return {
        "batch_key": uuid.uuid4().hex, "source_url": "https://example.test/source", "source_sha256": "a" * 64,
        "participants": [{"username": name, "source_rows": [index + 2], "primary_project": "first"} for index, name in enumerate(names)],
        "projects": [{"key": "first", "name": "Проект", "owner": names[0], "members": names,
            "fields": {"core.name": "Проект", "core.problem": "Проблема", "core.solution": "Решение", "core.stage": "Идея"},
            "source_descriptions": [{"row": 2, "text": "Проект, проблема, решение. Идея."}],
            "field_sources": {path: [2] for path in ["core.name", "core.problem", "core.solution", "core.stage"]}, "reviewed": True}],
    }


async def seed(db):
    key = uuid.uuid4().hex
    actor = User(email=key + "@example.test", name="Admin", is_admin=True, is_active=True, email_verified=True)
    db.add(actor); await db.flush()
    accelerator = Accelerator(name="МТУСИ " + key, created_by_user_id=actor.id)
    db.add(accelerator); await db.flush()
    cohort = AcceleratorCohort(accelerator_id=accelerator.id, name="2026", status="active", created_by_user_id=actor.id,
        ends_at=datetime.utcnow() + timedelta(days=100), default_quota_config={"messages": 30, "roadmaps": 5, "custdev": 3, "grants": 3})
    db.add(cohort); await db.flush()
    db.add(AcceleratorProgramConfig(cohort_id=cohort.id, modules={"matchmaking": True}, updated_by_user_id=actor.id))
    await db.flush()
    return actor, cohort


def test_passwords_are_unique_ascii_and_have_all_required_groups():
    passwords = {generate_password() for _ in range(1000)}
    assert len(passwords) == 1000
    for password in passwords:
        assert len(password) == 16 and password.isascii()
        assert any(ch in string.ascii_uppercase for ch in password)
        assert any(ch in string.ascii_lowercase for ch in password)
        assert any(ch in string.digits for ch in password)
        assert any(ch in "!@#$%^&*_-+=?" for ch in password)


@pytest.mark.parametrize("kind", ["duplicate", "unreviewed", "source", "primary", "unsupported", "list"])
def test_manifest_rejects_invalid_packages(kind):
    data = manifest_data()
    if kind == "duplicate": data["participants"][1]["username"] = data["participants"][0]["username"]
    if kind == "unreviewed": data["projects"][0]["reviewed"] = False
    if kind == "source": data["projects"][0]["field_sources"]["core.problem"] = [99]
    if kind == "primary": data["participants"][0]["primary_project"] = "missing"
    if kind == "unsupported": data["projects"][0]["fields"]["unknown"] = "value"
    if kind == "list": data["projects"][0]["fields"]["team"] = "text"
    with pytest.raises(ValueError): ResidentImportManifest.model_validate(data)


@pytest.mark.asyncio
async def test_preview_and_direct_enrollment_without_applications_or_messages():
    manifest = ResidentImportManifest.model_validate(manifest_data())
    async with AsyncSessionLocal() as db:
        async with db.begin():
            actor, cohort = await seed(db)
            preview, credentials = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest)
            assert preview["dry_run"] and not credentials
            assert (await db.execute(select(User.id).where(User.username == manifest.participants[0].username))).scalar_one_or_none() is None
            result, credentials = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
            assert result["participants"] == 2 and result["projects"] == 1 and result["teams"] == 1
            assert (await db.execute(select(func.count()).select_from(AcceleratorApplication).where(AcceleratorApplication.cohort_id == cohort.id))).scalar_one() == 0
            assert (await db.execute(select(func.count()).select_from(AcceleratorNotificationOutbox).where(AcceleratorNotificationOutbox.cohort_id == cohort.id))).scalar_one() == 0
            for credential in credentials:
                user = await db.get(User, result["users"][credential["username"]])
                assert user.email is None and not user.email_verified and user.local_login_enabled
                assert verify_password(credential["password"], user.password_hash)
                membership = await db.get(AcceleratorMembership, result["memberships"][user.username])
                assert membership.status == "enrolled" and membership.application_id is None
                assert membership.project_id == result["projects_by_key"]["first"]
                assert (await db.execute(select(AcceleratorResidentQuotaOverride).where(AcceleratorResidentQuotaOverride.membership_id == membership.id))).scalar_one().source == "cohort"
                assert credential["password"] not in json.dumps(result)


@pytest.mark.asyncio
async def test_retry_preserves_passwords_user_edits_and_membership_status():
    manifest = ResidentImportManifest.model_validate(manifest_data(False))
    async with AsyncSessionLocal() as db:
        async with db.begin():
            actor, cohort = await seed(db)
            result, credentials = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
            user = await db.get(User, next(iter(result["users"].values())))
            old_hash = user.password_hash
            project = await db.get(Project, result["projects_by_key"]["first"])
            project.passport = {"core": {"stage": "Рост"}}
            membership = await db.get(AcceleratorMembership, next(iter(result["memberships"].values())))
            membership.status = "suspended"
            await db.flush()
            repeated, repeated_credentials = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
            assert repeated["already_imported"] and not repeated_credentials
            assert user.password_hash == old_hash and project.passport["core"]["stage"] == "Рост"
            assert membership.status == "suspended"
            changed = manifest.model_copy(deep=True)
            changed.projects[0].name = "Other"
            with pytest.raises(HTTPException) as error:
                await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=changed)
            assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_existing_username_preserves_password_and_email():
    manifest = ResidentImportManifest.model_validate(manifest_data(False))
    async with AsyncSessionLocal() as db:
        async with db.begin():
            actor, cohort = await seed(db)
            password_hash = hash_password("Existing123!")
            existing = User(username=manifest.participants[0].username, email=uuid.uuid4().hex + "@example.test", name="Existing", password_hash=password_hash)
            db.add(existing); await db.flush()
            original_email = existing.email
            result, credentials = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
            assert not credentials and result["new_accounts"] == 0
            assert existing.email == original_email and existing.password_hash == password_hash


@pytest.mark.asyncio
async def test_last_account_conflict_prevents_any_partial_writes():
    manifest = ResidentImportManifest.model_validate(manifest_data())
    async with AsyncSessionLocal() as db:
        async with db.begin():
            actor, cohort = await seed(db)
            db.add(User(username=manifest.participants[-1].username, name="Blocked", password_hash=hash_password("Blocked123!"), is_active=False))
            await db.flush()
            with pytest.raises(HTTPException):
                await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
            assert (await db.execute(select(User.id).where(User.username == manifest.participants[0].username))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_failed_write_rolls_back_all_accounts_and_projects():
    manifest = ResidentImportManifest.model_validate(manifest_data())
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        await db.commit()
        with pytest.raises(RuntimeError):
            async with db.begin():
                with patch("accelerator_resident_import.assign_quota_override", side_effect=RuntimeError("forced failure")):
                    await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
        assert (await db.execute(select(User.id).where(User.username == manifest.participants[0].username))).scalar_one_or_none() is None
        assert (await db.execute(select(AcceleratorResidentImport.id).where(AcceleratorResidentImport.batch_key == manifest.batch_key))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_shared_passport_access_sync_and_excluded_members():
    manifest = ResidentImportManifest.model_validate(manifest_data())
    async with AsyncSessionLocal() as db:
        async with db.begin():
            actor, cohort = await seed(db)
            result, _ = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
            member = await db.get(User, result["users"][manifest.participants[1].username])
            outsider = User(email=uuid.uuid4().hex + "@example.test", name="Outsider")
            db.add(outsider); await db.flush()
            project = await get_accessible_project(db, result["projects_by_key"]["first"], member)
            with pytest.raises(HTTPException): await get_accessible_project(db, project.id, outsider)
            with pytest.raises(HTTPException): await get_accessible_project(db, project.id, member, owner_only=True)
            tree = (await db.execute(select(ProjectTree).where(ProjectTree.project_id == project.id))).scalar_one()
            from project_memory_service import load_project_context, load_project_brief
            assert await load_project_context(db, project.id, user_id=member.id)
            await save_breakdown_fields(db, tree, "problem", {"core.problem": "Новая проблема"})
            assert project.passport["core"]["problem"] == "Новая проблема"
            assert tree.tree_data["nodes"][1]["data"]["form_data"]["core.problem"] == "Новая проблема"
            membership = await db.get(AcceleratorMembership, result["memberships"][member.username])
            membership.status = "suspended"; await db.flush()
            with pytest.raises(HTTPException): await get_accessible_project(db, project.id, member)
            assert not await load_project_context(db, project.id, user_id=member.id)
            assert not await load_project_brief(db, project.id, user_id=member.id)
            membership.status = "enrolled"
            team_member = (await db.execute(select(AcceleratorTeamMember).where(AcceleratorTeamMember.membership_id == membership.id))).scalar_one()
            team_member.status = "left"; await db.flush()
            with pytest.raises(HTTPException): await get_accessible_project(db, project.id, member)


@pytest.mark.asyncio
async def test_shared_project_passport_routes_and_captain_transfer():
    from projects_router import get_passport, patch_passport, list_projects
    from routers.accelerator_teams import transfer_team_captain
    from schemas.base import PassportPatchRequest
    from schemas.accelerator_teams import AcceleratorTeamCaptainTransfer
    manifest = ResidentImportManifest.model_validate(manifest_data())
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        result, _ = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
        await db.commit()
        old_owner = await db.get(User, result["users"][manifest.projects[0].owner])
        new_owner = await db.get(User, result["users"][manifest.participants[1].username])
        project_id = result["projects_by_key"]["first"]
        assert project_id in [project.id for project in await list_projects(False, new_owner, db)]
        assert (await get_passport(project_id, new_owner, db)).passport["core"]["problem"] == "Проблема"
        await patch_passport(project_id, PassportPatchRequest(fields={"core.problem": "Командная правка"}), new_owner, db)
        assert (await get_passport(project_id, old_owner, db)).passport["core"]["problem"] == "Командная правка"
        assert (await get_passport(project_id, actor, db)).passport["core"]["problem"] == "Командная правка"
        with pytest.raises(HTTPException):
            await patch_passport(project_id, PassportPatchRequest(fields={"core.problem": "Чужая правка"}), actor, db)
        await transfer_team_captain(result["team_ids"][0], AcceleratorTeamCaptainTransfer(membership_id=result["memberships"][new_owner.username]), old_owner, db)
        project = await db.get(Project, project_id)
        tree = (await db.execute(select(ProjectTree).where(ProjectTree.project_id == project_id))).scalar_one()
        assert project.user_id == new_owner.id and tree.user_id == new_owner.id
        old_member = (await db.execute(select(AcceleratorTeamMember).where(AcceleratorTeamMember.membership_id == result["memberships"][old_owner.username]))).scalar_one()
        old_member.status = "left"; await db.flush()
        with pytest.raises(HTTPException): await get_accessible_project(db, project_id, old_owner)
        assert (await get_accessible_project(db, project_id, new_owner)).id == project_id


def test_uniform_breakdown_does_not_invent_missing_values_or_truncate_text():
    long_text = "Смысл. " * 1000
    full = build_breakdown({"core": {"problem": long_text}})
    empty = build_breakdown({})
    assert [node["id"] for node in full["nodes"]] == [node["id"] for node in empty["nodes"]]
    assert len(full["nodes"]) == len(CATEGORIES) == 12
    assert full["nodes"][1]["data"]["summary"]["Проблема"] == long_text
    assert all(node["status"] == "empty" and not node["data"]["summary"] for node in empty["nodes"])
    import passport as passport_lib
    imported = passport_lib.merge_patch({}, {"core.problem": "Исходная проблема"}, source="import")
    assert not passport_lib.can_ai_overwrite(imported, "core.problem")
    assert passport_lib.can_ai_overwrite(imported, "core.geo")


def test_current_roadmap_categories_are_uniform_for_imported_projects():
    import roadmap_service
    passports = [{"_import": {"uniform_categories": True}}, {"_import": {"uniform_categories": True}, "core": {"stage": "Прототип (MVP)"}}]
    categories = [[checkpoint["id"] for checkpoint in roadmap_service.build_roadmap(passport)["checkpoints"]] for passport in passports]
    assert categories[0] == categories[1] and "additional" in categories[0]
    assert "additional" not in [checkpoint["id"] for checkpoint in roadmap_service.build_roadmap({})["checkpoints"]]


def test_credential_export_is_encrypted_and_authenticated():
    from credential_export import encrypt_export, decrypt_export
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    data = {"credentials": [{"username": "sample_user", "password": "Secret-test-123!"}]}
    encrypted = encrypt_export(data, public)
    assert "Secret-test-123!" not in json.dumps(encrypted)
    assert decrypt_export(encrypted, private) == data
    encrypted["ciphertext"] = encrypted["ciphertext"][:-5] + "AAAA="
    with pytest.raises(Exception): decrypt_export(encrypted, private)


@pytest.mark.asyncio
async def test_username_only_password_change_checks_current_password():
    from routers.auth import change_local_password
    from schemas.base import LocalPasswordChangeRequest
    manifest = ResidentImportManifest.model_validate(manifest_data(False))
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        result, credentials = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
        await db.commit()
        user = await db.get(User, next(iter(result["users"].values())))
        with pytest.raises(HTTPException):
            await change_local_password(LocalPasswordChangeRequest(current_password="Wrong123!", new_password="Changed123!"), user, db)
        await change_local_password(LocalPasswordChangeRequest(current_password=credentials[0]["password"], new_password="Changed123!"), user, db)
        assert verify_password("Changed123!", user.password_hash)
        assert not verify_password(credentials[0]["password"], user.password_hash)


@pytest.mark.asyncio
async def test_personal_project_selection_and_team_boundary():
    manifest = ResidentImportManifest.model_validate(manifest_data(False))
    async with AsyncSessionLocal() as db:
        async with db.begin():
            actor, cohort = await seed(db)
            result, _ = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
            user = await db.get(User, next(iter(result["users"].values())))
            membership_id = next(iter(result["memberships"].values()))
            extra = Project(user_id=user.id, name="Другая идея", passport={})
            foreign = Project(user_id=actor.id, name="Чужая идея", passport={})
            db.add_all([extra, foreign]); await db.flush()
            assert len((await project_options(db, membership_id, user))["projects"]) == 2
            assert (await select_project(db, membership_id, user, extra.id))["project_id"] == extra.id
            with pytest.raises(HTTPException): await select_project(db, membership_id, user, foreign.id)
            assert await db.get(Project, result["projects_by_key"]["first"])


@pytest.mark.asyncio
async def test_expanded_import_reuses_accounts_passports_and_memberships_with_scoped_secondary_access():
    from copy import deepcopy
    from models import AcceleratorProjectMember, AcceleratorResidentQuotaOverride
    from project_access import get_accessible_project
    from project_breakdown import sync_project_breakdown
    original_data = manifest_data()
    first_name, peer_name = [row['username'] for row in original_data['participants']]
    secondary = deepcopy(original_data['projects'][0])
    secondary.update(key='second', name='Вторая идея', owner=first_name, members=[first_name])
    secondary['fields']['core.name'] = 'Вторая идея'
    original_data['projects'].append(secondary)
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        original, credentials = await import_residents(db, cohort_id=cohort.id, actor=actor,
            manifest=ResidentImportManifest.model_validate(original_data), dry_run=False)
        await db.commit()
        owner = await db.get(User, original['users'][first_name])
        peer = await db.get(User, original['users'][peer_name])
        old_hash = owner.password_hash
        first = await db.get(Project, original['projects_by_key']['first'])
        import passport as plib
        first.passport = plib.merge_patch(first.passport, {'core.problem':'Ручная правка'}, source='manual')
        await sync_project_breakdown(db, first)
        await db.commit()
        expanded = deepcopy(original_data)
        expanded['batch_key'] = uuid.uuid4().hex
        extra_name = 'u' + uuid.uuid4().hex[:14]
        expanded['participants'].append({'username':extra_name,'source_rows':[4],'primary_project':'third'})
        for row in expanded['participants'][:2]:
            row.update(existing_user_id=original['users'][row['username']],existing_membership_id=original['memberships'][row['username']])
        expanded['projects'][0].update(existing_project_id=first.id)
        expanded['projects'][0]['fields']['core.problem']='Ручная правка'
        expanded['projects'][1].update(existing_project_id=original['projects_by_key']['second'],members=[first_name,peer_name],secondary_shared=True)
        third = deepcopy(original_data['projects'][0])
        third.update(key='third',name='Общий дополнительный',owner=extra_name,members=[first_name,extra_name],secondary_shared=True)
        third['fields']['core.name']='Общий дополнительный'
        third['source_descriptions']=[{'row':4,'text':'Общий дополнительный проект'}]
        third['field_sources']={path:[4] for path in third['fields']}
        expanded['projects'].append(third)
        manifest = ResidentImportManifest.model_validate(expanded)
        preview, empty = await import_residents(db,cohort_id=cohort.id,actor=actor,manifest=manifest)
        assert not empty and preview['new_accounts']==1 and preview['reused_projects']==2
        result, new_credentials = await import_residents(db,cohort_id=cohort.id,actor=actor,manifest=manifest,dry_run=False)
        await db.commit()
        assert len(new_credentials)==1 and owner.password_hash==old_hash
        assert first.passport['core']['problem']=='Ручная правка'
        assert result['memberships'][first_name]==original['memberships'][first_name]
        quota_count = (await db.execute(select(func.count()).select_from(AcceleratorResidentQuotaOverride).where(
            AcceleratorResidentQuotaOverride.membership_id==original['memberships'][first_name]))).scalar_one()
        assert quota_count==1
        second_id=result['projects_by_key']['second']; third_id=result['projects_by_key']['third']
        assert await get_accessible_project(db,second_id,peer)
        with pytest.raises(HTTPException): await get_accessible_project(db,third_id,peer)
        assert len((await project_options(db,original['memberships'][peer_name],peer))['projects'])==2
        await select_project(db,original['memberships'][peer_name],peer,second_id)
        assert await get_accessible_project(db,first.id,peer)
        assert await get_accessible_project(db,second_id,peer)
        membership=await db.get(AcceleratorMembership,original['memberships'][peer_name])
        membership.status='suspended'; await db.flush()
        with pytest.raises(HTTPException): await get_accessible_project(db,second_id,peer)
        membership.status='enrolled'
        team_member=(await db.execute(select(AcceleratorTeamMember).where(
            AcceleratorTeamMember.membership_id==membership.id,AcceleratorTeamMember.status=='active'))).scalar_one()
        team_member.status='left'; await db.flush()
        with pytest.raises(HTTPException): await get_accessible_project(db,second_id,peer)


@pytest.mark.asyncio
async def test_reused_passport_preflight_rejects_changed_snapshot_without_new_accounts():
    from copy import deepcopy
    data = manifest_data(False)
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        original, _ = await import_residents(db,cohort_id=cohort.id,actor=actor,manifest=ResidentImportManifest.model_validate(data),dry_run=False)
        await db.commit()
        name=data['participants'][0]['username']
        expanded=deepcopy(data); expanded['batch_key']=uuid.uuid4().hex
        expanded['participants'][0].update(existing_user_id=original['users'][name],existing_membership_id=original['memberships'][name])
        expanded['projects'][0]['existing_project_id']=original['projects_by_key']['first']
        expanded['projects'][0]['fields']['core.problem']='Другие данные после сверки'
        with pytest.raises(HTTPException) as error:
            await import_residents(db,cohort_id=cohort.id,actor=actor,manifest=ResidentImportManifest.model_validate(expanded),dry_run=False)
        assert error.value.status_code==409


@pytest.mark.asyncio
async def test_captain_transfer_moves_all_passports_shared_with_the_whole_team():
    from routers.accelerator_teams import transfer_team_captain
    from schemas.accelerator_teams import AcceleratorTeamCaptainTransfer
    from copy import deepcopy
    data=manifest_data()
    secondary=deepcopy(data['projects'][0])
    secondary.update(key='second',name='Общий второй паспорт',secondary_shared=True)
    secondary['fields']['core.name']='Общий второй паспорт'
    data['projects'].append(secondary)
    async with AsyncSessionLocal() as db:
        actor,cohort=await seed(db)
        result,_=await import_residents(db,cohort_id=cohort.id,actor=actor,manifest=ResidentImportManifest.model_validate(data),dry_run=False)
        await db.commit()
        owner_name,peer_name=[p['username'] for p in data['participants']]
        owner=await db.get(User,result['users'][owner_name]);peer=await db.get(User,result['users'][peer_name])
        await transfer_team_captain(result['team_ids'][0],AcceleratorTeamCaptainTransfer(membership_id=result['memberships'][peer_name]),owner,db)
        for project_id in result['projects_by_key'].values():
            project=await db.get(Project,project_id)
            tree=(await db.execute(select(ProjectTree).where(ProjectTree.project_id==project_id))).scalar_one()
            assert project.user_id==peer.id and tree.user_id==peer.id
        old_member=(await db.execute(select(AcceleratorTeamMember).where(AcceleratorTeamMember.membership_id==result['memberships'][owner_name]))).scalar_one()
        old_member.status='left';await db.flush()
        for project_id in result['projects_by_key'].values():
            with pytest.raises(HTTPException): await get_accessible_project(db,project_id,owner)
