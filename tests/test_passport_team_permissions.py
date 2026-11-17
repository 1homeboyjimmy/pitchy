"""Passport permissions and roster must follow the live accelerator team."""
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from db_async import AsyncSessionLocal
from models import AcceleratorMembership, AcceleratorTeamMember, Project, ProjectTree
from projects_router import get_passport, get_project, patch_passport
from project_breakdown import save_breakdown_fields, build_breakdown
from schemas.base import PassportPatchRequest
from tests.test_accelerator_resident_import import seed, manifest_data
from accelerator_resident_import import ResidentImportManifest, import_residents
from models import User


async def team_fixture(db):
    manifest = ResidentImportManifest.model_validate(manifest_data())
    actor, cohort = await seed(db)
    result, _ = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=manifest, dry_run=False)
    await db.commit()
    owner = await db.get(User, result['users'][manifest.projects[0].owner])
    member = await db.get(User, result['users'][manifest.participants[1].username])
    project = await db.get(Project, result['projects_by_key']['first'])
    return owner, member, project, result


@pytest.mark.asyncio
async def test_live_roster_names_roles_titles_leavers_and_print_view():
    async with AsyncSessionLocal() as db:
        owner, member, project, result = await team_fixture(db)
        owner.name = 'Анна'; member.name = 'Борис'
        row = (await db.execute(select(AcceleratorTeamMember).where(
            AcceleratorTeamMember.membership_id == result['memberships'][member.username]))).scalar_one()
        row.title = 'Разработчик'; await db.flush()
        view = await get_passport(project.id, owner, db)
        assert view.team_managed and view.can_edit
        assert view.passport['team'] == ['Анна — Руководитель команды', 'Борис — Участник команды · Разработчик']
        assert (await get_project(project.id, member, db)).passport['team'] == view.passport['team']
        row.status = 'left'; await db.flush()
        assert (await get_passport(project.id, owner, db)).passport['team'] == ['Анна — Руководитель команды']
        row.status = 'active'; await db.flush()
        membership = await db.get(AcceleratorMembership, row.membership_id)
        membership.status = 'suspended'; await db.flush()
        assert len((await get_passport(project.id, owner, db)).passport['team']) == 1
        membership.status = 'enrolled'; member.name = 'Новое имя'; await db.flush()
        assert 'Новое имя' in (await get_passport(project.id, owner, db)).passport['team'][1]
        saved = await patch_passport(project.id, PassportPatchRequest(fields={'core.problem':'Обновлено'}), owner, db)
        assert saved.passport['team'][1].startswith('Новое имя')


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['team', 'team.0', 'team.members'])
async def test_owner_cannot_manually_replace_automatic_roster(path):
    async with AsyncSessionLocal() as db:
        owner, _, project, _ = await team_fixture(db)
        with pytest.raises(HTTPException) as error:
            await patch_passport(project.id, PassportPatchRequest(fields={path: ['Подмена']}), owner, db)
        assert error.value.status_code == 422
        assert 'Подмена' not in str((await get_passport(project.id, owner, db)).passport['team'])


@pytest.mark.asyncio
async def test_solo_project_remains_editable_only_by_its_owner():
    async with AsyncSessionLocal() as db:
        owner, other, _, _ = await team_fixture(db)
        project = Project(user_id=owner.id, name='Личная идея', passport={})
        db.add(project); await db.commit()
        view = await get_passport(project.id, owner, db)
        assert view.can_edit and not view.team_managed
        assert (await patch_passport(project.id, PassportPatchRequest(fields={'core.problem':'Идея'}), owner, db)).passport['core']['problem'] == 'Идея'
        with pytest.raises(HTTPException) as error:
            await patch_passport(project.id, PassportPatchRequest(fields={'core.problem':'Чужое'}), other, db)
        assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_shared_breakdown_cannot_bypass_owner_or_roster_policy():
    async with AsyncSessionLocal() as db:
        owner, member, project, _ = await team_fixture(db)
        tree = (await db.execute(select(ProjectTree).where(ProjectTree.project_id == project.id))).scalar_one()
        with pytest.raises(HTTPException) as denied:
            await save_breakdown_fields(db, tree, 'problem', {'core.problem':'Подмена'}, user=member)
        assert denied.value.status_code == 403
        for node, field in [('team','team'), ('legal','legal.entity_type'), ('metrics','metrics.mrr')]:
            with pytest.raises(HTTPException) as denied:
                await save_breakdown_fields(db, tree, node, {field:'Подмена'}, user=owner)
            assert denied.value.status_code == 422
        await save_breakdown_fields(db, tree, 'problem', {'core.problem':'Сохранено'}, user=owner)
        assert project.passport['core']['problem'] == 'Сохранено'
        schemas = [f['id'] for n in build_breakdown(project.passport)['nodes'] for f in n['data']['form_schema']]
        assert not set(schemas) & {'team', 'metrics.mrr', 'legal.entity_type'}


@pytest.mark.asyncio
@pytest.mark.parametrize('editor_role', ['owner', 'member'])
async def test_chat_cannot_change_passport_for_nonowner_or_replace_roster(editor_role):
    import sys
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, patch
    from project_memory_service import extract_and_store_facts
    async with AsyncSessionLocal() as db:
        owner, member, project, _ = await team_fixture(db)
        editor = owner if editor_role == 'owner' else member
        extractor = SimpleNamespace(extract_project_facts=AsyncMock(return_value={
            'facts': [], 'passport': {'core.geo': 'Тестовый рынок', 'team': ['Подмена']},
        }))
        with patch.dict(sys.modules, {'slm_dispatcher': SimpleNamespace(slm_dispatcher=extractor)}):
            await extract_and_store_facts(project.id, 'Описание проекта', 'Ответ помощника', user_id=editor.id)
        await db.refresh(project)
        assert (project.passport.get('core') or {}).get('geo') == ('Тестовый рынок' if editor_role == 'owner' else None)
        assert 'Подмена' not in str((await get_passport(project.id, owner, db)).passport['team'])


@pytest.mark.asyncio
async def test_resident_project_card_reports_owner_editing_rights():
    from routers.accelerators import list_my_accelerator_memberships
    async with AsyncSessionLocal() as db:
        owner, member, project, _ = await team_fixture(db)
        for viewer, expected in [(owner, True), (member, False)]:
            response = await list_my_accelerator_memberships(viewer, db)
            card = next(row['project'] for row in response['memberships'] if row['project']['id'] == project.id)
            assert card['can_edit_passport'] is expected
