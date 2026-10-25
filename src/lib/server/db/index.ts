import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { tenantUserAsyncLocal } from '$lib/server/billing/context'
import { appDbAsyncLocal, appReservedSqlAsyncLocal, type AppDatabase } from './context'
import { poolAcquireTimeoutMs, reserveWithTimeout } from './pool-acquire'
import { getRuntimeDatabaseUrl } from './runtime-url'
import * as schema from './schema'
import { activateTenantDbSession, deactivateTenantDbSession } from './tenant-session'

export { getDb, appDbAsyncLocal, appReservedSqlAsyncLocal } from './context'
export type { AppDatabase } from './context'
export { activateTenantDbSession, deactivateTenantDbSession, appDbRole } from './tenant-session'
export { DbPoolAcquireTimeoutError } from './pool-acquire'

/**
 * Run `fn` with RLS scoped to `userId` (eval metadata tables, etc.).
 */
export async function withDbUser<T>(
  userId: string,
  fn: (db: AppDatabase) => Promise<T>,
): Promise<T> {
  const reserved = await appSql.reserve()
  try {
    await activateTenantDbSession(reserved, userId)
    const scopedDb = createScopedDrizzle(reserved)
    const run = () => appDbAsyncLocal.run(scopedDb, () => fn(scopedDb))
    const withTenant = () =>
      tenantUserAsyncLocal.run(userId, () => appReservedSqlAsyncLocal.run(reserved, run))
    return await withTenant()
  } finally {
    await deactivateTenantDbSession(reserved).catch(() => {})
    await reserved.release()
  }
}

/** Held billing scope: the wallet connection and the user whose RLS session it carries. */
const billingScopeAsyncLocal = new AsyncLocalStorage<{ userId: string; db: AppDatabase }>()

/**
 * Run wallet work (`fn`) with RLS scoped to `userId` on a connection from the dedicated
 * **billing pool**, never from the app pool.
 *
 * Billing is reached from inside scopes that already hold an app-pool connection (a request, an
 * eval tenant, an enrich drain) and from many LLM calls in parallel. It needs its own
 * connection because wallet debits are transactions (`db.transaction` on the held app connection
 * would interleave with the scope's other queries) and because the billing user is not always the
 * tenant (eval harness: the operator wallet pays). Taking that connection from the app pool
 * deadlocks it; taking it from this leaf pool cannot (see the pool rules above `appSql`).
 *
 * Scopes opened inside `fn` for the same user reuse the held connection; a different user fails
 * loud, since it would be a second leaf connection held at once.
 */
export async function withBillingDbUser<T>(
  userId: string,
  fn: (db: AppDatabase) => Promise<T>,
): Promise<T> {
  const held = billingScopeAsyncLocal.getStore()
  if (held) {
    if (held.userId !== userId) {
      throw new Error(
        `withBillingDbUser(${userId}) was called inside the billing scope of ${held.userId}: ` +
          `billing scopes are leaves and must not nest across users`,
      )
    }
    return fn(held.db)
  }

  const reserved = await reserveWithTimeout(() => getBillingSql().reserve(), {
    poolName: 'billing',
    max: billingPoolMax(),
    timeoutMs: poolAcquireTimeoutMs(),
  })
  try {
    await activateTenantDbSession(reserved, userId)
    const scopedDb = createScopedDrizzle(reserved)
    // getDb() inside `fn` (e.g. creditFromPayment) must resolve to this connection.
    const run = () =>
      appDbAsyncLocal.run(scopedDb, () =>
        billingScopeAsyncLocal.run({ userId, db: scopedDb }, () => fn(scopedDb)),
      )
    return await tenantUserAsyncLocal.run(userId, () => appReservedSqlAsyncLocal.run(reserved, run))
  } finally {
    await deactivateTenantDbSession(reserved).catch(() => {})
    await reserved.release()
  }
}

