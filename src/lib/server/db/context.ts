import type * as schema from './schema'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type postgres from 'postgres'
import { AsyncLocalStorage } from 'node:async_hooks'

export type AppDatabase = PostgresJsDatabase<typeof schema>

export const appDbAsyncLocal = new AsyncLocalStorage<AppDatabase>()

/** Reserved `postgres` handle for the active scoped DB context (eval / request). */
export const appReservedSqlAsyncLocal = new AsyncLocalStorage<postgres.Sql>()

export function getDb(): AppDatabase {
  const db = appDbAsyncLocal.getStore()
  if (!db) {
    throw new Error('getDb() was called outside an active request (missing app DB context)')
  }
  return db
}
