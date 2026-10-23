import { eq } from 'drizzle-orm'
import { dev } from '$app/environment'
import {
  resolveE2eHarnessBillingUserId,
  resolveHarnessBillingUserId,
} from '$lib/server/auth/harness-billing'
import { authDb } from '$lib/server/db/auth-db'
import { user } from '$lib/server/db/auth.schema'

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
 * Dev only: the service wallet that pays for a Playwright harness account
 * (`e2e-…@test.eigen`), or undefined for every other account.
 */
export async function resolveE2eHarnessBillingFor(userId: string): Promise<string | undefined> {
  if (!dev) return undefined
  const [row] = await authDb
    .select({ accountKind: user.accountKind, email: user.email })
    .from(user)
    .where(eq(user.id, userId.trim()))
    .limit(1)
  if (row?.accountKind !== 'harness') return undefined
  return resolveE2eHarnessBillingUserId(row.email)
}

/**
 * Whether the dev-server background enrich worker may drain this tenant's queue.
 * Harness corpus tenants are CLI-driven; spend probes and Playwright harness accounts
 * use the real UI queue path.
 */
export async function shouldScheduleDevCaptureEnrichWorker(userId: string): Promise<boolean> {
  const id = userId.trim()
  if (!id) return false
  if (isGraphScaleSpendProbeUser(id)) return true
  if (resolveHarnessBillingUserId(id)) return false
  // Playwright harness accounts use the real UI queue path, billed to the service wallet.
  if (await resolveE2eHarnessBillingFor(id)) return true
  return !(await isHarnessUser(id))
}
