#!/usr/bin/env bash
set -euo pipefail

# Verify backup restore in isolated environment.
#
# Expected backup files:
#   ${BACKUP_ROOT}/postgres.sql.gz   (or postgres.sql)
#   ${BACKUP_ROOT}/chroma.tar.gz     (optional integrity check)
#
# Usage:
#   bash ops/backup/verify_restore.sh
#
# Optional env:
#   BACKUP_ROOT=/opt/backups/pitchy/latest
#   BACKEND_IMAGE=ai-startup-backend:latest
#   HOST_CHECK_PORT=18080

BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/pitchy/latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ai-startup-backend:latest}"
HOST_CHECK_PORT="${HOST_CHECK_PORT:-18080}"

POSTGRES_SQL_GZ="${BACKUP_ROOT}/postgres.sql.gz"
POSTGRES_SQL="${BACKUP_ROOT}/postgres.sql"
CHROMA_ARCHIVE="${BACKUP_ROOT}/chroma.tar.gz"

if [[ ! -f "$POSTGRES_SQL_GZ" && ! -f "$POSTGRES_SQL" ]]; then
  echo "Postgres dump not found in ${BACKUP_ROOT}" >&2
  exit 1
fi

if [[ -f "$CHROMA_ARCHIVE" ]]; then
  tar -tzf "$CHROMA_ARCHIVE" >/dev/null
  echo "Chroma archive integrity check passed."
fi

TS="$(date +%Y%m%d%H%M%S)"
NETWORK="pitchy-restore-${TS}"
PG_CONTAINER="pitchy-restore-pg-${TS}"
BACKEND_CONTAINER="pitchy-restore-backend-${TS}"
DB_NAME="restore_db"
DB_USER="postgres"
DB_PASS="restore_password"

cleanup() {
  docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null

docker run -d --name "$PG_CONTAINER" \
  --network "$NETWORK" \
  -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASS" \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! docker exec "$PG_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  echo "Postgres restore-check container did not become ready." >&2
  exit 1
fi

if [[ -f "$POSTGRES_SQL_GZ" ]]; then
  gunzip -c "$POSTGRES_SQL_GZ" | docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" >/dev/null
else
  cat "$POSTGRES_SQL" | docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" >/dev/null
fi

docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT COUNT(*) AS users_count FROM users;" >/dev/null

docker run -d --name "$BACKEND_CONTAINER" \
  --network "$NETWORK" \
  -p "${HOST_CHECK_PORT}:8000" \
  -e APP_ENV=prod \
  -e APP_SECRET_KEY=restore_check_secret_key \
  -e DATABASE_URL="postgresql+psycopg2://${DB_USER}:${DB_PASS}@${PG_CONTAINER}:5432/${DB_NAME}" \
  -e CHROMA_REINDEX=false \
  "$BACKEND_IMAGE" >/dev/null

health_ok="false"
for _ in $(seq 1 30); do
  body="$(curl -fsS "http://127.0.0.1:${HOST_CHECK_PORT}/health" 2>/dev/null || true)"
  if [[ "$body" == *'"db":true'* ]]; then
    health_ok="true"
    break
  fi
  sleep 2
done

if [[ "$health_ok" != "true" ]]; then
  echo "Restore verification failed: backend did not become healthy." >&2
  docker logs --tail 120 "$BACKEND_CONTAINER" || true
  exit 1
fi

echo "Restore verification successful."
