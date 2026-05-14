#!/bin/sh
set -e

echo "[eigen] Ensuring database extensions..."
node scripts/ensure-extensions.mjs

echo "[eigen] Running database migrations..."
npx drizzle-kit push --force

echo "[eigen] Applying RLS policies..."
node scripts/apply-rls.mjs

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
