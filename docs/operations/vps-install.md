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
  --admin-name "Admin" \
  --admin-email admin@example.com \
  --admin-password 'your-secure-password'
```

| Flag                  | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `--origin`            | Public URL users and OAuth use — must match what browsers hit |
| `--with-caddy DOMAIN` | Writes `deploy/Caddyfile` for TLS reverse proxy               |
| `--force`             | Overwrite existing `.env`                                     |

Interactive mode: `./install.sh` (prompts for origin).

## 3. External credentials

Edit `.env` and add the AI and PayPal values. All AI inference runs through OpenRouter on the
operator's service key and bills users' Eigen credits; models are pinned in
`src/lib/server/billing/platform-llm.ts`.

| Variable                                                      | Source                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `OPENROUTER_BASE_URL`                                         | `https://openrouter.ai/api/v1`                            |
| `SERVICE_API_KEY_OPENROUTER`                                  | [OpenRouter](https://openrouter.ai) service account key   |
| `PAYPAL_API_BASE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [PayPal Developer](https://developer.paypal.com) REST app |

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
| Drizzle Gateway         | Prefer HTTPS via Traefik (`studio.eigenmesh.xyz` → `4983`); always set `DRIZZLE_GATEWAY_MASTERPASS` |
| **Never in production** | `5432` (remove `ports: ['5432:5432']` from `docker-compose.yaml` for the `db` service) |

### Drizzle Gateway (self-hosted Studio)

Compose always starts the `studio` service (not `drizzle-kit studio`). Set a master password and deploy:

```sh
# in .env
DRIZZLE_GATEWAY_MASTERPASS="$(openssl rand -hex 32)"

docker compose up -d
```

Open `https://studio.eigenmesh.xyz`, unlock with `DRIZZLE_GATEWAY_MASTERPASS`. Connection `eigen` is seeded automatically on first boot. See [README](../../README.md#drizzle-gateway-studio-url).

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
3. Complete the welcome tour (credits + grounding).
4. Submit a test capture on `/capture`.

## Troubleshooting

| Symptom                              | Likely cause                                       | Fix                                                                                                      |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "Cross-site POST form submissions are forbidden" on voice capture / any POST | Deployed `ORIGIN` ≠ browser URL (e.g. left at the dev value `http://localhost:5173`), or proxy headers not forwarded | Set `ORIGIN` to the exact public URL incl. `https://`; keep `PROTOCOL_HEADER`/`HOST_HEADER` wired in `docker-compose.yaml` |
| Docker build fails on PostHog        | `POSTHOG_SOURCEMAPS_REQUIRED=1` without `phx_` key | Keep `POSTHOG_SOURCEMAPS_REQUIRED=0` (install.sh default) or set `POSTHOG_CLI_API_KEY` at **build** time |
| App cannot reach DB                  | Wrong host in `.env`                               | Use `@db:5432` in `DATABASE_URL` for Compose; compose also constructs URLs from `POSTGRES_*`             |
| EUrouter placeholder errors at start | Docker build placeholders in runtime env           | Set real `LLM_BASE_URL` and rule UUIDs (not `00000000-…`)                                                |
| Capture fails / LLM not configured   | Wallet empty or OpenRouter service key missing     | Settings → LLM; see [payments.md](../payments.md)                                                        |
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
