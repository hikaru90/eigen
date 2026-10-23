/**
 * Background worker: drain pending enrich queue per user.
 */
import {
  resolveE2eHarnessBillingFor,
  shouldScheduleDevCaptureEnrichWorker,
} from '$lib/server/auth/harness-account'
import { billingUserAsyncLocal } from '$lib/server/billing/context'
import { ensureHarnessWalletCredits } from '$lib/server/billing/ensure-harness-credits'
import { drainCaptureEnrichQueue } from '$lib/server/capture/enrich-queue-drain'
import { syncCaptureEnrichQueue } from '$lib/server/capture/sync-capture-enrich-queue'
import { withDbUser } from '$lib/server/db'

const activeWorkers = new Map<string, Promise<void>>()

export function isCaptureEnrichWorkerActive(userId: string): boolean {
  return activeWorkers.has(userId)
}

export function scheduleCaptureEnrichWorker(userId: string): void {
  if (activeWorkers.has(userId)) return

  const work = shouldScheduleDevCaptureEnrichWorker(userId)
    .then(async (allowed) => {
      if (!allowed) return
      const drain = () =>
        withDbUser(userId, async () => {
          await syncCaptureEnrichQueue(userId)
          await drainCaptureEnrichQueue(userId)
        })
      // The worker runs outside the request, so the request's billing context is gone:
      // Playwright harness accounts bill to their service wallet explicitly here.
      const e2eBillingUserId = await resolveE2eHarnessBillingFor(userId)
      if (!e2eBillingUserId) return drain()
      await ensureHarnessWalletCredits(e2eBillingUserId)
      return billingUserAsyncLocal.run(e2eBillingUserId, drain)
    })
    .catch((err) => {
      console.error('[capture-enrich-worker] worker failed', {
        userId,
        message: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => {
      activeWorkers.delete(userId)
    })

  activeWorkers.set(userId, work)
}

export async function awaitCaptureEnrichWorkerIdle(userId: string): Promise<void> {
  const pending = activeWorkers.get(userId)
  if (pending) await pending
}
