#!/bin/sh
set -e

echo "[eigen] Ensuring database extensions..."
node scripts/ensure-extensions.mjs

echo "[eigen] Ensuring non-superuser app role (eigen_app)..."
node scripts/ensure-app-role.mjs

echo "[eigen] Verifying eigen_app can write Apache AGE graph..."
node scripts/verify-age-graph-role.mjs

echo "[eigen] Running database migrations..."
node scripts/migrate.mjs

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

# Fail fast when platform EUrouter is partially configured with Docker build placeholders.
if [ -n "${SERVICE_API_KEY_EUROUTER:-}" ]; then
  case "${LLM_BASE_URL:-}" in
    '' )
      echo "[eigen] ERROR: SERVICE_API_KEY_EUROUTER is set but LLM_BASE_URL is empty. Set LLM_BASE_URL (e.g. https://api.eurouter.ai/v1) and routing rule UUIDs."
      exit 1
      ;;
    *example.com* )
      echo "[eigen] ERROR: LLM_BASE_URL still points at example.com (Docker build placeholder). Set real EUrouter values in the runtime environment."
      exit 1
      ;;
  esac
  case "${LLM_RULE_CHAT:-}" in
    00000000-0000-0000-0000-000000000001|00000000-0000-0000-0000-000000000002)
      echo "[eigen] ERROR: LLM_RULE_CHAT is a Docker placeholder UUID. Set your EUrouter routing rule IDs at runtime."
      exit 1
      ;;
  esac
  case "${LLM_RULE_EMBEDDING:-}" in
    00000000-0000-0000-0000-000000000001|00000000-0000-0000-0000-000000000002)
      echo "[eigen] ERROR: LLM_RULE_EMBEDDING is a Docker placeholder UUID. Set your EUrouter routing rule IDs at runtime."
      exit 1
      ;;
  esac
fi

echo "[eigen] Starting application..."
exec node build/index.js
