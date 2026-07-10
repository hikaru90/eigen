#!/bin/sh
# Generate production .env for Docker Compose (VPS / self-hosted).
# Usage: ./install.sh [--origin URL] [--non-interactive] [--billing platform|byok]
#        [--admin-name NAME] [--admin-email EMAIL] [--admin-password PASS]
#        [--with-caddy DOMAIN] [--force]
set -e

# ── Logging setup (POSIX-compatible) ───────────────────────────────────────
# Each log() call writes to BOTH stdout AND a log file.
_LOGFILE=""
_log_write() {
	# $1 = line to write; writes to both stdout and log file.
	printf '%s\n' "$1"
	if [ -n "$_LOGFILE" ]; then
		printf '%s\n' "$1" >>"$_LOGFILE"
	fi
}
log() {
	_log_write "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}
log_ok() {
	_log_write "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ $*"
}
log_warn() {
	_log_write "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ $*"
}
log_err() {
	_log_write "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ $*"
}

# ── Resolve SCRIPT_DIR and set up log file ─────────────────────────────────
# Must happen early so log() works from here on.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
_LOGFILE="${SCRIPT_DIR}/install-$(date +%Y%m%d-%H%M%S).log"
touch "$_LOGFILE" 2>/dev/null || _LOGFILE="/tmp/install-$(date +%Y%m%d-%H%M%S).log"
touch "$_LOGFILE" 2>/dev/null || _LOGFILE=""

log "install.sh started"
log "Log file: ${_LOGFILE:-<unable to create>}"
log "Shell: ${SHELL:-unknown}"
log "User: $(whoami)"
log "Working dir: $(pwd)"
log "Date: $(date)"
log "OS: $(uname -a 2>/dev/null || echo 'unknown')"

# Clean up temp files on exit.
trap 'rm -f "${ENV_FILE:-/dev/null}.tmp" "${ENV_FILE:-/dev/null}.test"' EXIT

ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"
ENV_FILE="${SCRIPT_DIR}/.env"
CADDYFILE="${SCRIPT_DIR}/deploy/Caddyfile"

ORIGIN=""
NON_INTERACTIVE=0
BILLING=""
ADMIN_NAME=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
WITH_CADDY=""
FORCE=0

usage() {
	cat <<'EOF'
Eigen production installer — writes .env for Docker Compose.

Usage:
  ./install.sh [options]

Options:
  --origin URL              Public app URL (required in --non-interactive mode)
  --non-interactive         No prompts; fail if required args are missing
  --billing platform|byok   Hint for which LLM/PayPal vars you must fill manually
  --admin-name NAME         Bootstrap admin display name
  --admin-email EMAIL       Bootstrap admin email (entrypoint creates user on start)
  --admin-password PASS     Bootstrap admin password
  --with-caddy DOMAIN       Write deploy/Caddyfile proxying DOMAIN -> localhost:3000
  --force                   Overwrite existing .env
  -h, --help                Show this help

Examples:
  ./install.sh --non-interactive --origin https://eigen.example.com --billing platform
  ./install.sh --origin http://localhost:3000 --with-caddy eigen.example.com

After install.sh:
  1. Edit .env — add LLM gateway credentials (and PayPal if using platform credits).
  2. docker compose up -d --build

See docs/operations/vps-install.md for the full VPS runbook.
EOF
}

die() {
	log_err "$*"
	exit 1
}

rand_hex() {
	openssl rand -hex 32
}

rand_base64() {
	openssl rand -base64 32
}

set_env_var() {
	key="$1"
	value="$2"
	file="$3"
	# Escape sed delimiter (|), ampersand, slash, backslash, and double-quote for safe .env embedding.
	escaped=$(printf '%s\n' "$value" | sed 's/[&|/\\"]/\\&/g')
	if grep -q "^${key}=" "$file" 2>/dev/null; then
		sed "s|^${key}=.*|${key}=\"${escaped}\"|" "$file" >"${file}.tmp" && mv "${file}.tmp" "$file"
	else
		printf '%s="%s"\n' "$key" "$value" >>"$file"
	fi
}

# ── Parse arguments ────────────────────────────────────────────────────────
log "Parsing arguments: $*"
while [ $# -gt 0 ]; do
	case "$1" in
		--origin)
			[ -n "${2:-}" ] || die "--origin requires a value"
			ORIGIN=$2
			shift 2
			;;
		--non-interactive)
			NON_INTERACTIVE=1
			shift
			;;
		--billing)
			[ -n "${2:-}" ] || die "--billing requires platform or byok"
			BILLING=$2
			shift 2
			;;
		--admin-name)
			[ -n "${2:-}" ] || die "--admin-name requires a value"
			ADMIN_NAME=$2
			shift 2
			;;
		--admin-email)
			[ -n "${2:-}" ] || die "--admin-email requires a value"
			ADMIN_EMAIL=$2
			shift 2
			;;
		--admin-password)
			[ -n "${2:-}" ] || die "--admin-password requires a value"
			ADMIN_PASSWORD=$2
			shift 2
			;;
		--with-caddy)
			[ -n "${2:-}" ] || die "--with-caddy requires a domain"
			WITH_CADDY=$2
			shift 2
			;;
		--force)
			FORCE=1
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			die "unknown option: $1 (try --help)"
			;;
	esac
