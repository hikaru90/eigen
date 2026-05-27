#!/bin/sh
set -e

echo "[eigen] Ensuring database extensions..."
node scripts/ensure-extensions.mjs

echo "[eigen] Ensuring non-superuser app role (eigen_app)..."
node scripts/ensure-app-role.mjs

echo "[eigen] Running database migrations..."
node scripts/migrate.mjs

echo "[eigen] Applying RLS policies..."
node scripts/apply-rls.mjs

if [ -n "${ADMIN_CONSOLIDATION_KEY:-}" ] && [ -n "${DATABASE_ADMIN_URL:-}" ]; then
  echo "[eigen] Ensuring pg_cron sleep consolidation schedule..."
  node scripts/ensure-sleep-cron.mjs || echo "[eigen] WARN: sleep cron setup failed (pg_cron may be unavailable)"
else
  echo "[eigen] ADMIN_CONSOLIDATION_KEY or DATABASE_ADMIN_URL unset — skipping pg_cron sleep schedule."
fi

# Create admin user on first boot if credentials are provided.
# create-admin.mjs is idempotent — skips silently if the user already exists.
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "[eigen] Creating admin user (${ADMIN_EMAIL})..."
  node scripts/create-admin.mjs
else
  echo "[eigen] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin creation."
fi

echo "[eigen] Starting application..."
exec node build/index.js
