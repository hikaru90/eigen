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

`compose.yaml` includes a FalkorDB service (`eigen-falkordb`) on port `6379`.

Capture submit/edit writes are mirrored into Falkor graph `eigen_memory` as `Thought` nodes.

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

## Troubleshooting

- `connect timeout` to Postgres: verify `npm run db:up` and confirm with `docker compose ps`.
- Port collision on `5432`: stop conflicting local Postgres or remap host port in `compose.yaml`.
- Port collision on `3000`: remap app host port in `compose.yaml`.
- Extension verification:
  - `docker compose exec -T db psql -U eigen -d eigen -c "\dx"`
  - Confirm `vector` and `age` are installed.
