import json
import os
from pathlib import Path

import yandexcloud
from yandex.cloud.iam.v1.iam_token_service_pb2 import CreateIamTokenRequest
from yandex.cloud.iam.v1.iam_token_service_pb2_grpc import IamTokenServiceStub

from create_jwt import create_jwt_token


def _load_sa_key() -> dict:
    key_path = os.getenv("YC_SA_KEY_PATH")
    if not key_path:
        raise RuntimeError("YC_SA_KEY_PATH is not set")
    path = Path(key_path)
    if not path.exists():
        raise RuntimeError(f"Service account key file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def create_iam_token() -> str:
    jwt_token = create_jwt_token()
    sa_key = _load_sa_key()
    sdk = yandexcloud.SDK(service_account_key=sa_key)
    iam_service = sdk.client(IamTokenServiceStub)
    iam_token = iam_service.Create(CreateIamTokenRequest(jwt=jwt_token))
    return iam_token.iam_token


if __name__ == "__main__":
    print(create_iam_token())
