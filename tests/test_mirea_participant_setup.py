from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch
import sys
import uuid

import pytest
from fastapi import BackgroundTasks, HTTPException, Request
from sqlalchemy import select

from accelerator_demo_scoring import criteria_for_project, raw_score
from accelerator_participant_service import ParticipantProfileUpdate, visible_profile, registration_required
from accelerator_resident_import import ResidentImportManifest, import_residents
from auth import hash_password, hash_token, verify_password
from db_async import AsyncSessionLocal
from models import User, Project, AcceleratorParticipantProfile, AcceleratorDemoDay, AcceleratorDemoDayProject, AcceleratorDemoDayExpert
from routers.accelerators import update_participant_profile, upsert_demo_day_score, update_demo_day_status, demo_day_dict
from routers.auth import set_invitation_password
from schemas.base import InvitationPasswordSet
from schemas.accelerators import DemoDayScoreUpsert, DemoDayStatusUpdate
from tests.test_accelerator_resident_import import seed, manifest_data


def test_private_projection_and_raw_score():
    profile = dict(study_group="ИВБО-20-25", education_direction="БАК", education_course="БАК-2", employment="working", tags=["student_startup"], registration_required=True)
    assert set(visible_profile(profile, private=False)) == {"tags", "registration_required"}
    assert visible_profile(profile, private=True) == profile
    assert not registration_required(profile)
    assert registration_required({"registration_required": True})
    criteria = [dict(key=f"c{i}", max_score=5, label=str(i)) for i in range(5)]
    assert raw_score(criteria, {c["key"]: 5 for c in criteria}) == 25
    for value in [-1, 6, 0.5, float("nan"), float("inf")]:
        with pytest.raises(HTTPException): raw_score(criteria, {c["key"]: value for c in criteria})
    with pytest.raises(HTTPException): raw_score(criteria, {})


@pytest.mark.asyncio
async def test_profile_permissions_and_single_expert_total():
    async with AsyncSessionLocal() as db:
        actor, cohort = await seed(db)
        config = (await db.execute(select(__import__('models').AcceleratorProgramConfig).where(__import__('models').AcceleratorProgramConfig.cohort_id == cohort.id))).scalar_one()
        config.modules = {**config.modules, "demo_day": True}
        result, _ = await import_residents(db, cohort_id=cohort.id, actor=actor, manifest=ResidentImportManifest.model_validate(manifest_data(True)), dry_run=False)
        mid = next(iter(result["memberships"].values()))
        person = await db.get(User, next(iter(result["users"].values())))
        row = (await db.execute(select(AcceleratorParticipantProfile).where(AcceleratorParticipantProfile.membership_id == mid))).scalar_one()
        row.profile = {**row.profile, "registration_required": True, "source_rows": [2]}
        await db.commit()
        await update_participant_profile(mid, ParticipantProfileUpdate(employment="working", study_group="Нет группы"), person, db)
        assert row.profile["source_rows"] == [2]
        assert row.profile["employment"] == "working"
        with pytest.raises(HTTPException):
            await update_participant_profile(mid, ParticipantProfileUpdate(tags=["student_startup"]), person, db)
        await update_participant_profile(mid, ParticipantProfileUpdate(tags=["student_startup", "startup_diploma"]), actor, db)
        outsider = User(email=f'{uuid.uuid4().hex}@example.com', name="Other", is_active=True)
        db.add(outsider); await db.flush()
        with pytest.raises(HTTPException):
            await update_participant_profile(mid, ParticipantProfileUpdate(employment="not_working"), outsider, db)
        project = await db.get(Project, next(iter(result["projects_by_key"].values())))
        project.passport = {**project.passport, "accelerator_track": "Научный трек"}
        criteria = [dict(key=f'c{i}', label=f'Критерий {i}', description='Описание', max_score=5, weight=20) for i in range(5)]
        demo = AcceleratorDemoDay(cohort_id=cohort.id, title="МИРЭА", status="scoring", criteria=[], evaluation_config={"method":"raw_sum", "criteria_by_track":{"Научный трек":criteria}}, created_by_user_id=actor.id)
        db.add(demo); await db.flush()
        dp = AcceleratorDemoDayProject(demo_day_id=demo.id, membership_id=mid, project_id=project.id, selected_by_user_id=actor.id)
        db.add(dp)
        db.add_all([AcceleratorDemoDayExpert(demo_day_id=demo.id, user_id=u.id, invited_by_user_id=actor.id) for u in [person, outsider]])
        await db.commit()
        teammate = await db.get(User, list(result["users"].values())[1])
        assert len((await demo_day_dict(db, demo, "resident", teammate.id))["projects"]) == 1
        assert (await demo_day_dict(db, demo, "resident", outsider.id))["projects"] == []
        assert criteria_for_project(demo, project) == criteria
        payload = DemoDayScoreUpsert(scores={c['key']:5 for c in criteria}, recommendation="consider")
        data = await upsert_demo_day_score(dp.id, payload, person, db)
        assert data['projects'][0]['max_score'] == 25
        assert data['projects'][0]['criteria'] == criteria
        with pytest.raises(HTTPException) as error:
            await upsert_demo_day_score(dp.id, payload, outsider, db)
        assert error.value.status_code == 409
        await upsert_demo_day_score(dp.id, DemoDayScoreUpsert(scores={c['key']:4 for c in criteria}, recommendation="consider"), person, db)
        data = await update_demo_day_status(demo.id, DemoDayStatusUpdate(status="finalized"), BackgroundTasks(), actor, db)
        assert data['projects'][0]['final_score'] == 20
        assert data['projects'][0]['rank'] == 1


@pytest.mark.asyncio
async def test_invitation_password_single_use_and_expiry():
    request = Request({"type":"http", "headers":[], "client":("127.0.0.1",1000)})
    mock = SimpleNamespace(_check_rate_limit=lambda ip:None, get_client_ip=lambda request:'127.0.0.1')
    async with AsyncSessionLocal() as db:
        token = 'a' * 43
        user = User(email=f'{uuid.uuid4().hex}@example.com', name="Test", password_hash=hash_password('OldPassword12!'), local_login_enabled=True, is_active=True, password_reset_token_hash=hash_token(token), password_reset_expires_at=datetime.utcnow()+timedelta(days=7))
        db.add(user); await db.commit()
        payload = InvitationPasswordSet(email=user.email, token=token, new_password="NewPassword12!")
        with patch.dict(sys.modules, {"main":mock}):
            assert await set_invitation_password(payload, request, db) == {"status":"ok"}
            assert verify_password(payload.new_password, user.password_hash)
            with pytest.raises(HTTPException): await set_invitation_password(payload, request, db)
            user.password_reset_token_hash = hash_token(token)
            user.password_reset_expires_at = datetime.utcnow()-timedelta(seconds=1)
            await db.commit()
            with pytest.raises(HTTPException): await set_invitation_password(payload, request, db)
