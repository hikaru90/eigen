import { and, eq, gte, lte } from 'drizzle-orm'
import {
  aggregateActivityCostFromRows,
  type ActivityCostAggregate,
  type ActivityCostRow,
} from '$lib/server/activity/trace-cost'
import { activityCallLog } from '$lib/server/db/schema'
import { withEvalDb } from '../harness/eval-context'

export type RunCost = ActivityCostAggregate & {
  byTenantUsd: Record<string, string>
}

export type LoadActivityRows = (
  tenantUserId: string,
  from: Date,
  to: Date,
) => Promise<ActivityCostRow[]>

/**
 * `activity_call_log.user_id` is the tenant (RLS) user — `logActivityCall` writes
 * `resolveTenantUserId(...)`, never the billing user — and the table has FORCE RLS,
 * so rows are read per tenant under that tenant's session.
 */
const loadTenantActivityRows: LoadActivityRows = (tenantUserId, from, to) =>
  withEvalDb(tenantUserId, (db) =>
    db
      .select({
        operation: activityCallLog.operation,
        baseCostUsd: activityCallLog.baseCostUsd,
        markupUsd: activityCallLog.markupUsd,
        totalCostUsd: activityCallLog.totalCostUsd,
        durationMs: activityCallLog.durationMs,
      })
      .from(activityCallLog)
      .where(
        and(
          eq(activityCallLog.userId, tenantUserId),
          gte(activityCallLog.createdAt, from),
          lte(activityCallLog.createdAt, to),
        ),
      ),
  )

/** USD (and call counts) for the given tenants between `from` and `to`, inclusive. */
export async function aggregateRunCost(input: {
  tenantUserIds: string[]
  from: Date
  to: Date
  /** Row loader (injectable for tests). */
  loadRows?: LoadActivityRows
}): Promise<RunCost> {
  const { from, to } = input
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
    throw new Error('[public-bench] cost window must have valid dates with from <= to')
  }
  if (input.tenantUserIds.length === 0 || input.tenantUserIds.some((id) => !id.trim())) {
    throw new Error('[public-bench] tenantUserIds must be a non-empty list of non-blank ids')
  }

  const loadRows = input.loadRows ?? loadTenantActivityRows
  const allRows: ActivityCostRow[] = []
  const byTenantUsd: Record<string, string> = {}

  for (const tenantUserId of new Set(input.tenantUserIds)) {
    const rows = await loadRows(tenantUserId, from, to)
    byTenantUsd[tenantUserId] = aggregateActivityCostFromRows(rows).totalUsd
    allRows.push(...rows)
  }

  return { ...aggregateActivityCostFromRows(allRows), byTenantUsd }
}
