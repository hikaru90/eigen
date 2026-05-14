#!/usr/bin/env bash
# =============================================================================
# Eigen — Install Script
# =============================================================================
# Interactively configures and boots a fresh Eigen deployment.
# Run once on a fresh VPS after cloning the repository:
#
#   bash install.sh
#
# Prerequisites: docker (with compose v2 plugin), openssl
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

print_header() {
  echo ""
  echo -e "${CYAN}${BOLD}$1${RESET}"
  echo -e "${CYAN}$(printf '%.0s─' $(seq 1 ${#1}))${RESET}"
}

print_success() { echo -e "${GREEN}✓ $1${RESET}"; }
print_warn()    { echo -e "${YELLOW}⚠ $1${RESET}"; }
print_error()   { echo -e "${RED}✗ $1${RESET}"; }
print_step()    { echo -e "  ${BOLD}→${RESET} $1"; }

die() {
  print_error "$1"
  exit 1
}

prompt() {
  # prompt <var_name> <display_label> [default]
  local var="$1"
  local label="$2"
  local default="${3:-}"
  local value=""
  if [[ -n "$default" ]]; then
    read -rp "  $label [$default]: " value
    value="${value:-$default}"
  else
    while [[ -z "$value" ]]; do
      read -rp "  $label: " value
      [[ -z "$value" ]] && print_warn "This field is required."
    done
  fi
  printf -v "$var" '%s' "$value"
}

prompt_secret() {
  # prompt_secret <var_name> <display_label>
  local var="$1"
  local label="$2"
  local value=""
  local confirm=""
  while true; do
    read -rsp "  $label: " value
    echo ""
    if [[ ${#value} -lt 8 ]]; then
      print_warn "Must be at least 8 characters."
      continue
    fi
    read -rsp "  Confirm $label: " confirm
    echo ""
    if [[ "$value" != "$confirm" ]]; then
      print_warn "Passwords do not match. Try again."
      continue
    fi
    break
  done
  printf -v "$var" '%s' "$value"
}

generate() {
  # generate <type: hex16|hex32|base64_32|hex64>
  case "$1" in
    hex16)    openssl rand -hex 16 ;;
    hex32)    openssl rand -hex 32 ;;
    hex64)    openssl rand -hex 32 ;; # 32 bytes = 64 hex chars
    base64_32) openssl rand -base64 32 | tr -d '\n' ;;
  esac
}

wait_healthy() {
  # wait_healthy <service> <max_seconds>
  local service="$1"
  local max="${2:-60}"
  local elapsed=0
  print_step "Waiting for $service to be healthy..."
  while true; do
    local status
    status=$(docker compose ps --format json "$service" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null \
      || echo "")
    if [[ "$status" == "healthy" ]]; then
      print_success "$service is healthy."
      return 0
    fi
    if [[ $elapsed -ge $max ]]; then
      die "$service did not become healthy within ${max}s. Check: docker compose logs $service"
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
}

# ---------------------------------------------------------------------------
# Step 1 — Prerequisites
# ---------------------------------------------------------------------------

print_header "Eigen Installer"
echo "  This script will configure and boot your Eigen deployment."
echo "  It should take about 2–5 minutes."
echo ""

print_header "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die "docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "docker compose v2 plugin not found. See https://docs.docker.com/compose/install/"
command -v openssl >/dev/null 2>&1 || die "openssl is not installed. Install it with: apt install openssl"
command -v python3 >/dev/null 2>&1 || die "python3 is not installed (required for JSON parsing). Install it with: apt install python3"

print_success "docker $(docker --version | awk '{print $3}' | tr -d ',')"
print_success "docker compose $(docker compose version --short)"
print_success "openssl"

# ---------------------------------------------------------------------------
# Step 2 — Guard against re-install
# ---------------------------------------------------------------------------

print_header "Checking for existing installation"

if [[ -f ".env" ]]; then
  die ".env already exists. Eigen may already be installed.\nDelete .env and re-run this script to start fresh.\n${BOLD}Warning: this will reset your configuration.${RESET}"
fi

print_success "No existing .env found — proceeding with fresh install."

# ---------------------------------------------------------------------------
# Step 3 — Collect configuration
# ---------------------------------------------------------------------------

print_header "Configuration"

echo ""
echo "  Enter your deployment's public URL."
echo "  This must match the domain your reverse proxy points at Eigen."
echo "  Examples: https://eigen.example.com  or  http://123.45.67.89:3000"
echo ""

