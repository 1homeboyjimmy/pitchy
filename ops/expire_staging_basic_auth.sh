#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <base64-env-line>" >&2
  exit 2
fi

cd /opt/ai-startup
sed -i '/^STAGING_HASH_VAIBLY=/d' .env
printf '%s' "$1" | base64 -d >> .env

export CADDYFILE=Caddyfile.staging
docker compose -f docker-compose.yml -f docker-compose.staging.yml \
  up -d --no-deps --force-recreate caddy
