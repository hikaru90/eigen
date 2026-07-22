import { billingUserAsyncLocal, tenantUserAsyncLocal } from '$lib/server/billing/context'
import {
  appSql,
  createScopedDrizzle,
  appDbAsyncLocal,
  appReservedSqlAsyncLocal,
  activateTenantDbSession,
  deactivateTenantDbSession,
  type AppDatabase,
} from '$lib/server/db'

export type WithEvalDbOptions = {
  /** Platform credits / BYOK checks and wallet debits use this user (e.g. eval operator). */
  billingUserId?: string
}

/**
 * Run `fn` inside an RLS-aware DB context bound to `userId`.
 *
 * Mirrors what `src/hooks.server.ts` does for HTTP requests so eval scripts can
 * reuse the same retrieval/embedding/capture functions that rely on `getDb()`.
 *
 * Fails loud on errors (no fallback) per project guardrails.
 */
export async function withEvalDb<T>(
  userId: string,
  fn: (db: AppDatabase) => Promise<T>,
  options?: WithEvalDbOptions,
): Promise<T> {
  const reserved = await appSql.reserve()
  try {
    await activateTenantDbSession(reserved, userId)
    const scopedDb = createScopedDrizzle(reserved)
    const run = () => appDbAsyncLocal.run(scopedDb, () => fn(scopedDb))
    const withTenant = () =>
      tenantUserAsyncLocal.run(userId, () => appReservedSqlAsyncLocal.run(reserved, run))
    const billingUserId = options?.billingUserId?.trim()
    if (billingUserId) {
      return await billingUserAsyncLocal.run(billingUserId, withTenant)
    }
    return await withTenant()
  } finally {
    await deactivateTenantDbSession(reserved).catch(() => {})
    await reserved.release()
  }
}

/**
 * Top-level entry helper for eval scripts: ensures the postgres pool is closed
 * so the process exits even if a downstream import opened keep-alive timers.
 */
export async function runEval(main: () => Promise<void>): Promise<void> {
  let exitCode = 0
  try {
    await main()
  } catch (err) {
    exitCode = 1
    console.error('[eval] failed:', err instanceof Error ? (err.stack ?? err.message) : err)
  } finally {
    await appSql.end({ timeout: 5 })
    process.exit(exitCode)
  }
}

function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', ' UTC')
}

export function logEval(message: string): void {
  if (process.env.GRAPH_SCALE_QUIET === '1') return
  console.log(`[eval ${nowStamp()}] ${message}`)
}

let heartbeatProgressHint = ''

export function setHeartbeatProgressHint(hint: string): void {
  heartbeatProgressHint = hint
}

export function startEvalHeartbeat(label: string, intervalMs = 15000): () => void {
  const startedAt = Date.now()
  const timer = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000)
    const pct = heartbeatProgressHint ? ` · ${heartbeatProgressHint}` : ''
    logEval(`${label}: still running (${elapsedSec}s elapsed)${pct}`)
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