ORIGIN=""
while true; do
  prompt ORIGIN "Public URL"
  if [[ "$ORIGIN" =~ ^https?:// ]]; then
    break
  fi
  print_warn "Must start with http:// or https://"
done

# ---------------------------------------------------------------------------
# Step 4 — Generate secrets
# ---------------------------------------------------------------------------

print_header "Generating secrets"

POSTGRES_PASSWORD=$(generate hex16)
FALKOR_PASSWORD=$(generate hex16)
ENCRYPTION_KEY=$(generate hex64)
BETTER_AUTH_SECRET=$(generate base64_32)

print_success "POSTGRES_PASSWORD generated"
print_success "FALKOR_PASSWORD generated"
print_success "ENCRYPTION_KEY generated"
print_success "BETTER_AUTH_SECRET generated"

# ---------------------------------------------------------------------------
# Step 5 — Admin account
# ---------------------------------------------------------------------------

print_header "Admin account"

echo "  Create the initial administrator account."
echo ""

prompt ADMIN_NAME  "Name"
prompt ADMIN_EMAIL "Email"

while true; do
  if [[ "$ADMIN_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
    break
  fi
  print_warn "Please enter a valid email address."
  prompt ADMIN_EMAIL "Email"
done

prompt_secret ADMIN_PASSWORD "Password"

# ---------------------------------------------------------------------------
# Step 6 — Print secrets (shown once)
# ---------------------------------------------------------------------------

print_header "Generated secrets — save these now"

echo ""
echo -e "  ${BOLD}${YELLOW}Store these in a secure password manager."
echo -e "  They will not be shown again.${RESET}"
echo ""
echo -e "  ${BOLD}POSTGRES_PASSWORD${RESET}  = ${POSTGRES_PASSWORD}"
echo -e "  ${BOLD}FALKOR_PASSWORD${RESET}    = ${FALKOR_PASSWORD}"
echo -e "  ${BOLD}ENCRYPTION_KEY${RESET}     = ${ENCRYPTION_KEY}"
echo -e "  ${BOLD}BETTER_AUTH_SECRET${RESET} = ${BETTER_AUTH_SECRET}"
echo ""
read -rp "  Press Enter once you have saved these secrets..."

# ---------------------------------------------------------------------------
# Step 7 — Write .env
# ---------------------------------------------------------------------------

print_header "Writing .env"

DATABASE_URL="postgres://eigen:${POSTGRES_PASSWORD}@db:5432/eigen"

cat > .env <<EOF
# Generated by install.sh — do not edit manually unless you know what you are doing.

# Postgres
POSTGRES_USER=eigen
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=${DATABASE_URL}

# FalkorDB
FALKOR_HOST=falkordb
FALKOR_PORT=6379
FALKOR_USERNAME=default
FALKOR_PASSWORD=${FALKOR_PASSWORD}
FALKOR_GRAPH=eigen_memory
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# App
ORIGIN=${ORIGIN}

# Better Auth
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}

# LLM (configure after first login via the app settings)
LLM_BASE_URL=
LLM_API_KEY=
LLM_MIN_REQUEST_INTERVAL_MS=1000
LLM_RULE_CHAT=
LLM_RULE_EMBEDDING=
EMBEDDING_COMPRESS_INTENSITY=full
EOF

print_success ".env written."

# ---------------------------------------------------------------------------
# Step 8 — Build images
# ---------------------------------------------------------------------------

print_header "Building Docker images"
echo "  This may take a few minutes on first run..."
echo ""

docker compose build

print_success "Images built."

# ---------------------------------------------------------------------------
# Step 9 — Start databases and wait for healthy
# ---------------------------------------------------------------------------

print_header "Starting databases"

docker compose up -d db falkordb

wait_healthy "db"      60
wait_healthy "falkordb" 90

# ---------------------------------------------------------------------------
# Step 10 — Run migrations
# ---------------------------------------------------------------------------

print_header "Running database migrations"

docker compose --profile migrate run --rm migrate

print_success "Schema and RLS policies applied."

# ---------------------------------------------------------------------------
# Step 11 — Create admin user
# ---------------------------------------------------------------------------

print_header "Creating admin user"

docker compose run --rm \
  -e ADMIN_NAME="${ADMIN_NAME}" \
  -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  app node scripts/create-admin.mjs

print_success "Admin user created: ${ADMIN_EMAIL}"

# ---------------------------------------------------------------------------
# Step 12 — Start full stack
# ---------------------------------------------------------------------------

print_header "Starting Eigen"

docker compose up -d

# ---------------------------------------------------------------------------
# Step 13 — Done
# ---------------------------------------------------------------------------

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║        Eigen is ready!                   ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}URL:${RESET}   ${ORIGIN}"
echo -e "  ${BOLD}Admin:${RESET} ${ADMIN_EMAIL}"
echo ""
echo "  To follow logs:   docker compose logs -f app"
echo "  To stop:          docker compose down"
echo "  To update:        git pull && docker compose build && docker compose up -d"
echo ""
echo -e "  ${YELLOW}${BOLD}Next step:${RESET} Log in and configure your LLM provider in the app settings."
echo ""
