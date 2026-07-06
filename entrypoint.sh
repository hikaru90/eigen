#!/bin/sh
set -e

# Diagnostic trap: print which step failed on unexpected exit.
trap 'echo "[eigen] entrypoint.sh: unexpected exit at line $LINENO (exit code $?)" >&2' EXIT

run_step() {
	step_name="$1"
	shift
	echo "[eigen] ${step_name}..."
	if ! "$@"; then
		echo "[eigen] FATAL: ${step_name} failed (exit code $?)." >&2
		echo "[eigen] Check the logs above for details. Common causes:" >&2
		echo "[eigen]   - DATABASE_URL points to wrong host or credentials" >&2
		echo "[eigen]   - PostgreSQL is not ready (try: docker compose logs db)" >&2
		echo "[eigen]   - AGE_GRAPH_NAME is not set in .env" >&2
		exit 1
	fi
}

run_step "Ensuring database extensions" node scripts/ensure-extensions.mjs
run_step "Ensuring non-superuser app role (eigen_app)" node scripts/ensure-app-role.mjs
run_step "Verifying eigen_app can write Apache AGE graph" node scripts/verify-age-graph-role.mjs
run_step "Running database migrations" node scripts/migrate.mjs
run_step "Applying RLS policies" node scripts/apply-rls.mjs
run_step "Bootstrapping production ops (secrets, pg_cron)" node scripts/bootstrap-production-ops.mjs

# Create admin user on first boot if credentials are provided.
# create-admin.mjs is idempotent — skips silently if the user already exists.
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ] && [ -n "${ADMIN_NAME:-}" ]; then
  echo "[eigen] Creating admin user (${ADMIN_EMAIL})..."
  node scripts/create-admin.mjs
elif [ -n "${ADMIN_EMAIL:-}" ] || [ -n "${ADMIN_PASSWORD:-}" ] || [ -n "${ADMIN_NAME:-}" ]; then
  echo "[eigen] WARNING: ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_NAME must all be set to create an admin user. Skipping." >&2
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

if [ -f /tmp/eigen-runtime.env ]; then
  echo "[eigen] Applying runtime bootstrap secrets..."
  set -a
  # shellcheck disable=SC1091
  . /tmp/eigen-runtime.env
  set +a
fi

echo "[eigen] Starting application..."
exec node build/index.js
