import importlib
from unittest import mock
import uuid
import sys
from fastapi.testclient import TestClient

# Mock rag module to avoid chromadb import issues on Python 3.14
sys.modules["rag"] = mock.MagicMock()


def test_register_and_login():
    import main

    importlib.reload(main)
    # Use unique email to avoid collision
    unique_email = f"test_{uuid.uuid4()}@example.com"
    payload = {
        "email": unique_email,
        "name": "Test",
        "password": "Pass1234",
    }

    with TestClient(main.app) as client:
        # Mock random.randint to returning 5 so code is '555555'
        with mock.patch('main.random.randint', return_value=5):
            res = client.post("/auth/register", json=payload)
            # If email exists from previous failed run, strict check might fail.
            # But with uuid it should be fine.
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "verification_required"

            # Verify
            verify_res = client.post("/auth/verify-email", json={
                "email": unique_email,
                "code": "555555"
            })
            assert verify_res.status_code == 200
            assert verify_res.status_code == 200
            assert "access_token" in verify_res.json()
            # token = verify_res.json()["access_token"]

            # Login check
            login = client.post(
                 "/auth/login",
                 json={"email": payload["email"], "password": payload["password"]},
            )
            assert login.status_code == 200
            assert "access_token" in login.json()
            token = login.json()["access_token"]

            # Verify /me endpoint (POST) for frontend compatibility
            me_res = client.post(
                "/me",
                headers={"Authorization": f"Bearer {token}"}
            )
            assert me_res.status_code == 200
            me_data = me_res.json()
            assert me_data["email"] == unique_email
            assert me_data["is_social"] is False
