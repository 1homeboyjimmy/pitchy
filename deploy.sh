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
PREVIOUS_COMMIT="${PREVIOUS_COMMIT:-$(git rev-parse HEAD)}"
# git fetch origin
# git reset --hard origin/main

chmod +x scripts/load_lockbox_env.sh
scripts/load_lockbox_env.sh "$BASE_ENV_FILE" "$RUNTIME_ENV_FILE"

# Make sure server has at least 2GB of Swap space (Prevents Torch OutOfMemoryError during ML model loads!)
# NOTE: This requires root/sudo access. Skipped gracefully if not available.
if ! swapon --show 2>/dev/null | grep -q "/swapfile"; then
  echo "No swap detected. Attempting to set up 2GB swapspace..."
  (
    set +e
    sudo fallocate -l 2G /swapfile 2>/dev/null && \
    sudo chmod 600 /swapfile 2>/dev/null && \
    sudo mkswap /swapfile 2>/dev/null && \
    sudo swapon /swapfile 2>/dev/null && \
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null 2>&1 && \
    echo "Swapspace configured successfully!" || \
    echo "WARNING: Could not set up swap (no sudo access). Continuing without swap."
  )
fi

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

# 2. Stop and remove ALL old containers (force-clean to prevent name conflicts)
docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" down --timeout 10 --remove-orphans 2>/dev/null || true
# Force-remove any stuck containers that 'down' couldn't clean
docker rm -f $(docker ps -aq --filter "label=com.docker.compose.project=ai-startup") 2>/dev/null || true
docker container prune -f 2>/dev/null || true

# 3. Build and start containers
APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" up -d --build --force-recreate --remove-orphans

# 4. Apply database migrations
echo "Applying database migrations..."
docker compose exec -T backend python -m alembic upgrade head

# 5. Prune unused images
docker image prune -f

health_ok="false"
for _ in $(seq 1 60); do
  body="$(
    APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" \
      exec -T backend curl -s http://127.0.0.1:8000/health || true
  )"
  if [[ "$body" == *'"status":"ok"'* ]]; then
    health_ok="true"
    break
  fi
  echo "Healthcheck attempt failed: ${body:-<empty>}"
  sleep 5
done

if [[ "$health_ok" != "true" ]]; then
  echo "Post-deploy backend healthcheck failed. ChromaDB Logs:"
  APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" logs chroma
  echo "Backend Logs:"
  APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" logs backend
  if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
    echo "Rolling back to commit $PREVIOUS_COMMIT"
    git reset --hard "$PREVIOUS_COMMIT"
    chmod +x scripts/load_lockbox_env.sh
    scripts/load_lockbox_env.sh "$BASE_ENV_FILE" "$RUNTIME_ENV_FILE"
    APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" down
    APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" up -d --build
  fi
  exit 1
fi

docker system prune -f
