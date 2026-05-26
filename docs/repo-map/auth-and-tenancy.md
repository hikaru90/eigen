# Domain: Auth and tenancy

**Canonical rule:** Session identity comes from **Better Auth** ([`src/lib/server/auth.ts`](../../src/lib/server/auth.ts)). Application data access uses a **scoped Drizzle client** on the reserved Postgres connection with `set_config('app.current_user_id', …)` in [`src/hooks.server.ts`](../../src/hooks.server.ts). Row Level Security policies are defined in SQL scripts (e.g. [`src/lib/server/db/enable_rls.sql`](../../src/lib/server/db/enable_rls.sql)).

## CompetingSystems

- **Auth DB vs app DB:** Better Auth uses [`src/lib/server/db/auth-db.ts`](../../src/lib/server/db/auth-db.ts) (adapter). Brain / thoughts use the main app pool ([`src/lib/server/db/index.ts`](../../src/lib/server/db/index.ts), [`src/lib/server/db/context.ts`](../../src/lib/server/db/context.ts)). Both may point at the same `DATABASE_URL` in deployment but are **separate Drizzle instances** — not competing logic, but two pools to be aware of when debugging connections.

## Key files (scan-first)

### [`src/hooks.server.ts`](../../src/hooks.server.ts)

- **Purpose:** `sequence`: Paraglide → Better Auth session → `Cross-Origin-Opener-Policy: same-origin-allow-popups` (no global COEP; third-party checkout SDKs require it).
- **Owns:** Calling `auth.api.getSession`; populating `event.locals.user` / `session`; per-request `appSql.reserve()`, `set_config('app.current_user_id', uid)`, `appDbAsyncLocal.run(scopedDb, …)`, release + clear config.
- **DependsOn:** `auth`, `appSql`, `createScopedDrizzle`, `appDbAsyncLocal`.
- **PublicSymbols:** `handle` export.
- **FailureMode:** Missing session leaves `userId` empty string in config (anonymous); protected routes must redirect or error in loaders.

### [`src/lib/server/auth.ts`](../../src/lib/server/auth.ts)

- **Purpose:** `betterAuth` instance: email/password, Drizzle adapter on `authDb`, `normalizeAuthOrigin(env.ORIGIN)`, cookies plugin.
- **Owns:** Auth configuration surface; throws if `ORIGIN` invalid or missing when needed.
- **PublicSymbols:** `auth`, `normalizeAuthOrigin`.

### [`src/routes/login/+page.server.ts`](../../src/routes/login/+page.server.ts), [`src/routes/register/+page.server.ts`](../../src/routes/register/+page.server.ts), [`src/routes/api/session/sign-out/+server.ts`](../../src/routes/api/session/sign-out/+server.ts)

- **Purpose:** Auth UX and sign-out endpoint.

### [`src/lib/server/db/enable_rls.sql`](../../src/lib/server/db/enable_rls.sql)

- **Purpose:** Canonical SQL for tenant isolation policies; applied via `npm run db:rls` / `scripts/apply-rls.mjs` (see README).

## Tenancy invariant

- MVP tenancy key is **`user_id`** on app tables; RLS and application queries must agree. Any new table storing user-owned rows should be added to RLS with the same pattern as existing policies.