done
log "Parsed: ORIGIN=${ORIGIN:-<not set>} NON_INTERACTIVE=$NON_INTERACTIVE BILLING=${BILLING:-<not set>} FORCE=$FORCE WITH_CADDY=${WITH_CADDY:-<not set>} ADMIN_NAME=${ADMIN_NAME:-<not set>} ADMIN_EMAIL=${ADMIN_EMAIL:-<not set>}"

# ── Preflight checks ──────────────────────────────────────────────────────
log "Preflight: checking openssl..."
command -v openssl >/dev/null 2>&1 || die "openssl is required but not found in PATH"
log_ok "openssl: $(openssl version 2>/dev/null)"

log "Preflight: checking PATH for docker..."
if command -v docker >/dev/null 2>&1; then
	log_ok "docker: $(docker --version 2>/dev/null)"
else
	log_warn "docker not found in PATH — you will need it for docker compose up"
fi

log "Preflight: checking docker compose..."
if docker compose version >/dev/null 2>&1; then
	log_ok "docker compose: $(docker compose version 2>/dev/null)"
elif command -v docker-compose >/dev/null 2>&1; then
	log_ok "docker-compose: $(docker-compose --version 2>/dev/null)"
else
	log_warn "docker compose not found — you will need it after install"
fi

log "Preflight: checking .env target..."
if [ -f "$ENV_FILE" ] && [ "$FORCE" -eq 0 ]; then
	die ".env already exists at ${ENV_FILE} — use --force to overwrite"
fi
log_ok ".env target: ${ENV_FILE} (force=$FORCE, exists=$( [ -f "$ENV_FILE" ] && echo yes || echo no ))"

log "Preflight: checking .env.example..."
[ -f "$ENV_EXAMPLE" ] || die ".env.example not found in ${SCRIPT_DIR}"
log_ok ".env.example found at $ENV_EXAMPLE"

# Operator credentials must never ship in .env.example (open-source release guard).
OPERATOR_SECRET_KEYS="
SERVICE_API_KEY_EUROUTER
SERVICE_API_KEY_OPENROUTER
LLM_API_KEY
OPENROUTER_API_KEY
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_SECRET
POSTHOG_API_KEY
POSTHOG_CLI_API_KEY
POSTHOG_PERSONAL_API_KEY
PUBLIC_POSTHOG_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
PAYPAL_SANDBOX_BUYER_EMAIL
PAYPAL_SANDBOX_BUYER_PASSWORD
"
log "Preflight: verifying .env.example has no operator API keys..."
for key in $OPERATOR_SECRET_KEYS; do
	line=$(grep "^${key}=" "$ENV_EXAMPLE" 2>/dev/null | head -1 || true)
	if [ -z "$line" ]; then
		continue
	fi
	val=$(printf '%s' "$line" | sed -n 's/^[^=]*="\?\([^"]*\)"\?$/\1/p')
	if [ -n "$val" ]; then
		die ".env.example must not ship with ${key} set — redact before publishing open source"
	fi
done
log_ok ".env.example has no operator API keys"

