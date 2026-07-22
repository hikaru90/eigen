import { eq } from 'drizzle-orm'
import { authDb } from '$lib/server/db/auth-db'
import { user } from '$lib/server/db/auth.schema'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'

export async function isHarnessUser(userId: string): Promise<boolean> {
  const [row] = await authDb
    .select({ accountKind: user.accountKind })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return row?.accountKind === 'harness'
}

/** Playwright graph-scale spend probe tenants (UI capture, self-billed). */
export function isGraphScaleSpendProbeUser(userId: string): boolean {
  return userId.trim().startsWith('graph-scale-spend-')
}

/**
 * Whether the dev-server background enrich worker may drain this tenant's queue.
 * Harness corpus tenants are CLI-driven; spend probes use the real UI queue path.
 */
export async function shouldScheduleDevCaptureEnrichWorker(userId: string): Promise<boolean> {
  const id = userId.trim()
  if (!id) return false
  if (isGraphScaleSpendProbeUser(id)) return true
  if (resolveHarnessBillingUserId(id)) return false
  return !(await isHarnessUser(id))
}
