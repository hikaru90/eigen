import { randomUUID } from 'node:crypto'
import { billingUserAsyncLocal, tenantUserAsyncLocal } from '$lib/server/billing/context'
import { runWithTrace } from '$lib/server/activity/trace-context'
import {
  aggregateActivityCostByGroupId,
  aggregateUserActivityCost,
  type ActivityCostAggregate,
} from '$lib/server/activity/trace-cost'
import { captureThought } from '$lib/server/capture/service'
import { insertEvalUserRow } from '$lib/eval/store'
import { ensureHarnessCredentialAccount } from '$lib/server/e2e/harness-auth'
import type { SpendProbeThoughtRow } from '$lib/e2e/graph-scale-spend-trend'
import {
  appDbAsyncLocal,
  appReservedSqlAsyncLocal,
  appSql,
  activateTenantDbSession,
  createScopedDrizzle,
  deactivateTenantDbSession,
  type AppDatabase,
} from '$lib/server/db'

export type { SpendProbeThoughtRow, SpendTrend } from '$lib/e2e/graph-scale-spend-trend'
export { computeSpendTrend } from '$lib/e2e/graph-scale-spend-trend'

export type SpendProbeUser = {
  userId: string
  email: string
}

async function withHarnessTenantDb<T>(
  userId: string,
  fn: (db: AppDatabase) => Promise<T>,
  options?: { billingUserId?: string },
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

/** Fresh harness user with funded wallet and password login for Playwright. */
export async function createSpendProbeUser(): Promise<SpendProbeUser> {
  const userId = `graph-scale-spend-${randomUUID()}`
  await insertEvalUserRow(userId, 'Graph scale spend probe')
  const credentials = await ensureHarnessCredentialAccount(userId)
  return { userId, email: credentials.email }
}

export type SpendProbeSnapshot = ActivityCostAggregate

/** Cumulative paid-gateway spend for a harness probe user. */
export async function loadSpendProbeSnapshot(userId: string): Promise<SpendProbeSnapshot> {
  const trimmed = userId.trim()
  if (!trimmed) {
    throw new Error('loadSpendProbeSnapshot: userId is required')
  }
  return withHarnessTenantDb(trimmed, (db) => aggregateUserActivityCost(db, trimmed))
}

function toSpendRow(
  index: number,
  thoughtId: string,
  groupId: string,
  wallMs: number,
  entityCount: number,
  cost: ActivityCostAggregate,
): SpendProbeThoughtRow {
  return {
    index,
    thoughtId,
    groupId,
    usd: cost.totalUsd,
    credits: cost.totalCredits,
    wallMs,
    entityCount,
    byOperation: cost.byOperation,
  }
}

/** Ingest one thought under its own trace group; bill the tenant user directly. */
export async function ingestSpendProbeThought(input: {
  userId: string
  index: number
  rawText: string
}): Promise<SpendProbeThoughtRow> {
  const userId = input.userId.trim()
  const rawText = input.rawText.trim()
  if (!userId) {
    throw new Error('ingestSpendProbeThought: userId is required')
  }
  if (!rawText) {
    throw new Error('ingestSpendProbeThought: rawText is required')
  }
  if (!Number.isInteger(input.index) || input.index < 0) {
    throw new Error('ingestSpendProbeThought: index must be a non-negative integer')
  }

  const groupId = randomUUID()
  const startedAt = Date.now()

  const capture = await withHarnessTenantDb(
    userId,
    () => runWithTrace(groupId, () => captureThought(userId, rawText, { awaitEnrichment: true })),
    { billingUserId: userId },
  )

  const wallMs = Date.now() - startedAt

  const cost = await withHarnessTenantDb(userId, (db) =>
    aggregateActivityCostByGroupId(db, userId, groupId),
  )

  return toSpendRow(input.index, capture.id, groupId, wallMs, capture.entities.length, cost)
}
