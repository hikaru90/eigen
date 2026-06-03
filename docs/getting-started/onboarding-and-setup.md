# Onboarding and setup

Eigen supports two deployment styles — **managed hosting** (Eigen operates the stack) and **self-hosted** (you run Docker Compose on your own infrastructure). The product UI and onboarding flow are the same in both cases; only who configures infrastructure and LLM billing differs.

This page covers:

1. [Managed onboarding](#managed-onboarding-for-end-users) — what a non-technical user sees after sign-up.
2. [Self-hosted operator setup](#self-hosted-operator-setup) — accounts to create, environment variables to set, and first-run steps before users can sign in.

For deployment philosophy (single codebase, no feature gating by plan), see [Deployment model](./docs/planning/07-deployment-ownership-and-licensing.md).

---

## Managed onboarding (for end users)

Use this path when Eigen operates your instance (managed hosting). You do **not** need to run Docker, configure servers, or obtain LLM API keys unless you explicitly switch to bring-your-own-key (BYOK) billing.

### 1. Create an account

From the marketing site, choose **Get early access — managed**. That opens sign-up with a managed-hosting label (`/signup?plan=managed`).

You can sign up with:

- **Email and password** (minimum 8 characters), or
- **Google / GitHub** — only if the operator has enabled social login on that deployment.

After sign-up you land on **Capture** (`/capture`).

> **Note:** The `?plan=managed` query parameter is informational only. It does not change product behavior or billing mode; it only shows which hosting option you selected on the marketing page.

### 2. Welcome tour (first visit)

On your first visit to Capture, a **Welcome to Eigen** overlay appears until you finish or skip it. You can reopen it later from **Settings → Onboarding → Restart onboarding**.

The tour has **five steps**:

| Step | Topic | What you learn |
|------|--------|----------------|
| 1 | **Capture** | Drop thoughts in raw form — type or use **Dictate** (browser speech-to-text). No filing, tagging, or structure required at capture time. |
| 2 | **Activity** | A transparent log of processing steps and usage-related detail so you can see what ran. |
| 3 | **Settings** | Theme, language, and transcription defaults. |
| 4 | **LLM provider** | Optional BYOK setup (EUrouter or OpenRouter). **Managed users can skip this step** — see below. |
| 5 | **Ready** | Click **Get started** to dismiss the tour. |

You can **Skip tour** at any time from the top of the overlay.

Behind the scenes, Eigen also seeds a default cognitive ontology for your account on first load. There is no separate ontology interview.

### 3. Billing: platform credits (default for managed)

Managed deployments bill LLM usage through an **Eigen wallet** (platform credits), not your personal gateway account.

Default billing mode is **Eigen platform credits** (`platform_credits`). Capture, chat, and embeddings draw from your wallet balance using the operator’s shared gateway credentials — you do not paste API keys during onboarding.

**Before your first capture succeeds**, add credit:

1. Open **Settings → LLM** (`/settings/llm`).
2. Stay on the **Credits** tab.
3. Choose an amount and complete checkout via **PayPal** (when the operator has configured PayPal on the deployment).

Each LLM call is logged in **Activity** with cost detail (transparent per-call billing).

### 4. Optional: bring your own key (BYOK)

If you prefer to bill your own gateway directly:

1. Open **Settings → LLM → BYOK**.
2. Configure **EUrouter** or **OpenRouter** (base URL, API key, and model or rule IDs as required by that provider).
3. On the **Billing method** section, switch to **Bring your own key (BYOK)** and save.

The onboarding tour’s step 4 is a shortcut to the same BYOK form; it is not required for managed users on platform credits.

### 5. Start capturing

Return to **Capture**, type or dictate a thought, and submit. Ingest runs automatically; progress appears in the capture UI and full detail in **Activity**.

---

## Self-hosted operator setup

Use this path when **you** deploy and operate Eigen on your own stack (Docker Compose). End users still go through the [managed onboarding tour](#2-welcome-tour-first-visit) above after they sign in; your job is to provision the stack, secrets, and optional payment/social integrations first.

See also [Overview & quick start](./README.md) for Docker Compose commands and Coolify notes.

### Accounts to create (operator)

Create only the accounts that match how you want billing and auth to work.

| Account | When you need it | What it is used for |
|---------|------------------|---------------------|
| **[EUrouter](https://eurouter.ai)** | Platform credits and/or EUrouter BYOK | Gateway for chat + embeddings via routing rules (`LLM_BASE_URL`, `SERVICE_API_KEY_EUROUTER`, `LLM_RULE_CHAT`, `LLM_RULE_EMBEDDING`). |
| **[OpenRouter](https://openrouter.ai)** | Platform credits, OpenRouter BYOK, and/or speech-to-text | Gateway for chat, embeddings, and dictation STT (`OPENROUTER_BASE_URL`, `SERVICE_API_KEY_OPENROUTER` or `OPENROUTER_API_KEY`, optional `LLM_MODEL_*`). |
| **[PayPal Developer](https://developer.paypal.com)** | Wallet top-ups (platform credits) | In-app credit purchases (`PAYPAL_API_BASE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`). Omit if all users will use BYOK only. |
| **Google Cloud OAuth client** | Optional social sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — callback `{ORIGIN}/api/auth/callback/google`. |
| **GitHub OAuth app** | Optional social sign-in | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — callback `{ORIGIN}/api/auth/callback/github`. |

You do **not** need separate accounts for Postgres, pgvector, or Apache AGE — those run inside the Compose stack.

### Environment variables (operator)

Copy [`.env.example`](./.env.example) to `.env` and set values before `docker compose up`. Grouped by purpose:

#### Required — app will not run safely without these

| Variable | Purpose | How to set |
|----------|---------|------------|
| `BETTER_AUTH_SECRET` | Session encryption | `openssl rand -base64 32` |
| `AGE_GRAPH_NAME` | Apache AGE graph name (must match Postgres init) | `eigen_graph` (default) |
| `ORIGIN` | Public URL users and OAuth callbacks use | e.g. `https://eigen.example.com` |
| `TENANT_MASTER_KEY` | Master key for per-tenant envelope encryption | Strong random secret (see [tenant encryption runbook](./docs/operations/tenant-envelope-encryption.md)) |
| `DATABASE_URL` | App connection string | Compose default: `postgres://eigen:eigen@db:5432/eigen` |
| `DATABASE_ADMIN_URL` | Migrations, RLS, pg_cron | Same superuser URL as above for self-hosted |

#### Required for LLM — at least one billing path must work

**Option A — Platform credits (Eigen wallet, default user billing mode)**

Users top up via PayPal; the app calls your service-account gateway keys.

| Variable | Purpose |
|----------|---------|
| `SERVICE_API_KEY_EUROUTER` | EUrouter service key (platform billing) |
| `LLM_BASE_URL` | EUrouter API origin (no trailing slash), e.g. `https://api.eurouter.ai/v1` |
| `LLM_RULE_CHAT` | EUrouter routing rule UUID for chat |
| `LLM_RULE_EMBEDDING` | EUrouter routing rule UUID for embeddings |
| `SERVICE_API_KEY_OPENROUTER` | OpenRouter service key (if using OpenRouter as platform provider) |
| `OPENROUTER_BASE_URL` | OpenRouter API origin, e.g. `https://openrouter.ai/api/v1` |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` (sandbox) or `https://api-m.paypal.com` (live) |
| `PAYPAL_CLIENT_ID` | PayPal REST app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal REST app secret |

**Option B — BYOK only (users supply keys in Settings → LLM → BYOK)**

You may still set env fallbacks used when a user has not saved keys in the database:

| Variable | Purpose |
|----------|---------|
| `LLM_BASE_URL` | EUrouter base URL |
| `LLM_API_KEY` | EUrouter API key fallback |
| `LLM_RULE_CHAT` / `LLM_RULE_EMBEDDING` | EUrouter rule UUIDs |
| `OPENROUTER_BASE_URL` | OpenRouter base URL |
| `OPENROUTER_API_KEY` | OpenRouter API key fallback |

Users on BYOK must configure credentials in the UI (or rely on these env fallbacks) and set billing mode to **Bring your own key** in Settings.

#### Recommended for production

| Variable | Purpose |
|----------|---------|
| `POSTGRES_PASSWORD` | Strong DB password (change from default `eigen`) |
| `EIGEN_APP_DB_PASSWORD` | Password for RLS app role `eigen_app` |
| `ADMIN_CONSOLIDATION_KEY` | Secures nightly consolidation webhook (`openssl rand -hex 32`) |
| `CONSOLIDATION_INTERNAL_URL` | URL Postgres/pg_cron uses to reach the app (Compose: `http://app:3000`) |

#### Optional

| Variable | Purpose |
|----------|---------|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push notifications (`npx web-push generate-vapid-keys`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap first admin on container start (see below) |
| `LLM_MIN_REQUEST_INTERVAL_MS` | Global LLM throttle (default 1000 ms) |
| `EMBEDDING_COMPRESS_INTENSITY` | Embedding payload compression (`lite` \| `full` \| `ultra`) |

### First-run deployment steps

1. **Clone and configure**
   ```sh
   git clone <repo-url> && cd eigen
   cp .env.example .env
   # Edit .env — set required variables above
   ```

2. **Start the stack**
   ```sh
   docker compose up -d --build
   ```

3. **Apply schema and RLS** (first deploy only; the production entrypoint runs migrations automatically on subsequent starts)
   ```sh
   npm install
   npm run db:push:force
   npm run db:rls
   ```

4. **Optional: bootstrap an admin user** — set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env` before starting the app container, or run:
   ```sh
   docker compose exec app node scripts/create-admin.mjs
   ```
   The script is idempotent (skips if the email already exists). Admin users still see the welcome tour until they complete or skip onboarding.

5. **Verify** — open `ORIGIN` in a browser, sign up or sign in as admin, complete the welcome tour, and confirm LLM billing (Credits or BYOK) before test captures.

### Self-hosted end-user sign-up

Users can open **Get early access — self-hosted** (`/signup?plan=self-hosted`). Like managed sign-up, the plan label is informational; behavior depends on how **you** configured env vars and PayPal/BYOK, not on the query parameter.

Direct them to:

- **Settings → LLM → Credits** if you enabled platform credits and PayPal.
- **Settings → LLM → BYOK** if they should use their own EUrouter or OpenRouter keys.

---

## Quick reference: who configures what

| Concern | Managed (end user) | Self-hosted (operator) | Self-hosted (end user) |
|---------|-------------------|------------------------|------------------------|
| Docker / Postgres / AGE | Eigen | You | — |
| `BETTER_AUTH_SECRET`, `TENANT_MASTER_KEY`, `ORIGIN` | Eigen | You | — |
| Service gateway keys (`SERVICE_API_KEY_*`) | Eigen | You | — |
| PayPal (wallet top-ups) | Eigen (if offered) | You (optional) | Pays via PayPal UI |
| Personal LLM keys | Only if switching to BYOK | — | BYOK tab in Settings |
| Welcome tour | Yes | — | Yes |
| Capture / Activity / Chat | Yes | — | Yes |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Capture fails with LLM not configured | Wallet empty (platform credits) or BYOK keys missing — check **Settings → LLM**. |
| PayPal button missing on Credits tab | Operator has not set `PAYPAL_*` env vars. |
| BYOK option disabled in billing method | No provider saved on **Settings → LLM → BYOK** yet. |
| OAuth sign-in fails | Callback URL must match `{ORIGIN}/api/auth/callback/<provider>`. |
| Encrypt/decrypt errors after deploy | `TENANT_MASTER_KEY` missing or changed without re-encryption — see [tenant encryption runbook](./docs/operations/tenant-envelope-encryption.md). |
