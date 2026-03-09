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

PREVIOUS_COMMIT="${PREVIOUS_COMMIT:-$(git rev-parse HEAD)}"

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

# ---- LOGIN TO GHCR ----
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

# ---- PULL PRE-BUILT IMAGES FROM GHCR ----
echo "Pulling pre-built images from GHCR..."
APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" pull

# ---- STOP OLD CONTAINERS ----
docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" down --timeout 10 --remove-orphans 2>/dev/null || true
docker rm -f $(docker ps -aq --filter "label=com.docker.compose.project=ai-startup") 2>/dev/null || true
docker container prune -f 2>/dev/null || true

# ---- START CONTAINERS (no --build, images are pre-built) ----
echo "Starting containers..."
APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans

# ---- DATABASE MIGRATIONS ----
echo "Applying database migrations..."
sleep 5  # Give postgres a moment to accept connections
docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" exec -T backend python -m alembic upgrade head

# ---- PRUNE OLD IMAGES (but NOT build cache) ----
docker image prune -f

# ---- HEALTHCHECK ----
health_ok="false"
for i in $(seq 1 60); do
  body="$(
    docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" \
      exec -T backend curl -s http://127.0.0.1:8000/health || true
  )"
  if [[ "$body" == *'"status":"ok"'* ]]; then
    health_ok="true"
    echo "Healthcheck passed on attempt $i!"
    break
  fi
  # Every 5 attempts, print backend logs for debugging
  if (( i % 5 == 0 )); then
    echo "--- Backend logs (attempt $i) ---"
    docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" logs backend --tail=20 2>&1 || true
    echo "--- End backend logs ---"
  fi
  echo "Healthcheck attempt $i failed: ${body:-<empty>}"
  sleep 5
done

if [[ "$health_ok" != "true" ]]; then
  echo "====== DEPLOY FAILED: healthcheck timeout ======"
  echo "====== BACKEND LOGS ======"
  docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" logs backend --tail=100 2>&1 || true
  echo "====== CHROMA LOGS ======"
  docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" logs chroma --tail=30 2>&1 || true
  echo "====== POSTGRES LOGS ======"
  docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" logs postgres --tail=30 2>&1 || true
  if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
    echo "Rolling back to commit $PREVIOUS_COMMIT"
    git reset --hard "$PREVIOUS_COMMIT"
    chmod +x scripts/load_lockbox_env.sh
    scripts/load_lockbox_env.sh "$BASE_ENV_FILE" "$RUNTIME_ENV_FILE"
    docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" down
    docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" up -d
  fi
  exit 1
fi

echo "Deploy successful!"
# Clean up dangling images only (not build cache)
docker image prune -f 2>/dev/null || true
