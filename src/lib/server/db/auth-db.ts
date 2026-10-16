import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as authSchema from './auth.schema'
import { getRuntimeDatabaseUrl } from './runtime-url'

let authSqlInstance: postgres.Sql | undefined
let authDbInstance: PostgresJsDatabase<typeof authSchema> | undefined

function getAuthSql(): postgres.Sql {
  authSqlInstance ??= postgres(getRuntimeDatabaseUrl(), { max: 5 })
  return authSqlInstance
}

function getAuthDb(): PostgresJsDatabase<typeof authSchema> {
  // Build drizzle around the REAL pool lazily: passing a proxy would trip
  // drizzle's `isConfig` inspection at construction time and force the env read.
  authDbInstance ??= drizzle(getAuthSql(), { schema: authSchema })
  return authDbInstance
}

/**
 * Dedicated pool for Better Auth so it never shares connections with RLS-scoped app queries.
 * Lazy proxies (see `appSql` in `./index`): importing this module must not read env or throw;
 * pool and drizzle instance are created on first actual use.
 */
export const authSql: postgres.Sql = new Proxy({} as postgres.Sql, {
  get(_target, prop) {
    const real = getAuthSql() as postgres.Sql & Record<string | symbol, unknown>
    const value = real[prop]
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value
  },
  has(_target, prop) {
    return prop in getAuthSql()
  },
})

export const authDb: PostgresJsDatabase<typeof authSchema> = new Proxy(
  {} as PostgresJsDatabase<typeof authSchema>,
  {
    get(_target, prop) {
      const real = getAuthDb() as PostgresJsDatabase<typeof authSchema> &
        Record<string | symbol, unknown>
      const value = real[prop]
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value
    },
    has(_target, prop) {
      return prop in getAuthDb()
    },
  },
)

export async function closeAuthDbPool(): Promise<void> {
  await authSql.end({ timeout: 1 })
}
