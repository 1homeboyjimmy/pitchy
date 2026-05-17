#!/usr/bin/env bash

export PATH="$HOME/yandex-cloud/bin:$PATH"
set -euo pipefail

REPO_DIR="/opt/ai-startup"
# Compose file selection is now driven by env vars docker-compose reads natively:
#   COMPOSE_FILE — colon-separated list of compose files (prod = just the base)
#   COMPOSE_PROFILES — comma-separated profile names (security = crowdsec + bouncer)
# Staging deploy (deploy-dev.yml) overrides COMPOSE_FILE to layer
# docker-compose.staging.yml on top, and leaves COMPOSE_PROFILES unset
# so crowdsec is skipped on the dev box.
export COMPOSE_FILE="docker-compose.yml"
export COMPOSE_PROFILES="security"
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
if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_ACTOR:-}" ]]; then
  echo "Logging into GHCR..."
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
else
  echo "GITHUB_TOKEN or GITHUB_ACTOR not set. Skipping docker login..."
fi

# ---- PULL IMAGES ----
echo "Updating images from registry (quiet mode)..."
APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" pull -q || echo "WARNING: Some images failed to pull, using local cache."

# ---- CREATE PRE-DEPLOYMENT BACKUP ----
if [[ -f "ops/backup/backup.sh" ]]; then
  echo "Creating pre-deployment database backup..."
  bash ops/backup/backup.sh || echo "WARNING: Pre-deployment backup failed, continuing anyway..."
fi

# ---- STOP OLD CONTAINERS ----
echo "Stopping old containers..."
docker compose --env-file "$RUNTIME_ENV_FILE" down --timeout 10 --remove-orphans || true
docker rm -f $(docker ps -aq --filter "label=com.docker.compose.project=ai-startup") 2>/dev/null || true
docker container prune -f 2>/dev/null || true

# ---- START CONTAINERS (no --build, images are pre-built) ----
echo "Starting containers..."
DEPLOY_START_EPOCH=$(date +%s)
APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" up -d --force-recreate --remove-orphans

# Verify that `up -d --force-recreate` actually recreated containers.
# Previously, force-recreate silently no-op'd in some scenarios — leaving
# containers with stale config (old volume mounts, old env) running
# under the new compose definition. The grafana provisioning + bouncer
# config mounts from the compose refactor went unapplied for hours
# because of this; the only symptom was "Up 25 hours" instead of fresh
# uptime in `docker ps`. Now we explicitly assert recency.
#
# Skip the check for crowdsec-bouncer-firewall — it's created later by
# the bouncer-setup block below (after API key registration).
sleep 5
STALE_FOUND=0
for cn in $(docker ps --format '{{.Names}}' --filter "label=com.docker.compose.project=ai-startup"); do
  [[ "$cn" == "crowdsec-firewall-bouncer" ]] && continue
  created=$(docker inspect "$cn" --format '{{.Created}}' 2>/dev/null || echo "")
  if [[ -z "$created" ]]; then continue; fi
  # Created is RFC3339; convert to epoch
  created_epoch=$(date -d "$created" +%s 2>/dev/null || echo 0)
  age=$(( DEPLOY_START_EPOCH - created_epoch ))
  if (( age > 60 )); then
    echo "ERROR: $cn was not recreated (created $age s before deploy start) — force-recreate skipped it"
    STALE_FOUND=1
  fi
done
if (( STALE_FOUND > 0 )); then
  echo "ERROR: at least one container is running stale. Aborting before further steps could mask this."
  exit 1
fi
echo "All containers freshly recreated."

# ---- CROWDSEC BOUNCER SETUP ----
# Match the line with a non-empty value (=. anchors at least one char after =).
# `grep -q "CROWDSEC_BOUNCER_KEY"` used to match an EMPTY value too, which
# skipped key generation and left bouncer crash-looping with no API key.
echo "Setting up CrowdSec Bouncer..."
sleep 5 # Wait for crowdsec to initialize
if ! grep -qE "^CROWDSEC_BOUNCER_KEY=.+$" "$RUNTIME_ENV_FILE"; then
  echo "Generating new CrowdSec Bouncer API key..."
  # Generate a random API key
  BOUNCER_KEY=$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
  # Register the bouncer with crowdsec using the generated key
  # First, remove if exists to avoid "already exists" error
  docker compose --env-file "$RUNTIME_ENV_FILE" exec -T crowdsec cscli bouncers delete firewall-bouncer || true
  if docker compose --env-file "$RUNTIME_ENV_FILE" exec -T crowdsec cscli bouncers add firewall-bouncer -k "$BOUNCER_KEY"; then
    # Remove any pre-existing (empty or stale) line before appending the
    # fresh key, otherwise the file ends up with two CROWDSEC_BOUNCER_KEY
    # entries and the wrong one may win at compose-substitution time.
    sed -i '/^CROWDSEC_BOUNCER_KEY=/d' "$RUNTIME_ENV_FILE"
    echo "CROWDSEC_BOUNCER_KEY=$BOUNCER_KEY" >> "$RUNTIME_ENV_FILE"
    # Restart the bouncer so it picks up the new env var
    APP_ENV_FILE="$RUNTIME_ENV_FILE" docker compose --env-file "$RUNTIME_ENV_FILE" up -d crowdsec-bouncer-firewall
    echo "CrowdSec Bouncer registered successfully."
  else
    echo "ERROR: Failed to register CrowdSec Bouncer. Deployment aborted to prevent insecure state."
    exit 1
  fi