log "Preflight: checking write permissions..."
if ! touch "${ENV_FILE}.test" 2>/dev/null; then
	die "Cannot write to $(dirname "${ENV_FILE}") — check permissions or run from a writable directory"
fi
rm -f "${ENV_FILE}.test"
log_ok "Write permission to $(dirname "$ENV_FILE") verified"

# ── Prompt for missing values ──────────────────────────────────────────────
if [ -z "$ORIGIN" ]; then
	log "ORIGIN not provided, prompting interactively..."
	if [ "$NON_INTERACTIVE" -eq 1 ]; then
		die "--origin is required in --non-interactive mode"
	fi
	printf 'Public ORIGIN (e.g. https://eigen.example.com): '
	read -r ORIGIN
fi

[ -n "$ORIGIN" ] || die "ORIGIN must not be empty"
log_ok "ORIGIN=$ORIGIN"

case "$BILLING" in
	"" | platform | byok) ;;
	*)
		die "--billing must be platform or byok"
		;;
esac

if [ -z "$BILLING" ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
	printf 'Billing path [platform/byok] (default: platform): '
	read -r BILLING
fi
BILLING=${BILLING:-platform}
log_ok "BILLING=$BILLING"

# ── Generate secrets ───────────────────────────────────────────────────────
log "Generating cryptographic secrets..."
POSTGRES_PASSWORD=$(rand_hex)
EIGEN_APP_DB_PASSWORD=$(rand_hex)
BETTER_AUTH_SECRET=$(rand_base64)
TENANT_MASTER_KEY=$(rand_hex)
ADMIN_CONSOLIDATION_KEY=$(rand_hex)
DATABASE_URL="postgres://eigen:${POSTGRES_PASSWORD}@db:5432/eigen"

log_ok "Secrets generated (lengths):"
log "  POSTGRES_PASSWORD:          ${#POSTGRES_PASSWORD} chars"
log "  EIGEN_APP_DB_PASSWORD:      ${#EIGEN_APP_DB_PASSWORD} chars"
log "  BETTER_AUTH_SECRET:         ${#BETTER_AUTH_SECRET} chars"
log "  TENANT_MASTER_KEY:          ${#TENANT_MASTER_KEY} chars"
log "  ADMIN_CONSOLIDATION_KEY:    ${#ADMIN_CONSOLIDATION_KEY} chars"
log "  DATABASE_URL host=db:5432, db=eigen, user=eigen"
log "  NOTE: DATABASE_URL uses internal Docker hostname 'db' — this is correct for docker-compose networking."

# ── Copy .env.example -> .env ──────────────────────────────────────────────
log "Copying .env.example -> .env..."
cp "$ENV_EXAMPLE" "$ENV_FILE"
log_ok "Copied .env.example to $ENV_FILE"

log "Clearing operator API keys in .env (must be added manually after install)..."
for key in $OPERATOR_SECRET_KEYS; do
	set_env_var "$key" "" "$ENV_FILE"
done
log_ok "Operator API key slots cleared"

# ── Write all env vars ─────────────────────────────────────────────────────
log "Writing environment variables to .env..."

set_env_var POSTGRES_USER eigen "$ENV_FILE"
log "  POSTGRES_USER=eigen"

set_env_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$ENV_FILE"
log "  POSTGRES_PASSWORD set (${#POSTGRES_PASSWORD} chars)"

set_env_var EIGEN_APP_DB_PASSWORD "$EIGEN_APP_DB_PASSWORD" "$ENV_FILE"
log "  EIGEN_APP_DB_PASSWORD set (${#EIGEN_APP_DB_PASSWORD} chars)"

set_env_var DATABASE_URL "$DATABASE_URL" "$ENV_FILE"
log "  DATABASE_URL set"

set_env_var DATABASE_ADMIN_URL "$DATABASE_URL" "$ENV_FILE"
log "  DATABASE_ADMIN_URL set (same as DATABASE_URL)"

set_env_var ORIGIN "$ORIGIN" "$ENV_FILE"
log "  ORIGIN=$ORIGIN"

set_env_var AGE_GRAPH_NAME eigen_graph "$ENV_FILE"
log "  AGE_GRAPH_NAME=eigen_graph"

set_env_var BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET" "$ENV_FILE"
log "  BETTER_AUTH_SECRET set"

set_env_var TENANT_MASTER_KEY "$TENANT_MASTER_KEY" "$ENV_FILE"
log "  TENANT_MASTER_KEY set"

set_env_var ADMIN_CONSOLIDATION_KEY "$ADMIN_CONSOLIDATION_KEY" "$ENV_FILE"
log "  ADMIN_CONSOLIDATION_KEY set"

set_env_var POSTHOG_SOURCEMAPS_REQUIRED 0 "$ENV_FILE"
log "  POSTHOG_SOURCEMAPS_REQUIRED=0"

set_env_var CONSOLIDATION_INTERNAL_URL http://app:3000 "$ENV_FILE"
log "  CONSOLIDATION_INTERNAL_URL=http://app:3000"

# Default admin credentials (can be overridden via --admin-* flags)
ADMIN_NAME="${ADMIN_NAME:-admin@user.de}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@eigen.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme123}"
set_env_var ADMIN_NAME "$ADMIN_NAME" "$ENV_FILE"
log "  ADMIN_NAME=$ADMIN_NAME"
set_env_var ADMIN_EMAIL "$ADMIN_EMAIL" "$ENV_FILE"
log "  ADMIN_EMAIL=$ADMIN_EMAIL"
set_env_var ADMIN_PASSWORD "$ADMIN_PASSWORD" "$ENV_FILE"
log "  ADMIN_PASSWORD set (${#ADMIN_PASSWORD} chars)"

if command -v node >/dev/null 2>&1 && [ -f "${SCRIPT_DIR}/node_modules/web-push/package.json" ]; then
	log "Generating VAPID keys for web push..."
	VAPID_JSON=$(node "${SCRIPT_DIR}/scripts/generate-vapid-keys.mjs")
	VAPID_PUBLIC_KEY=$(printf '%s' "$VAPID_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).publicKey)")
	VAPID_PRIVATE_KEY=$(printf '%s' "$VAPID_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).privateKey)")
	VAPID_SUBJECT="mailto:${ADMIN_EMAIL}"
	set_env_var VAPID_PUBLIC_KEY "$VAPID_PUBLIC_KEY" "$ENV_FILE"
	set_env_var VAPID_PRIVATE_KEY "$VAPID_PRIVATE_KEY" "$ENV_FILE"
	set_env_var VAPID_SUBJECT "$VAPID_SUBJECT" "$ENV_FILE"
	log_ok "VAPID keys generated (subject=${VAPID_SUBJECT})"
else
	log_warn "node/web-push unavailable during install — VAPID keys will be generated on first container start"
fi

log_ok "All base environment variables written to $ENV_FILE"

# ── Verify critical variables were written ─────────────────────────────────
log "Validating critical variables in .env..."
for key in DATABASE_URL POSTGRES_PASSWORD BETTER_AUTH_SECRET TENANT_MASTER_KEY; do
	val=$(grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')
	if [ -z "$val" ]; then
		die "Post-write validation failed: ${key} is empty or missing in ${ENV_FILE}"
	fi
	log_ok "  ${key} present (${#val} chars)"
done
log_ok "All critical variables validated"



# ── Optional Caddyfile ────────────────────────────────────────────────────
if [ -n "$WITH_CADDY" ]; then
	mkdir -p "$(dirname "$CADDYFILE")"
	log "Writing Caddyfile for domain: $WITH_CADDY"
	cat >"$CADDYFILE" <<EOF
# Reverse proxy for Eigen (generated by install.sh).
# Install Caddy on the host, then: sudo caddy run --config deploy/Caddyfile
# ORIGIN in .env must match https://${WITH_CADDY}

${WITH_CADDY} {
	reverse_proxy localhost:3000
}
EOF
	log_ok "Wrote ${CADDYFILE} (proxy ${WITH_CADDY} -> localhost:3000)"
fi

# ── Dump final .env summary (without secrets) ─────────────────────────────
log "Final .env summary (secrets redacted)..."
REDACTED_KEYS='^(POSTGRES_PASSWORD|EIGEN_APP_DB_PASSWORD|BETTER_AUTH_SECRET|TENANT_MASTER_KEY|ADMIN_CONSOLIDATION_KEY|ADMIN_PASSWORD|DATABASE_URL|DATABASE_ADMIN_URL|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|SERVICE_API_KEY_EUROUTER|SERVICE_API_KEY_OPENROUTER|LLM_API_KEY|OPENROUTER_API_KEY|PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|PAYPAL_SECRET|POSTHOG_API_KEY|POSTHOG_CLI_API_KEY|POSTHOG_PERSONAL_API_KEY|PUBLIC_POSTHOG_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_ID|GITHUB_CLIENT_SECRET|PAYPAL_SANDBOX_BUYER_EMAIL|PAYPAL_SANDBOX_BUYER_PASSWORD)='
grep -v -E "$REDACTED_KEYS" "$ENV_FILE" | while IFS= read -r line; do
	log "  $line"
done
log "(Secrets and operator credentials redacted from summary above)"

# ── Docker preflight: check if compose stack is already running ────────────
log "Checking Docker Compose stack status..."
if command -v docker >/dev/null 2>&1 && docker compose ps >/dev/null 2>&1; then
	log "Docker Compose stack found. Container statuses:"
	docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps
elif command -v docker-compose >/dev/null 2>&1 && docker-compose ps >/dev/null 2>&1; then
	log "Docker Compose stack found (docker-compose). Container statuses:"
	docker-compose ps
else
	log_warn "No running Docker Compose stack detected (this is normal if you haven't run 'docker compose up' yet)."
fi

# ── PostgreSQL connectivity check (best-effort, informational only) ────────
log "Attempting PostgreSQL connectivity check (best-effort)..."
if command -v docker >/dev/null 2>&1 && docker compose ps db >/dev/null 2>&1; then
	DB_CONTAINER=$(docker compose ps -q db 2>/dev/null)
	if [ -n "$DB_CONTAINER" ]; then
		log "  PostgreSQL container found: $DB_CONTAINER"
		DB_RUNNING=$(docker inspect --format='{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || echo "unknown")
		log "  PostgreSQL container running: $DB_RUNNING"
		DB_IMAGE=$(docker inspect --format='{{.Config.Image}}' "$DB_CONTAINER" 2>/dev/null || echo "unknown")
		log "  PostgreSQL image: $DB_IMAGE"

		# Check if the container has the required extensions (pgvector, apache AGE)
		log "  Checking for pgvector extension..."
		docker compose exec -T db psql -U eigen -d eigen -c "SELECT extname FROM pg_extension WHERE extname = 'vector';" >/dev/null 2>&1 && log_ok "  pgvector extension found" || log_warn "  pgvector extension NOT found or db not running"
		log "  Checking for Apache AGE extension..."
		docker compose exec -T db psql -U eigen -d eigen -c "SELECT extname FROM pg_extension WHERE extname = 'age';" >/dev/null 2>&1 && log_ok "  Apache AGE extension found" || log_warn "  Apache AGE extension NOT found or db not running"
	else
		log_warn "  Could not determine PostgreSQL container ID"
	fi
else
	log_warn "  Cannot check PostgreSQL — either Docker or docker compose is unavailable, or db container is not running."
	log_warn "  If the stack isn't up yet, run 'docker compose up -d --build' first, then check the logs."
fi

# ── Done ───────────────────────────────────────────────────────────────────
log ""
log_ok "install.sh completed successfully"
echo ""
echo "Wrote ${ENV_FILE} with generated secrets."
echo ""
echo "Log saved to: ${_LOGFILE:-<unable to create>}"
echo ""
echo "Next steps:"
echo "  1. Edit .env and set LLM credentials:"
if [ "$BILLING" = platform ]; then
	echo "     Platform credits — SERVICE_API_KEY_EUROUTER, LLM_BASE_URL,"
	echo "     LLM_RULE_CHAT, LLM_RULE_EMBEDDING, and PayPal (PAYPAL_*)."
else
	echo "     BYOK — LLM_BASE_URL, LLM_API_KEY, LLM_RULE_CHAT, LLM_RULE_EMBEDDING"
	echo "     (users configure keys in Settings → LLM → BYOK)."
fi
echo "  2. docker compose up -d --build"
echo "  3. Open ${ORIGIN} and sign in (or use ADMIN_* bootstrap if set)."
echo ""
echo "Full runbook: docs/operations/vps-install.md"
