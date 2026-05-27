# Domain: Auth and tenancy

**Canonical rule:** Session identity comes from **Better Auth** ([`src/lib/server/auth.ts`](../../src/lib/server/auth.ts)). Application data access uses a **scoped Drizzle client** on the reserved Postgres connection with `SET ROLE eigen_app` (or `APP_DB_ROLE`) plus `set_config('app.current_user_id', …)` in [`src/hooks.server.ts`](../../src/hooks.server.ts). Row Level Security policies are defined in SQL scripts (e.g. [`src/lib/server/db/enable_rls.sql`](../../src/lib/server/db/enable_rls.sql)).

**Single `DATABASE_URL`:** The pool may connect as the DB owner/superuser (migrations, Drizzle Studio). Each app request calls `SET ROLE` to the non-superuser `eigen_app` role so RLS applies without a second connection URL. Run `npm run db:app-role` once to create the role and grant it to your DB user (includes Apache AGE label sequences in `AGE_GRAPH_NAME`, e.g. `Thought_id_seq`).

## CompetingSystems

- **Auth DB vs app DB:** Better Auth uses [`src/lib/server/db/auth-db.ts`](../../src/lib/server/db/auth-db.ts) (adapter). Brain / thoughts use the main app pool ([`src/lib/server/db/index.ts`](../../src/lib/server/db/index.ts), [`src/lib/server/db/context.ts`](../../src/lib/server/db/context.ts)). Both may point at the same `DATABASE_URL` in deployment but are **separate Drizzle instances** — not competing logic, but two pools to be aware of when debugging connections.

## Key files (scan-first)

### [`src/hooks.server.ts`](../../src/hooks.server.ts)

- **Purpose:** `sequence`: Paraglide → Better Auth session → `Cross-Origin-Opener-Policy: same-origin-allow-popups` (no global COEP; third-party checkout SDKs require it).
- **Owns:** Calling `auth.api.getSession`; populating `event.locals.user` / `session`; per-request `appSql.reserve()`, `SET ROLE eigen_app`, `set_config('app.current_user_id', uid)`, `appDbAsyncLocal.run(scopedDb, …)`, `RESET ROLE`, release.
- **DependsOn:** `auth`, `appSql`, `createScopedDrizzle`, `appDbAsyncLocal`.
- **PublicSymbols:** `handle` export.
- **FailureMode:** Missing session leaves `userId` empty string in config (anonymous); protected routes must redirect or error in loaders.

### [`src/lib/server/auth.ts`](../../src/lib/server/auth.ts)

- **Purpose:** `betterAuth` instance: email/password, optional OAuth (`google`, `github` via [`src/lib/server/auth-social.ts`](../../src/lib/server/auth-social.ts) when env credentials are set), Drizzle adapter on `authDb`, `normalizeAuthOrigin(env.ORIGIN)`, cookies plugin.
- **Owns:** Auth configuration surface; throws if `ORIGIN` invalid or missing when needed. OAuth callbacks: `{ORIGIN}/api/auth/callback/{provider}` (handled by `svelteKitHandler`).
- **PublicSymbols:** `auth`, `normalizeAuthOrigin`.

### [`src/routes/login/+page.server.ts`](../../src/routes/login/+page.server.ts), [`src/routes/register/+page.server.ts`](../../src/routes/register/+page.server.ts), [`src/routes/api/session/sign-out/+server.ts`](../../src/routes/api/session/sign-out/+server.ts)

- **Purpose:** Auth UX (email + optional social via [`src/lib/auth-client.ts`](../../src/lib/auth-client.ts)) and sign-out endpoint.

### [`src/lib/server/db/enable_rls.sql`](../../src/lib/server/db/enable_rls.sql)

- **Purpose:** Canonical SQL for tenant isolation policies; applied via `npm run db:rls` / `scripts/apply-rls.mjs` (see README).

## Tenancy invariant

- MVP tenancy key is **`user_id`** on app tables; RLS and application queries must agree. Any new table storing user-owned rows should be added to RLS with the same pattern as existing policies.
- **`user_api_key`** and **`llm_provider_config`** store secrets; they are covered by the same RLS policies. MCP Bearer lookup uses `resolve_user_api_key()` (SECURITY DEFINER) before `app.current_user_id` is set.