fi

# ---- DATABASE MIGRATIONS ----
echo "Applying database migrations..."
# Wait for postgres to be healthy
for i in {1..10}; do
  if docker compose --env-file "$RUNTIME_ENV_FILE" exec -T postgres pg_isready -U "$(read_runtime_env_value "POSTGRES_USER")" -d "$(read_runtime_env_value "POSTGRES_DB")"; then
    echo "Postgres is ready for migrations."
    break
  fi
  echo "Waiting for postgres... ($i/10)"
  sleep 2
done
# Migrations must succeed AND land at HEAD — silently continuing on
# failure (the old behaviour) let two migrations sit unapplied for days
# before being caught by 500s on the dependent endpoints. Fail loud so
# the operator can investigate. We do NOT auto-rollback here: a partial
# migration plus a code rollback leaves the schema ahead of the code,
# which is worse than leaving things stopped and investigating.
if ! timeout 60 docker compose --env-file "$RUNTIME_ENV_FILE" exec -T backend python -m alembic upgrade head; then
  echo "ERROR: alembic upgrade head exited non-zero. Aborting deploy."
  exit 1
fi

# Even on a clean exit, verify current revision matches HEAD — alembic
# can report success for partial runs in rare cases (e.g. multi-head merge
# resolved to one branch only).
CURRENT_REV=$(docker compose --env-file "$RUNTIME_ENV_FILE" exec -T backend python -m alembic current 2>/dev/null | grep -oE '[a-f0-9]{12}' | head -n 1 || true)
HEAD_REV=$(docker compose --env-file "$RUNTIME_ENV_FILE" exec -T backend python -m alembic heads 2>/dev/null | grep -oE '[a-f0-9]{12}' | head -n 1 || true)
if [[ -z "$CURRENT_REV" || -z "$HEAD_REV" || "$CURRENT_REV" != "$HEAD_REV" ]]; then
  echo "ERROR: alembic revision mismatch — current=${CURRENT_REV:-<empty>}, head=${HEAD_REV:-<empty>}"
  echo "       Investigate before retrying; do NOT auto-rollback (DB may be ahead of code)."
  exit 1
fi
echo "Migrations OK — alembic at $CURRENT_REV (matches head)"

# ---- PRUNE OLD IMAGES ----
docker image prune -af

# ---- HEALTHCHECK ----
health_ok="false"
for i in $(seq 1 60); do
  body="$(
    docker compose --env-file "$RUNTIME_ENV_FILE" \
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
    docker compose --env-file "$RUNTIME_ENV_FILE" logs backend --tail=20 2>&1 || true
    echo "--- End backend logs ---"
  fi
  echo "Healthcheck attempt $i failed: ${body:-<empty>}"
  sleep 5
done

if [[ "$health_ok" != "true" ]]; then
  echo "====== DEPLOY FAILED: healthcheck timeout ======"
  echo "====== BACKEND LOGS ======"
  docker compose --env-file "$RUNTIME_ENV_FILE" logs backend --tail=100 2>&1 || true
  echo "====== CHROMA LOGS ======"
  docker compose --env-file "$RUNTIME_ENV_FILE" logs chroma --tail=30 2>&1 || true
  echo "====== POSTGRES LOGS ======"
  docker compose --env-file "$RUNTIME_ENV_FILE" logs postgres --tail=30 2>&1 || true
  if [[ "$ROLLBACK_ON_FAIL" == "true" ]]; then
    echo "Rolling back to commit $PREVIOUS_COMMIT"
    git reset --hard "$PREVIOUS_COMMIT"
    chmod +x scripts/load_lockbox_env.sh
    scripts/load_lockbox_env.sh "$BASE_ENV_FILE" "$RUNTIME_ENV_FILE"
    docker compose --env-file "$RUNTIME_ENV_FILE" down
    docker compose --env-file "$RUNTIME_ENV_FILE" up -d
  fi
  exit 1
fi

echo "Deploy successful!"
# Final cleanup of all unused images and containers
docker image prune -af 2>/dev/null || true
docker container prune -f 2>/dev/null || true
