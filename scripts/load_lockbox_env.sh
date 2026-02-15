#!/usr/bin/env bash
set -euo pipefail

BASE_ENV_FILE="${1:-.env}"
OUT_ENV_FILE="${2:-.env.runtime}"

if [[ ! -f "$BASE_ENV_FILE" ]]; then
  echo "Base env file not found: $BASE_ENV_FILE" >&2
  exit 1
fi

cp "$BASE_ENV_FILE" "$OUT_ENV_FILE"

PYTHON_BIN="python3"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python is required (python3 or python) but was not found." >&2
  exit 1
fi

get_env_value() {
  local key="$1"
  local file="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  echo "${line#*=}"
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  "$PYTHON_BIN" - "$key" "$value" "$file" <<'PY'
import sys
from pathlib import Path

key, value, file_path = sys.argv[1], sys.argv[2], sys.argv[3]
path = Path(file_path)
lines = path.read_text(encoding="utf-8").splitlines()
prefix = f"{key}="
updated = False
for idx, line in enumerate(lines):
    if line.startswith(prefix):
        lines[idx] = f"{prefix}{value}"
        updated = True
        break
if not updated:
    lines.append(f"{prefix}{value}")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
}

fetch_lockbox_entry() {
  local secret_id="$1"
  local entry_key="$2"
  local payload_json
  if payload_json="$(yc lockbox payload get --secret-id "$secret_id" --format json 2>/dev/null)"; then
    :
  elif payload_json="$(yc lockbox payload get "$secret_id" --format json 2>/dev/null)"; then
    :
  else
    echo "Failed to read Lockbox secret payload for secret id: $secret_id" >&2
    return 1
  fi
  LOCKBOX_PAYLOAD_JSON="$payload_json" "$PYTHON_BIN" - "$entry_key" <<'PY'
import json
import os
import sys

entry_key = sys.argv[1]
payload = os.environ.get("LOCKBOX_PAYLOAD_JSON", "")
if not payload.strip():
    raise SystemExit("Lockbox payload is empty")
data = json.loads(payload)
entries = data.get("entries", [])
if not entries:
    raise SystemExit("Lockbox secret has no entries")

if entry_key:
    for item in entries:
        if item.get("key") == entry_key:
            value = item.get("textValue") or item.get("text_value")
            if value is None:
                raise SystemExit(f"Entry '{entry_key}' has no text value")
            print(value)
            raise SystemExit(0)

for item in entries:
    value = item.get("textValue") or item.get("text_value")
    if value is not None:
        print(value)
        raise SystemExit(0)

raise SystemExit("No text entries found in Lockbox secret")
PY
}

if [[ "$(get_env_value "LOCKBOX_ENABLED" "$OUT_ENV_FILE" || echo "false")" != "true" ]]; then
  echo "Lockbox disabled. Using base env as-is."
  exit 0
fi

if ! command -v yc >/dev/null 2>&1; then
  echo "yc CLI not found. Install and initialize yc before deploy." >&2
  exit 1
fi

resolve_from_lockbox() {
  local target_key="$1"
  local secret_id_key="$2"
  local entry_key_key="$3"

  local secret_id entry_key secret_value
  secret_id="$(get_env_value "$secret_id_key" "$OUT_ENV_FILE" || true)"
  entry_key="$(get_env_value "$entry_key_key" "$OUT_ENV_FILE" || true)"
  if [[ -z "$entry_key" ]]; then
    entry_key="$target_key"
  fi
  if [[ -z "$secret_id" ]]; then
    echo "Skip $target_key: $secret_id_key is not set."
    return 0
  fi
  secret_value="$(fetch_lockbox_entry "$secret_id" "$entry_key")"
  upsert_env_value "$target_key" "$secret_value" "$OUT_ENV_FILE"
  echo "Resolved $target_key from Lockbox."
}

resolve_from_lockbox "APP_SECRET_KEY" "LOCKBOX_APP_SECRET_KEY_SECRET_ID" "LOCKBOX_APP_SECRET_KEY_ENTRY_KEY"
resolve_from_lockbox "YC_API_KEY" "LOCKBOX_YC_API_KEY_SECRET_ID" "LOCKBOX_YC_API_KEY_ENTRY_KEY"
resolve_from_lockbox "POSTGRES_PASSWORD" "LOCKBOX_POSTGRES_PASSWORD_SECRET_ID" "LOCKBOX_POSTGRES_PASSWORD_ENTRY_KEY"

postgres_user="$(get_env_value "POSTGRES_USER" "$OUT_ENV_FILE" || true)"
postgres_password="$(get_env_value "POSTGRES_PASSWORD" "$OUT_ENV_FILE" || true)"
postgres_db="$(get_env_value "POSTGRES_DB" "$OUT_ENV_FILE" || true)"
if [[ -n "$postgres_user" && -n "$postgres_password" && -n "$postgres_db" ]]; then
  upsert_env_value \
    "DATABASE_URL" \
    "postgresql+psycopg2://${postgres_user}:${postgres_password}@postgres:5432/${postgres_db}" \
    "$OUT_ENV_FILE"
  echo "Updated DATABASE_URL from POSTGRES_* values."
fi
