import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Tuple

import jwt
import requests


DEFAULT_ENDPOINT = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
IAM_ENDPOINT = "https://iam.api.cloud.yandex.net/iam/v1/tokens"
DEFAULT_MODEL_URI_TEMPLATE = "gpt://{folder_id}/yandexgpt/latest"


class YandexGPTError(Exception):
    def __init__(self, code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


_CACHED_IAM_TOKEN: str | None = None
_CACHED_IAM_EXP: float | None = None


def _get_api_key() -> str | None:
    api_key = os.getenv("YC_API_KEY")
    if api_key:
        return api_key.strip()
    return None


def _load_sa_key() -> Dict[str, str]:
    key_path = os.getenv("YC_SA_KEY_PATH")
    if not key_path:
        raise YandexGPTError(
            "config_error",
            "YC_SA_KEY_PATH is missing in environment",
        )
    path = Path(key_path)
    if not path.exists():
        raise YandexGPTError("config_error", "Service account key file not found")
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "private_key": data["private_key"],
        "key_id": data["id"],
        "service_account_id": data["service_account_id"],
    }


def _create_jwt(sa_key: Dict[str, str]) -> str:
    now = int(time.time())
    payload = {
        "aud": IAM_ENDPOINT,
        "iss": sa_key["service_account_id"],
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(
        payload,
        sa_key["private_key"],
        algorithm="PS256",
        headers={"kid": sa_key["key_id"]},
    )


def _parse_expires_at(value: str | None) -> float:
    if not value:
        return time.time() + 3600
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.timestamp()
    except ValueError:
        return time.time() + 3600


def _get_iam_token() -> str:
    global _CACHED_IAM_TOKEN, _CACHED_IAM_EXP
    static_token = os.getenv("YC_IAM_TOKEN")
    if static_token:
        return static_token

    if _CACHED_IAM_TOKEN and _CACHED_IAM_EXP:
        if _CACHED_IAM_EXP - time.time() > 60:
            return _CACHED_IAM_TOKEN

    sa_key = _load_sa_key()
    jwt_token = _create_jwt(sa_key)
    try:
        response = requests.post(
            IAM_ENDPOINT,
            json={"jwt": jwt_token},
            timeout=10,
        )
    except requests.RequestException as exc:
        raise YandexGPTError("unavailable", "IAM API is unreachable") from exc

    if response.status_code == 401:
        raise YandexGPTError("invalid_token", "Invalid service account key", 401)
    if not response.ok:
        raise YandexGPTError(
            "bad_request",
            f"IAM error: {response.text}",
            response.status_code,
        )

    payload = response.json()
    token = payload.get("iamToken")
    expires_at = _parse_expires_at(payload.get("expiresAt"))
    if not token:
        raise YandexGPTError("bad_response", "IAM response missing token")

    _CACHED_IAM_TOKEN = token
    _CACHED_IAM_EXP = expires_at
    return token


def _build_headers() -> Dict[str, str]:
    folder_id = os.getenv("YC_FOLDER_ID")
    api_key = _get_api_key()
    if not folder_id:
        raise YandexGPTError(
            "config_error",
            "YC_FOLDER_ID is missing in environment",
        )
    if api_key:
        return {
            "Authorization": f"Api-Key {api_key}",
            "x-folder-id": folder_id,
            "Content-Type": "application/json",
        }

    token = _get_iam_token()
    if not token:
        raise YandexGPTError(
            "config_error",
            "YC_API_KEY or YC_IAM_TOKEN/YC_SA_KEY_PATH is missing in environment",
        )
    return {
        "Authorization": f"Bearer {token}",
        "x-folder-id": folder_id,
        "Content-Type": "application/json",
    }


def _build_payload(system_prompt: str, user_prompt: str, folder_id: str) -> Dict[str, Any]:
    model_uri = os.getenv(
        "YC_GPT_MODEL_URI",
        DEFAULT_MODEL_URI_TEMPLATE.format(folder_id=folder_id),
    )
    return {
        "modelUri": model_uri,
        "completionOptions": {
            "stream": False,
            "temperature": 0.2,
            "maxTokens": 800,
        },
        "messages": [
            {"role": "system", "text": system_prompt},
            {"role": "user", "text": user_prompt},
        ],
    }


def call_yandex_gpt(system_prompt: str, user_prompt: str, timeout: int = 20) -> Tuple[str, Dict[str, str]]:
    endpoint = os.getenv("YC_GPT_ENDPOINT", DEFAULT_ENDPOINT)
    headers = _build_headers()
    folder_id = os.getenv("YC_FOLDER_ID")
    if not folder_id:
        raise YandexGPTError(
            "config_error",
            "YC_IAM_TOKEN or YC_FOLDER_ID is missing in environment",
        )
    payload = _build_payload(system_prompt, user_prompt, folder_id)

    try:
        response = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=timeout,
        )
    except requests.Timeout as exc:
        raise YandexGPTError("timeout", "YandexGPT request timed out") from exc
    except requests.RequestException as exc:
        raise YandexGPTError("unavailable", "YandexGPT API is unreachable") from exc

    if response.status_code == 401:
        raise YandexGPTError("invalid_token", "Invalid API key or IAM token", 401)
    if response.status_code == 429:
        raise YandexGPTError("rate_limit", "Rate limit exceeded", 429)
    if response.status_code >= 500:
        raise YandexGPTError("server_error", "YandexGPT server error", response.status_code)
    if not response.ok:
        raise YandexGPTError(
            "bad_request",
            f"YandexGPT error: {response.text}",
            response.status_code,
        )

    data = response.json()
    try:
        text = data["result"]["alternatives"][0]["message"]["text"]
        usage = data["result"].get("usage", {})
        return text, usage
    except (KeyError, IndexError, TypeError) as exc:
        raise YandexGPTError("bad_response", "Unexpected response format") from exc


def extract_json(text: str) -> Dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in response")
    snippet = text[start : end + 1]
    return json.loads(snippet)
