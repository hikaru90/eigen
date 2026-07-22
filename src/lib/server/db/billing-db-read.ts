import { billingUserAsyncLocal, tenantUserAsyncLocal } from '$lib/server/billing/context'
import { appDbAsyncLocal, appReservedSqlAsyncLocal, type AppDatabase } from './context'
import { activateTenantDbSession } from './tenant-session'

/**
 * Read billing-scoped rows without reserving a second pool connection.
 * When eval (or similar) already holds a reserved connection for the corpus tenant
 * but billing debits a different user, temporarily switch `app.current_user_id`.
 */
export async function withBillingUserDbRead<T>(
  billingUserId: string,
  fn: (db: AppDatabase) => Promise<T>,
): Promise<T> {
  const db = appDbAsyncLocal.getStore()
  const sql = appReservedSqlAsyncLocal.getStore()
  const tenantId = tenantUserAsyncLocal.getStore()
  const billingCtx = billingUserAsyncLocal.getStore()

  if (
    db &&
    sql &&
    tenantId &&
    billingCtx &&
    billingCtx === billingUserId &&
    tenantId !== billingUserId
  ) {
    await activateTenantDbSession(sql, billingUserId)
    try {
      return await fn(db)
    } finally {
      await activateTenantDbSession(sql, tenantId)
    }
  }

  const { withDbUser } = await import('./index')
  return withDbUser(billingUserId, fn)
}
