# Eigen

Eigen is a self-hostable SvelteKit memory infrastructure app with **Better Auth**, **Drizzle ORM**, **pgvector**, **Apache AGE**, and **FalkorDB**.

This repository is a **fully self-contained Docker Compose stack** — no external services, no third-party databases, no cloud dependencies. Everything runs in containers.

## Architecture

| Service | Container | Role |
|---------|-----------|------|
| `app` | `eigen-app` | SvelteKit app with `@sveltejs/adapter-node` on port 3000 |
| `db` | `eigen-db` | PostgreSQL 16 with pgvector + Apache AGE extensions on port 5432 |
| `falkordb` | `eigen-falkordb` | FalkorDB graph database on port 6379 |

All three are defined in [`compose.yaml`](./compose.yaml) and build from source in this repo.

## Prerequisites

- Docker with `docker compose` plugin (Docker Desktop, OrbStack, or a Linux host)
- Git

That's it. No Node.js, no npm, no manual database setup needed at deployment time.

## Quick Start (Production Stack)

```sh
git clone <your-repo-url> && cd eigen
cp .env.example .env
# Edit .env — at minimum set BETTER_AUTH_SECRET and ENCRYPTION_KEY (see below)
docker compose up -d --build
```

The stack builds and starts all three containers. On **first deploy** you need to initialize the database schema:

```sh
# Install dependencies locally to run migration scripts
npm install

# Apply Drizzle schema and Row-Level Security
npm run db:push:force
npm run db:rls
```

The app is now available at `http://<your-host>:3000`.

> **Pro tip:** for fully automated first-run setup, add an init container or override the app entrypoint to run `node node_modules/drizzle-kit/bin.cjs push --force && node scripts/apply-rls.mjs` before starting the app server. See [Production Hardening](#production-hardening) below.

## Required Environment Variables

### Non-Negotiable (app crashes without these)

| Variable | Purpose | How to generate |
|----------|---------|-----------------|
| `BETTER_AUTH_SECRET` | Session encryption | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | FalkorDB browser session encryption | `openssl rand -hex 32` (exactly 64 hex chars) |
| `LLM_BASE_URL` | LLM gateway origin | Your gateway endpoint (e.g. OpenRouter, OpenAI, or a local one) |
| `LLM_API_KEY` | LLM gateway API key | From your LLM provider |
| `LLM_RULE_CHAT` | Chat model routing rule UUID | Your rule ID from the gateway |
| `LLM_RULE_EMBEDDING` | Embedding model routing rule UUID | Your rule ID from the gateway |

### Required with Defaults

| Variable | Default | Purpose |
|----------|---------|---------|
| `FALKOR_PASSWORD` | `eigen_falkor_dev` | Redis/FalkorDB auth; change in production |
| `ORIGIN` | `http://localhost:3000` | Must match the public URL users/browsers will use |

If you change `FALKOR_PASSWORD`, update it in **both** `.env` and the `FALKOR_PASSWORD` / `REDIS_ARGS` values in `compose.yaml`.

Set these in your Coolify service dashboard or in an `.env` file at the project root. The compose stack passes `DATABASE_URL`, `FALKOR_*`, `ORIGIN`, `HOST`, and `PORT` to the app container automatically — you only need to supply the variables above.

## Deploying to Coolify

1. **Connect the repository** in Coolify.
2. **Select "Docker Compose" as the Build Pack.** Coolify detects `compose.yaml` automatically.
3. **Add environment variables** in the Coolify dashboard (the ones from [Required Environment Variables](#required-environment-variables) above). Coolify injects these into the compose context.
4. **Deploy.** Coolify builds and starts all three containers.
5. **First-run migration** — after the stack is green, either:
   - Use Coolify's **Execute Command** feature on the `eigen-app` container to run:
     ```sh
     npx drizzle-kit push --force && node scripts/apply-rls.mjs
     ```
   - Or deploy once, run the migration commands locally against the exposed `db` port, and redeploy.

### Why Docker Compose and not the Dockerfile build pack?

The app requires PostgreSQL with pgvector + AGE and FalkorDB — those are separate services in `compose.yaml`. The standalone `Dockerfile` only builds the app image. **Docker Compose is the correct build pack for this project.**

### Port Mapping

By default `compose.yaml` maps:
- `3000:3000` — app
- `5432:5432` — Postgres
- `6379:6379` — FalkorDB
- `3001:3000` — FalkorDB browser UI (optional)

Change these in `compose.yaml` if they conflict with existing services on your host.

## First-Run Setup

The compose stack does **not** auto-apply database migrations or RLS policies on startup. After the first `docker compose up`, connect and run:

```sh
# From a machine with node/npm and network access to the DB:
DATABASE_URL="postgres://eigen:eigen@<your-host>:5432/eigen" npx drizzle-kit push --force
DATABASE_URL="postgres://eigen:eigen@<your-host>:5432/eigen" node scripts/apply-rls.mjs
```

Or exec from inside the app container:

```sh
docker compose exec app npx drizzle-kit push --force
docker compose exec app node scripts/apply-rls.mjs
```

## Production Hardening

Before going live:

1. **Change all default secrets:** `FALKOR_PASSWORD`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`
2. **Set `ORIGIN`** to your actual domain (Coolify sets this automatically)
3. **Restrict Postgres port** — remove `ports: ['5432:5432']` from `compose.yaml` so the database is only reachable on the internal Docker network
4. **Restrict FalkorDB port** — same for `6379`
5. **Use a real LLM gateway** — the app requires an OpenAI-compatible `/api/v1/chat/completions` and `/api/v1/embeddings` endpoint
6. **Add a healthcheck to the app service** in `compose.yaml`:

```yaml
app:
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok?0:1))"]
    interval: 30s
    retries: 3
```

7. **Lock Node.js version** — the Dockerfile uses `node:22-bookworm-slim`. Pin a specific patch if needed.

## Development (Local, Non-Containerized)

```sh
npm install
cp .env.example .env
npm run db:up      # start Postgres + FalkorDB containers only
npm run dev        # run the SvelteKit dev server on :5173
```

## Database Lifecycle Commands

| Command | What it does |
|---------|-------------|
| `npm run db:up` | Start `db` and `falkordb` containers only |
| `npm run db:down` | Stop all compose services |
| `npm run db:reset` | Stop services and delete DB volume (destructive) |
| `npm run db:push` | Apply Drizzle schema (interactive) |
| `npm run db:push:force` | Apply Drizzle schema (non-interactive) |
| `npm run db:rls` | Apply Row-Level Security policies |
| `npm run db:init` | `db:push:force` + `db:rls` |
| `npm run stack:up` | Build and start all containers (app + db + falkordb) |
| `npm run stack:down` | Stop all containers |

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
