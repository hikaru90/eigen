# Eigen

Eigen is a SvelteKit memory infrastructure app with Better Auth, Drizzle, pgvector, Apache AGE, and FalkorDB.
This repository is self-hostable: the default development setup runs Postgres inside this repo via Docker Compose.

## Prerequisites

- Node.js `^22.13.0`
- npm
- Docker (Docker Desktop or equivalent with `docker compose`)

## Quick Start (Self-Hosted Local DB)

```sh
npm install
cp .env.example .env
npm run db:up
npm run db:init
npm run dev
```

App URL: `http://localhost:5173`

Default local database URL:

`postgres://eigen:eigen@localhost:5432/eigen`

## Containerized App + DB (Self-Hosted Stack)

```sh
npm install
cp .env.example .env
npm run stack:up
npm run db:init
```

App URL (containerized): `http://localhost:3000`

## Database Lifecycle Commands

- `npm run db:up` - start local Postgres (container: `eigen-db`)
- `npm run db:down` - stop compose services
- `npm run db:reset` - stop services and delete DB volume (destructive)
- `npm run db:push` - apply Drizzle schema to DB
- `npm run db:push:force` - apply Drizzle schema without interactive prompt
- `npm run db:rls` - apply Row-Level Security policies
- `npm run db:init` - run `db:push:force` then `db:rls`
- `npm run app:up` - build and start app container (depends on DB health)
- `npm run stack:up` - build and start DB + app containers
- `npm run stack:down` - stop DB + app containers

## Extension Baseline

The local Postgres image enables:

- `pgvector` (`CREATE EXTENSION vector`)
- Apache AGE (`CREATE EXTENSION age`)

Bootstrap SQL lives in `docker/postgres/init/01-extensions.sql` and runs automatically on first DB initialization.
It creates AGE graph `eigen_graph` (kept separate from app schemas to avoid search-path collisions).

## FalkorDB Baseline

`compose.yaml` includes a FalkorDB service (`eigen-falkordb`) on port `6379` (optional Falkor browser UI on host port `3001` when you need it alongside the app on `3000`).

Open the Falkor UI at **http://localhost:3001** (see `compose.yaml`: host `3001` → container `3000`). The stack sets **`NEXTAUTH_URL=http://localhost:3001`** on the Falkor service so the browser login matches that URL; if you still see "Invalid credentials" after changing ports, clear site data for that origin or use a private window, then retry.

**FalkorDB Browser login** ([official login docs](https://docs.falkordb.com/browser/ui/login.html)): the documented URL example `falkor://Default:Default@localhost:6379` is for a **local server with no Redis password** (the `Default` strings are UI placeholders, not your `FALKOR_PASSWORD`). With **`REDIS_ARGS --requirepass`** ([Docker auth](https://docs.falkordb.com/operations/docker.html)), use **Manual configuration** (not the URL field): **Host** `localhost`, **Port** `6379`, **Username** leave empty or `default`, **Password** = your **`FALKOR_PASSWORD`**, **TLS** off. The URL tab can still show "Invalid credentials" even when the URL string is valid, because the app submits credentials from internal state that may not have flushed yet on the same click—manual fields avoid that.

Redis authentication is enabled via `REDIS_ARGS=--requirepass …`. Set `FALKOR_PASSWORD` in `.env` to match compose (default `eigen_falkor_dev` in `.env.example`) or override both when you rotate credentials. `FALKOR_USERNAME` is required as well (use `default` unless you configured a custom ACL user).

Capture submit/edit writes are mirrored into Falkor as `Thought` nodes, with **one Falkor graph per user**. Graph names are derived as:

- `user_<normalized_user_id>`
- example: `user_ot7zqmshwoi5ovlsrs5vjyhqzwchnpuk`

This isolates seeded/eval/test data from normal user data even when sharing one Falkor instance.

## Production Notes

- For production, set `DATABASE_URL` to your operator-managed Postgres endpoint if desired.
- If you want full self-hosting in production, deploy this repo's compose stack and point app runtime to the same Postgres service/network.
- Keep `BETTER_AUTH_SECRET` high entropy and unique per environment.

## Secret Hygiene

- Never commit real `.env` values.
- Rotate any previously exposed API keys or DB credentials.
- Use `.env.example` as the committed template only.

## License

Eigen is licensed under Apache-2.0. See `LICENSE`.

## Testing

- Run all unit tests: `npm run test:unit -- --run`
- Run coverage: `npm run test:coverage`
- Coverage report output: `coverage/index.html`

## Troubleshooting

- `connect timeout` to Postgres: verify `npm run db:up` and confirm with `docker compose ps`.
- Port collision on `5432`: stop conflicting local Postgres or remap host port in `compose.yaml`.
- Port collision on `3000`: remap app host port in `compose.yaml`.
- FalkorDB `NOAUTH` / `WRONGPASS` from the app: ensure `.env` includes `FALKOR_PASSWORD` matching compose (default `eigen_falkor_dev`; see `.env.example`). After changing the password, recreate the container or align `REDIS_ARGS` / app env.
- Extension verification:
  - `docker compose exec -T db psql -U eigen -d eigen -c "\dx"`
  - Confirm `vector` and `age` are installed.
