#!/usr/bin/env bash
# =============================================================================
# Eigen — Install Script
# =============================================================================
# Interactively configures a fresh Eigen deployment.
# Run once on your server after cloning the repository:
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

die() {
  print_error "$1"
  exit 1
}

prompt() {
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
  case "$1" in
    hex16)     openssl rand -hex 16 ;;
    hex64)     openssl rand -hex 32 ;;
    base64_32) openssl rand -base64 32 | tr -d '\n' ;;
  esac
}

# ---------------------------------------------------------------------------
# Step 1 — Prerequisites
# ---------------------------------------------------------------------------

print_header "Eigen Installer"
echo "  This script will configure your Eigen deployment."
echo ""

print_header "Checking prerequisites"

command -v openssl >/dev/null 2>&1 || die "openssl is not installed. Install with: apt install openssl"
print_success "openssl"

# ---------------------------------------------------------------------------
# Step 2 — Guard against re-install
# ---------------------------------------------------------------------------

print_header "Checking for existing installation"

if [[ -f ".env" ]]; then
  die ".env already exists. Delete it and re-run this script to start fresh.\n${BOLD}Warning: this will reset your configuration.${RESET}"
fi

print_success "No existing .env found — proceeding."

# ---------------------------------------------------------------------------
# Step 3 — Public URL
# ---------------------------------------------------------------------------

print_header "Public URL"
echo ""
echo "  The URL your users will access Eigen at."
echo "  Must match the domain your reverse proxy points at this server."
echo "  Examples: https://eigen.example.com   http://123.45.67.89:3000"
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

print_success "POSTGRES_PASSWORD  generated"
print_success "FALKOR_PASSWORD    generated"
print_success "ENCRYPTION_KEY     generated"
print_success "BETTER_AUTH_SECRET generated"

# ---------------------------------------------------------------------------
# Step 5 — Admin account
# ---------------------------------------------------------------------------

print_header "Admin account"
echo "  This will be the first user created on first boot."
echo ""

prompt ADMIN_NAME "Name"

ADMIN_EMAIL=""
while true; do
  prompt ADMIN_EMAIL "Email"
  if [[ "$ADMIN_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
    break
  fi
  print_warn "Please enter a valid email address."
done

prompt_secret ADMIN_PASSWORD "Password"

# ---------------------------------------------------------------------------
# Step 6 — Show generated secrets (once)
# ---------------------------------------------------------------------------

print_header "Generated secrets — save these now"
echo ""
echo -e "  ${BOLD}${YELLOW}Store these in a secure password manager. They will not be shown again.${RESET}"
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

cat > .env <<EOF
# Generated by install.sh

# Postgres
POSTGRES_USER=eigen
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgres://eigen:${POSTGRES_PASSWORD}@db:5432/eigen

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

# Admin — used on first boot to create the initial user, ignored afterwards
ADMIN_NAME=${ADMIN_NAME}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# LLM — configure after first login via the app settings
LLM_BASE_URL=
LLM_API_KEY=
LLM_MIN_REQUEST_INTERVAL_MS=1000
LLM_RULE_CHAT=
LLM_RULE_EMBEDDING=
EMBEDDING_COMPRESS_INTENSITY=full
EOF

print_success ".env written."

# ---------------------------------------------------------------------------
# Step 8 — Done
# ---------------------------------------------------------------------------

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║     Configuration complete!              ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}.env has been written.${RESET} Now start the stack:"
echo ""
echo -e "  ${BOLD}docker compose up -d${RESET}"
echo ""
echo "  On first boot the app will automatically:"
echo "    • Apply database migrations"
echo "    • Create your admin account (${ADMIN_EMAIL})"
echo "    • Start serving at ${ORIGIN}"
echo ""
echo "  Follow progress with:  docker compose logs -f app"
echo "  To stop:               docker compose down"
echo "  To update:             git pull && docker compose build && docker compose up -d"
echo ""
echo -e "  ${YELLOW}${BOLD}Next step:${RESET} Log in and configure your LLM provider in the app settings."
echo ""
