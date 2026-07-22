/**
 * Global nightly consolidation run ledger (idempotency for pg_cron).
 * Uses DATABASE_ADMIN_URL — table has no RLS.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { consolidationRun, type ConsolidationRunStatus } from '$lib/server/db/schema'
import { formatConsolidationJobErrors, type ConsolidationRunResult } from './runner'

function summarizeGlobalRunFailures(results: ConsolidationRunResult[]): string | null {
  const lines: string[] = []
  for (const result of results) {
    for (const line of formatConsolidationJobErrors(result.jobs)) {
      lines.push(`${result.userId}: ${line}`)
    }
  }
  return lines.length > 0 ? lines.join('; ') : null
}

function getAdminDatabaseUrl(): string {
  const url = process.env.DATABASE_ADMIN_URL?.trim()
  if (!url) {
    throw new Error('DATABASE_ADMIN_URL is required for consolidation run ledger')
  }
  return url
}

function getCronTimezone(): string {
  const tz = process.env.CONSOLIDATION_CRON_TZ?.trim()
  if (!tz) return 'UTC'
  return tz
}

/** Calendar date string YYYY-MM-DD in the consolidation cron timezone. */
export function consolidationRunNightForDate(when: Date = new Date()): string {
  const tz = getCronTimezone()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(when)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  if (!y || !m || !d) {
    throw new Error(`Failed to format run night in timezone ${tz}`)
  }
  return `${y}-${m}-${d}`
}

let adminSql: postgres.Sql | null = null

function getAdminDb() {
  if (!adminSql) {
    adminSql = postgres(getAdminDatabaseUrl(), { max: 2 })
  }
  return drizzle(adminSql, { schema: { consolidationRun } })
}

export type AcquireNightlyRunResult =
  | { acquired: true; runId: string; runNight: string }
  | { acquired: false; runNight: string; reason: 'already_running' | 'already_completed' }

/**
 * Try to start a global nightly consolidation run for tonight (cron TZ).
 */
export async function tryAcquireGlobalNightlyRun(): Promise<AcquireNightlyRunResult> {
  const runNight = consolidationRunNightForDate()
  const db = getAdminDb()

  const existing = await db
    .select({ id: consolidationRun.id, status: consolidationRun.status })
    .from(consolidationRun)
    .where(
      and(
        eq(consolidationRun.runNight, runNight),
        inArray(consolidationRun.status, ['running', 'completed']),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    return {
      acquired: false,
      runNight,
      reason: existing[0].status === 'running' ? 'already_running' : 'already_completed',
    }
  }

  try {
    const [row] = await db
      .insert(consolidationRun)
      .values({ runNight, status: 'running' })
      .returning({ id: consolidationRun.id })

    if (!row) {
      throw new Error('Failed to insert consolidation_run row')
    }
    return { acquired: true, runId: row.id, runNight }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('consolidation_run_nightly_uidx') || message.includes('duplicate key')) {
      const again = await db
        .select({ status: consolidationRun.status })
        .from(consolidationRun)
        .where(eq(consolidationRun.runNight, runNight))
        .limit(1)
      const status = again[0]?.status
      return {
        acquired: false,
        runNight,
        reason: status === 'running' ? 'already_running' : 'already_completed',
      }
    }
    throw err
  }
}

export async function completeGlobalNightlyRun(
  runId: string,
  results: ConsolidationRunResult[],
): Promise<void> {
  const db = getAdminDb()
  const failureSummary = summarizeGlobalRunFailures(results)
  await db
    .update(consolidationRun)
    .set({
      status: (failureSummary ? 'failed' : 'completed') satisfies ConsolidationRunStatus,
      jobs: { results } as Record<string, unknown>,
      errorMessage: failureSummary ?? null,
      finishedAt: new Date(),
    })
    .where(eq(consolidationRun.id, runId))
}

export async function failGlobalNightlyRun(runId: string, errorMessage: string): Promise<void> {
  const db = getAdminDb()
  await db
    .update(consolidationRun)
    .set({
      status: 'failed' satisfies ConsolidationRunStatus,
      errorMessage,
      finishedAt: new Date(),
    })
    .where(eq(consolidationRun.id, runId))
}
