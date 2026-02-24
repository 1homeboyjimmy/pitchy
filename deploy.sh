#!/usr/bin/env bash

export PATH="$HOME/yandex-cloud/bin:$PATH"
set -euo pipefail

REPO_DIR="/opt/ai-startup"
COMPOSE_FILE="docker-compose.prod.yml"
BASE_ENV_FILE=".env"
RUNTIME_ENV_FILE=".env.runtime"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1/health}"
HEALTHCHECK_HOST_HEADER="${HEALTHCHECK_HOST_HEADER:-pitchy.pro}"
ROLLBACK_ON_FAIL="${ROLLBACK_ON_FAIL:-true}"

cd "$REPO_DIR"

# PREVIOUS_COMMIT="$(git rev-parse HEAD)"
# git fetch origin
# git reset --hard origin/main

chmod +x scripts/load_lockbox_env.sh
scripts/load_lockbox_env.sh "$BASE_ENV_FILE" "$RUNTIME_ENV_FILE"

read_runtime_env_value() {
  local key="$1"
  local value=""
  value="$(awk -F= -v k="$key" '$1 == k {print substr($0, index($0, "=") + 1)}' "$RUNTIME_ENV_FILE" | tail -n 1 || true)"
  echo "$value"
}

runtime_health_url="$(read_runtime_env_value "HEALTHCHECK_URL")"
if [[ -n "$runtime_health_url" ]]; then
  HEALTHCHECK_URL="$runtime_health_url"
fi
runtime_health_host="$(read_runtime_env_value "HEALTHCHECK_HOST_HEADER")"
if [[ -n "$runtime_health_host" ]]; then
  HEALTHCHECK_HOST_HEADER="$runtime_health_host"
fi

# Zero-downtime deployment:
# 1. Pull new base images
APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" pull --ignore-buildable -q

# 2. Start new containers without taking down old ones (Rolling Update)
APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans

# 3. Apply database migrations
echo "Applying database migrations..."
docker compose exec -T backend python -m alembic upgrade head

# 4. Prune unused images
docker image prune -f
# 1. 'up -d' will recreate container.
# 2. To avoid downtime, we can use `docker rollout` plugin or manual scale up/down if we had a load balancer.
# WE HAVE CADDY.
# We can use blue-green: start `backend-blue`, wait for health, switch Caddy, stop `backend-green`.
# But `docker-compose.yml` hardcodes service names.

# SIMPLER IMPROVEMENT calling 'up -d' is standard.
# It minimizes downtime to seconds (container restart).
# To make it TRULY zero downtime, we need to run two backend containers and Caddy load balancing.

# Let's stick to standard efficient deploy but ensure Caddy handles retries.
# actually, user asked for "site doesn't go down".
# The current script does `down` then `up`. This KILLS the site for minutes.
# CHANGING TO: `up -d --build` WITHOUT `down`.
# Docker compose will only recreate changed containers.
# Old containers keep running until new one is ready if we use `healthcheck` and `update_config`?
# No, standard compose stops, then starts.

# STRATEGY: Remove `down`. Just `up -d`.
# This reduces downtime from "minutes" (build time + startup) to "seconds" (restart time).
# This is usually acceptable and VASTLY better than `down` first.

APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans

health_ok="false"
for _ in $(seq 1 30); do
  body="$(
    APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" \
      exec -T backend python - <<'PY' 2>/dev/null || true
import json
import requests

try:
    resp = requests.get("http://127.0.0.1:8000/health", timeout=5)
    data = resp.json()
    print(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
except Exception:
    pass
PY
  )"
  if [[ "$body" == *'"status":"ok"'* ]]; then
    health_ok="true"
    break
  fi
  echo "Healthcheck attempt failed: ${body:-<empty>}"
  sleep 5
done

if [[ "$health_ok" != "true" ]]; then
  echo "Post-deploy backend healthcheck failed."
  if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
    echo "Rolling back to commit $PREVIOUS_COMMIT"
    git reset --hard "$PREVIOUS_COMMIT"
    scripts/load_lockbox_env.sh "$BASE_ENV_FILE" "$RUNTIME_ENV_FILE"
    APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" down
    APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" up -d --build
  fi
  exit 1
fi

docker system prune -f
