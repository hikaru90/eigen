# VPS install runbook

Self-hosted Eigen on a bare Linux VPS (Ubuntu/Debian). For Coolify, see [README](../../README.md#deploying-to-coolify). For env var reference and billing paths, see [onboarding and setup](../getting-started/onboarding-and-setup.md).

## Prerequisites

| Requirement | Notes                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| **OS**      | Ubuntu 22.04+ or Debian 12+                                                                    |
| **RAM**     | ≥ 4 GB recommended (first Postgres image build compiles pgvector, Apache AGE, pg_cron, pg_net) |
| **Disk**    | ≥ 20 GB free                                                                                   |
| **Docker**  | Engine + Compose plugin (`docker compose version`)                                             |
| **Git**     | Clone the repo                                                                                 |
| **openssl** | Used by `install.sh` for secrets                                                               |

Install Docker (Ubuntu example):

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# Log out and back in so docker group applies
```

## 1. Clone

```sh
git clone https://github.com/hikaru90/eigen.git
cd eigen
```

## 2. Configure environment

Run the installer (generates secrets and a Compose-ready `.env`):

```sh
./install.sh --non-interactive \
  --origin https://eigen.example.com \
  --billing platform \
  --admin-name "Admin" \
  --admin-email admin@example.com \
  --admin-password 'your-secure-password'
```

| Flag                  | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `--origin`            | Public URL users and OAuth use — must match what browsers hit |
| `--billing platform`  | Wallet + PayPal path (fill `SERVICE_API_KEY_*`, `PAYPAL_*`)   |
| `--billing byok`      | Users bring own keys in Settings → LLM → BYOK                 |
| `--with-caddy DOMAIN` | Writes `deploy/Caddyfile` for TLS reverse proxy               |
| `--force`             | Overwrite existing `.env`                                     |

Interactive mode: `./install.sh` (prompts for origin and billing).

## 3. External credentials

Edit `.env` and add LLM (and optional PayPal) values. You need **at least one** billing path.

### Platform credits (default)

| Variable                                                      | Source                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `SERVICE_API_KEY_EUROUTER`                                    | [EUrouter](https://eurouter.ai) service account           |
| `LLM_BASE_URL`                                                | e.g. `https://api.eurouter.ai/v1`                         |
| `LLM_RULE_CHAT`, `LLM_RULE_EMBEDDING`                         | Routing rule UUIDs from EUrouter dashboard                |
| `PAYPAL_API_BASE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [PayPal Developer](https://developer.paypal.com) REST app |

### BYOK only

| Variable                                    | Source                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `LLM_BASE_URL`, `LLM_API_KEY`               | EUrouter (env fallback when user has not saved keys) |
| `LLM_RULE_CHAT`, `LLM_RULE_EMBEDDING`       | EUrouter rule UUIDs                                  |
| `OPENROUTER_BASE_URL`, `OPENROUTER_API_KEY` | Optional OpenRouter fallback                         |

`install.sh` already sets: `BETTER_AUTH_SECRET`, `TENANT_MASTER_KEY`, `POSTGRES_PASSWORD`, `EIGEN_APP_DB_PASSWORD`, `ADMIN_CONSOLIDATION_KEY`, `DATABASE_URL` (`@db` host), `CONSOLIDATION_INTERNAL_URL`, `VAPID_*` (when Node is available locally), `POSTHOG_SOURCEMAPS_REQUIRED=0`. Missing `VAPID_*` / `ADMIN_CONSOLIDATION_KEY` values are generated automatically on first app container start (`entrypoint.sh` → `ensure-deploy-secrets.mjs`).

## 4. Deploy

```sh
docker compose up -d --build
```

- First **Postgres** build can take several minutes (extensions compiled from source).
- First **app** build runs SvelteKit production build.
- On start, [`entrypoint.sh`](../../entrypoint.sh) applies extensions, app role, migrations, and RLS automatically — no host `npm install` required.

Watch logs:

```sh
docker compose logs -f app
```

## 5. TLS with Caddy (recommended)

If you used `--with-caddy eigen.example.com`, or copy [`deploy/Caddyfile`](../../deploy/Caddyfile):

```sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo caddy run --config deploy/Caddyfile
```

Ensure `ORIGIN=https://eigen.example.com` in `.env` matches the Caddy site name. Restart the app after changing `ORIGIN`:

```sh
docker compose up -d app
```

## 6. Firewall

| Setup                   | Open ports                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Caddy TLS               | `80`, `443`                                                                            |
| Direct (no proxy)       | `3000`                                                                                 |
| **Never in production** | `5432` (remove `ports: ['5432:5432']` from `docker-compose.yaml` for the `db` service) |

Ubuntu UFW example (Caddy):

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 7. Verify

1. Open `ORIGIN` in a browser.
2. Sign in as admin (if `ADMIN_*` was set) or sign up.
3. Complete the welcome tour (credits or BYOK + grounding).
4. Submit a test capture on `/capture`.

## Troubleshooting

| Symptom                              | Likely cause                                       | Fix                                                                                                      |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Docker build fails on PostHog        | `POSTHOG_SOURCEMAPS_REQUIRED=1` without `phx_` key | Keep `POSTHOG_SOURCEMAPS_REQUIRED=0` (install.sh default) or set `POSTHOG_CLI_API_KEY` at **build** time |
| App cannot reach DB                  | Wrong host in `.env`                               | Use `@db:5432` in `DATABASE_URL` for Compose; compose also constructs URLs from `POSTGRES_*`             |
| EUrouter placeholder errors at start | Docker build placeholders in runtime env           | Set real `LLM_BASE_URL` and rule UUIDs (not `00000000-…`)                                                |
| Capture fails / LLM not configured   | Wallet empty or BYOK missing                       | Settings → LLM; see [payments.md](../payments.md)                                                        |
| Encrypt/decrypt errors               | Missing or rotated `TENANT_MASTER_KEY`             | [Tenant encryption runbook](./tenant-envelope-encryption.md)                                             |
| OAuth redirect mismatch              | `ORIGIN` ≠ browser URL                             | Set `ORIGIN` to exact public URL including `https://`                                                    |

### Manual migration (only if entrypoint failed)

```sh
docker compose exec app node scripts/migrate.mjs
docker compose exec app node scripts/apply-rls.mjs
```

## Related docs

- [Onboarding and setup](../getting-started/onboarding-and-setup.md) — operator accounts and env tables
- [README quick start](../../README.md) — architecture and Coolify
- [Tenant envelope encryption](./tenant-envelope-encryption.md)