function envPoolMax(name: string, fallback: number): number {
  const raw = (typeof process !== 'undefined' ? process.env[name] : undefined) ?? ''
  if (!raw.trim()) return fallback
  const parsed = Number(raw.trim())
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`)
  }
  return parsed
}

function poolMax(): number {
  return envPoolMax('DB_POOL_MAX', 10)
}

/** Billing leaf pool: short wallet transactions only, so it needs far fewer connections. */
function billingPoolMax(): number {
  return envPoolMax('DB_BILLING_POOL_MAX', 5)
}

/**
 * App-facing Postgres pool. Use `getDb()` inside request handlers (RLS session var is set in hooks).
 *
 * Pool connects with DATABASE_URL (often the DB owner / superuser for migrations and Studio).
 * Each reserved connection calls SET ROLE to the non-superuser APP_DB_ROLE (default eigen_app)
 * before set_config('app.current_user_id', …) so row-level security applies even when the pool
 * user is a superuser.
 *
 * Each request calls `appSql.reserve()` in hooks.server to obtain a dedicated connection for the
 * lifetime of that request. `attachReservedBeginIfMissing` patches a `begin()` method onto every
 * reserved handle so that Drizzle `db.transaction()` works correctly (it calls `client.begin()`
 * internally). This approach is safe with any `max` value — reserved connections are exclusively
 * held and never shared between concurrent requests.
 *
 * Pool size: controlled by `DB_POOL_MAX` env var, defaulting to 10. A capture pipeline holds its
 * connection for the full request duration (including LLM calls), so you need at least as many
 * connections as you expect concurrent in-flight captures plus background requests.
 *
 * POOL RULES (a violation deadlocks the process, silently, under load):
 *  1. A scope that holds a connection must NEVER wait for another connection from the SAME pool.
 *     With max=M, N scopes that each hold one connection and then nest one more hang forever
 *     once N >= M (every connection is held by a scope waiting for a connection); a scope that
 *     nests twice (hold, hold, wait) already hangs at 2N+1 > M. Reuse the held connection
 *     (`getDb()`), or take the connection from a pool that is strictly later in this order:
 *     app pool -> billing pool (leaf).
 *  2. The billing pool is a leaf: a scope holding a billing connection acquires nothing else
 *     (`withBillingDbUser`), so waiting on it always ends. All wallet work goes through it.
 *  3. Every `reserve()` waits at most `DB_POOL_ACQUIRE_TIMEOUT_MS` (default 60s, see
 *     `pool-acquire.ts`) and then throws `DbPoolAcquireTimeoutError`; postgres.js itself has no
 *     acquisition timeout. Direct queries on the pool (the tagged-template call without
 *     `reserve()`) are NOT bounded - do not run them while holding a connection.
 */
let appSqlInstance: postgres.Sql | undefined
let billingSqlInstance: postgres.Sql | undefined

function getAppSql(): postgres.Sql {
  appSqlInstance ??= (() => {
    const max = poolMax()
    return postgres(getRuntimeDatabaseUrl(), { max, idle_timeout: 30 })
  })()
  return appSqlInstance
}

function getBillingSql(): postgres.Sql {
  billingSqlInstance ??= (() => {
    const max = billingPoolMax()
    return postgres(getRuntimeDatabaseUrl(), { max, idle_timeout: 30 })
  })()
  return billingSqlInstance
}

/**
 * Lazy proxy over the real pool: importing this module must not read env or
 * throw (CI runs env-less); the pool (and its `DATABASE_URL` requirement) is
 * only materialized when a connection is actually requested. Every access in
 * this codebase is a property read (`reserve()`, `end()`, `options`), which the
 * proxy forwards to the lazily-created pool. `reserve` is bounded (pool rule 3)
 * and `end` also closes the billing pool.
 */
export const appSql: postgres.Sql = new Proxy({} as postgres.Sql, {
  get(_target, prop) {
    const real = getAppSql() as postgres.Sql & Record<string | symbol, unknown>
    if (prop === 'reserve') {
      return () =>
        reserveWithTimeout(() => real.reserve(), {
          poolName: 'app',
          max: poolMax(),
          timeoutMs: poolAcquireTimeoutMs(),
        })
    }
    if (prop === 'end') {
      return async (endOptions?: { timeout?: number }) => {
        await Promise.all([real.end(endOptions), billingSqlInstance?.end(endOptions)])
      }
    }
    const value = real[prop]
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value
  },
  has(_target, prop) {
    return prop in getAppSql()
  },
})

export async function closeAppDbPool(): Promise<void> {
  await appSql.end({ timeout: 1 })
}

type ReservedSql = postgres.Sql

/**
 * `postgres.reserve()` returns an inner `Sql` handle without `begin()` (unlike the pool root).
 * Drizzle's postgres-js session calls `client.begin()` for `db.transaction()`, so we attach a
 * `begin` that issues `BEGIN` / `COMMIT` / `ROLLBACK` on this reserved connection, plus
 * `savepoint` for nested Drizzle transactions.
 */
function attachReservedBeginIfMissing(reserved: ReservedSql): void {
  const extended = reserved as ReservedSql & {
    begin?: unknown
    savepoint?: unknown
  }
  if (typeof extended.begin === 'function') return

  extended.begin = (async (
    optionsOrFn?: string | ((sql: ReservedSql) => unknown | Promise<unknown>),
    maybeFn?: (sql: ReservedSql) => unknown | Promise<unknown>,
  ): Promise<unknown> => {
    let options = ''
    let fn: (sql: ReservedSql) => unknown | Promise<unknown>
    if (typeof optionsOrFn === 'function') {
      fn = optionsOrFn
    } else {
      options = optionsOrFn ?? ''
      if (typeof maybeFn !== 'function') {
        throw new TypeError('begin(options, fn) requires a callback')
      }
      fn = maybeFn
    }

    const beginSql =
      options.trim().length === 0 ? 'begin' : `begin ${options.replace(/[^a-z ]/gi, '')}`

    await reserved.unsafe(beginSql)

    let savepoints = 0

    const savepoint = async (
      nameOrFn: string | ((sql: ReservedSql) => unknown | Promise<unknown>),
      maybeSpFn?: (sql: ReservedSql) => unknown | Promise<unknown>,
    ): Promise<unknown> => {
      let spFn: (sql: ReservedSql) => unknown | Promise<unknown>
      let name: string | undefined
      if (typeof maybeSpFn === 'function') {
        name = String(nameOrFn)
        spFn = maybeSpFn
      } else if (typeof nameOrFn === 'function') {
        spFn = nameOrFn
        name = undefined
      } else {
        throw new TypeError('savepoint requires a callback')
      }

      const sp = 's' + savepoints++ + (name ? '_' + name : '')
      await reserved`savepoint ${reserved(sp)}`
      try {
        const out = await Promise.resolve(spFn(reserved))
        await reserved`release savepoint ${reserved(sp)}`
        return out
      } catch (err) {
        await reserved`rollback to savepoint ${reserved(sp)}`
        throw err
      }
    }

    extended.savepoint = savepoint

    try {
      const result = await Promise.resolve(fn(reserved))
      await reserved.unsafe('commit')
      return result
    } catch (err) {
      await reserved.unsafe('rollback')
      throw err
    } finally {
      delete extended.savepoint
    }
  }) as unknown as NonNullable<ReservedSql['begin']>
}

/**
 * `postgres.js` connections from `reserve()` are `Sql` handles without `options`.
 * Drizzle's postgres-js driver expects `client.options` (see drizzle `construct`), so we attach the pool's options.
 */
export function createScopedDrizzle(reserved: postgres.Sql): AppDatabase {
  Object.assign(reserved as postgres.Sql & { options: (typeof appSql)['options'] }, {
    options: appSql.options,
  })
  attachReservedBeginIfMissing(reserved)
  return drizzle(reserved, { schema })
}
