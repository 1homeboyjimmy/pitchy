import importlib

from fastapi.testclient import TestClient


def test_register_and_login():
    import main

    importlib.reload(main)
    payload = {
        "email": "test@example.com",
        "name": "Test",
        "password": "Pass1234",
    }

    with TestClient(main.app) as client:
        res = client.post("/auth/register", json=payload)
        assert res.status_code == 200

        login = client.post(
            "/auth/login",
            json={"email": payload["email"], "password": payload["password"]},
        )
        assert login.status_code == 403 or login.status_code == 200
