"""Hidden preparation cohorts remain available only to global admins."""
import uuid
import pytest
from fastapi import HTTPException
from db_async import AsyncSessionLocal
from models import User, Accelerator, AcceleratorCohort, AcceleratorStaff
from accelerator_service import require_cohort_reader, require_cohort_manager
from routers.accelerators import list_cohorts

@pytest.mark.asyncio
async def test_hidden_cohorts_are_filtered_and_cannot_be_opened_by_organizers():
    async with AsyncSessionLocal() as db:
        key = uuid.uuid4().hex
        admin = User(email=key+'admin@example.com', name='Admin', is_admin=True, is_active=True)
        organizer = User(email=key+'organizer@example.com', name='Organizer', is_active=True)
        db.add_all([admin, organizer]); await db.flush()
        accelerator = Accelerator(name='Visibility test', created_by_user_id=admin.id)
        db.add(accelerator); await db.flush()
        visible = AcceleratorCohort(accelerator_id=accelerator.id, name='Visible', created_by_user_id=admin.id)
        hidden = AcceleratorCohort(accelerator_id=accelerator.id, name='Hidden', admin_only=True, created_by_user_id=admin.id)
        db.add_all([visible, hidden, AcceleratorStaff(accelerator_id=accelerator.id, user_id=organizer.id, role='organizer', created_by_user_id=admin.id)])
        await db.commit()
        assert {r['id'] for r in await list_cohorts(accelerator.id, organizer, db)} == {visible.id}
        assert {r['id'] for r in await list_cohorts(accelerator.id, admin, db)} == {visible.id, hidden.id}
        assert await require_cohort_reader(db, organizer, visible) == 'organizer'
        await require_cohort_manager(db, organizer, visible)
        for check in (require_cohort_reader, require_cohort_manager):
            with pytest.raises(HTTPException) as error:
                await check(db, organizer, hidden)
            assert error.value.status_code == 404
            await check(db, admin, hidden)
        hidden.admin_only = False; await db.commit()
        assert {r['id'] for r in await list_cohorts(accelerator.id, organizer, db)} == {visible.id, hidden.id}
