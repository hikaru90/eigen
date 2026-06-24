#!/bin/sh
# Generate production .env for Docker Compose (VPS / self-hosted).
# Usage: ./install.sh [--origin URL] [--non-interactive] [--billing platform|byok]
#        [--admin-name NAME] [--admin-email EMAIL] [--admin-password PASS]
#        [--with-caddy DOMAIN] [--force]
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
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
	echo "install.sh: $*" >&2
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
	escaped=$(printf '%s\n' "$value" | sed 's/[&/\]/\\&/g')
	if grep -q "^${key}=" "$file" 2>/dev/null; then
		sed "s|^${key}=.*|${key}=\"${escaped}\"|" "$file" >"${file}.tmp" && mv "${file}.tmp" "$file"
	else
		printf '%s="%s"\n' "$key" "$value" >>"$file"
	fi
}

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

command -v openssl >/dev/null 2>&1 || die "openssl is required"

if [ -f "$ENV_FILE" ] && [ "$FORCE" -eq 0 ]; then
	die ".env already exists — use --force to overwrite"
fi

[ -f "$ENV_EXAMPLE" ] || die ".env.example not found in ${SCRIPT_DIR}"

if [ -z "$ORIGIN" ]; then
	if [ "$NON_INTERACTIVE" -eq 1 ]; then
		die "--origin is required in --non-interactive mode"
	fi
	printf 'Public ORIGIN (e.g. https://eigen.example.com): '
	read -r ORIGIN
fi

[ -n "$ORIGIN" ] || die "ORIGIN must not be empty"

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

POSTGRES_PASSWORD=$(rand_hex)
EIGEN_APP_DB_PASSWORD=$(rand_hex)
BETTER_AUTH_SECRET=$(rand_base64)
TENANT_MASTER_KEY=$(rand_hex)
ADMIN_CONSOLIDATION_KEY=$(rand_hex)
DATABASE_URL="postgres://eigen:${POSTGRES_PASSWORD}@db:5432/eigen"

cp "$ENV_EXAMPLE" "$ENV_FILE"

set_env_var POSTGRES_USER eigen "$ENV_FILE"
set_env_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$ENV_FILE"
set_env_var EIGEN_APP_DB_PASSWORD "$EIGEN_APP_DB_PASSWORD" "$ENV_FILE"
set_env_var DATABASE_URL "$DATABASE_URL" "$ENV_FILE"
set_env_var DATABASE_ADMIN_URL "$DATABASE_URL" "$ENV_FILE"
set_env_var ORIGIN "$ORIGIN" "$ENV_FILE"
set_env_var AGE_GRAPH_NAME eigen_graph "$ENV_FILE"
set_env_var BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET" "$ENV_FILE"
set_env_var TENANT_MASTER_KEY "$TENANT_MASTER_KEY" "$ENV_FILE"
set_env_var ADMIN_CONSOLIDATION_KEY "$ADMIN_CONSOLIDATION_KEY" "$ENV_FILE"
set_env_var POSTHOG_SOURCEMAPS_REQUIRED 0 "$ENV_FILE"
set_env_var CONSOLIDATION_INTERNAL_URL http://app:3000 "$ENV_FILE"

if [ -n "$ADMIN_NAME" ]; then
	set_env_var ADMIN_NAME "$ADMIN_NAME" "$ENV_FILE"
fi
if [ -n "$ADMIN_EMAIL" ]; then
	set_env_var ADMIN_EMAIL "$ADMIN_EMAIL" "$ENV_FILE"
fi
if [ -n "$ADMIN_PASSWORD" ]; then
	set_env_var ADMIN_PASSWORD "$ADMIN_PASSWORD" "$ENV_FILE"
fi

if [ -n "$WITH_CADDY" ]; then
	mkdir -p "$(dirname "$CADDYFILE")"
	cat >"$CADDYFILE" <<EOF
# Reverse proxy for Eigen (generated by install.sh).
# Install Caddy on the host, then: sudo caddy run --config deploy/Caddyfile
# ORIGIN in .env must match https://${WITH_CADDY}

${WITH_CADDY} {
	reverse_proxy localhost:3000
}
EOF
	echo "Wrote ${CADDYFILE} (proxy ${WITH_CADDY} -> localhost:3000)"
fi

echo ""
echo "Wrote ${ENV_FILE} with generated secrets."
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
