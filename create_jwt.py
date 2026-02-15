import json
import os
import time
from pathlib import Path

import jwt


def _load_sa_key() -> dict:
    key_path = os.getenv("YC_SA_KEY_PATH")
    if not key_path:
        raise RuntimeError("YC_SA_KEY_PATH is not set")
    path = Path(key_path)
    if not path.exists():
        raise RuntimeError(f"Service account key file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def create_jwt_token() -> str:
    sa_key = _load_sa_key()
    now = int(time.time())
    payload = {
        "aud": "https://iam.api.cloud.yandex.net/iam/v1/tokens",
        "iss": sa_key["service_account_id"],
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(
        payload,
        sa_key["private_key"],
        algorithm="PS256",
        headers={"kid": sa_key["id"]},
    )


if __name__ == "__main__":
    print(create_jwt_token())
