#!/bin/sh
# Development entrypoint for the API and worker containers.
#
# Brings the schema and generated client in line with whatever is currently
# bind-mounted, then hands over to the command from docker-compose.
set -e

cd /app/api

echo "[entrypoint] regenerating Prisma client"
pnpm exec prisma generate

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  pnpm exec prisma migrate deploy
fi

# The seed is idempotent (upserts by natural key), so re-running it on every
# start keeps the demo workspace available without ever duplicating data.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding development data"
  pnpm exec tsx prisma/seed.ts
fi

echo "[entrypoint] starting: $*"
exec "$@"
