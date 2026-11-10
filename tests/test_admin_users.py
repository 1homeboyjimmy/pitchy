from datetime import datetime
import uuid
import pytest
import httpx


@pytest.mark.asyncio
async def test_admin_users_lists_legacy_addresses_without_dropping_accounts():
    from fastapi import FastAPI
    from routers.admin_users import router
    from auth import get_async_current_user
    from db_async import AsyncSessionLocal, get_async_db
    from models import User

    suffix = uuid.uuid4().hex
    app = FastAPI()
    app.include_router(router)
    async with AsyncSessionLocal() as db:
        admin = User(email=f"admin-{suffix}@example.com", name="Admin", is_admin=True)
        legacy = User(email=f"legacy-{suffix}@example.test", name="Imported resident")
        malformed = User(email=f"legacy-{suffix}-without-domain", name="Legacy account",
                         is_active=False, deleted_at=datetime.utcnow(),
                         privacy_consent_at=datetime.utcnow(), cookies_consent_at=datetime.utcnow())
        db.add_all([admin, legacy, malformed])
        await db.commit()

        async def current_user():
            return admin

        async def session():
            yield db

        previous = app.dependency_overrides.copy()
        app.dependency_overrides[get_async_current_user] = current_user
        app.dependency_overrides[get_async_db] = session
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
                response = await client.get("/admin/users")
                assert response.status_code == 200
                rows = {row["id"]: row for row in response.json()}
                assert rows[admin.id]["email"] == admin.email
                assert rows[legacy.id]["email"] == legacy.email
                assert rows[malformed.id]["email"] == malformed.email
                assert rows[malformed.id]["deleted_at"]
                assert rows[malformed.id]["privacy_consent_at"]
                assert rows[malformed.id]["cookies_consent_at"]
                # Fixing response serialization must not weaken admin authorization.
                app.dependency_overrides[get_async_current_user] = lambda: legacy
                assert (await client.get("/admin/users")).status_code == 403
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)


@pytest.mark.parametrize("email", ["person@example.test", "person@localhost", "legacy-without-domain"])
def test_admin_user_output_does_not_weaken_registration_email_validation(email):
    from pydantic import ValidationError
    from schemas import RegisterRequest
    with pytest.raises(ValidationError):
        RegisterRequest(email=email, name="Resident", password="Pass1234",
                        accept_privacy=True, accept_cookies=True)


def test_admin_user_output_preserves_username_accounts_without_email():
    from schemas import AdminUserResponse
    row = AdminUserResponse.model_validate({
        "id": 3, "email": None, "username": "mtusi-resident", "name": "Resident",
        "is_admin": False, "is_active": True, "email_verified": False,
        "created_at": datetime.utcnow(),
    })
    assert row.email is None
    assert row.username == "mtusi-resident"
