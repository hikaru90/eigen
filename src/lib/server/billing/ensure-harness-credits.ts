import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { creditFromPayment, getOrCreateWallet } from '$lib/server/billing/wallet'
import { withDbUser, type AppDatabase } from '$lib/server/db'
import { paymentOrder } from '$lib/server/db/schema'

/** Default harness wallet top-up (enough for graph-scale / eval smoke runs). */
export const HARNESS_TEST_TOP_UP_CREDITS = 500_000

export type EnsureHarnessWalletCreditsOptions = {
  minCredits?: number
  topUpCredits?: number
}

async function ensureWalletCreditsAtLeast(
  userId: string,
  options?: EnsureHarnessWalletCreditsOptions,
): Promise<number> {
  const minCredits = options?.minCredits ?? MIN_CAPTURE_PIPELINE_CREDITS
  const topUpCredits = options?.topUpCredits ?? HARNESS_TEST_TOP_UP_CREDITS

  return withDbUser(userId, async (db) => {
    let wallet = await getOrCreateWallet(userId)
    if (wallet.availableCredits >= minCredits) {
      return wallet.availableCredits
    }

    await topUpHarnessWallet(db, userId, topUpCredits)

    wallet = await getOrCreateWallet(userId)
    return wallet.availableCredits
  })
}

async function topUpHarnessWallet(
  db: AppDatabase,
  userId: string,
  topUpCredits: number,
): Promise<void> {
  const paypalOrderId = `harness_test_${userId}_${Date.now()}`
  const [row] = await db
    .insert(paymentOrder)
    .values({
      userId,
      paypalOrderId,
      status: 'created',
      requestedCredits: topUpCredits,
      currency: 'USD',
    })
    .returning({ id: paymentOrder.id })

  await creditFromPayment({
    userId,
    paymentOrderId: row.id,
    paypalOrderId,
    amountCredits: topUpCredits,
  })
}

/**
 * Ensure harness LLM wallets have platform credits.
 * Credits the billing operator and the corpus tenant (when different) so dev-server
 * enrich paths that still bill the tenant directly cannot fail with 0 credits.
 */
export async function ensureHarnessWalletCredits(
  harnessUserId: string,
  options?: EnsureHarnessWalletCreditsOptions,
): Promise<{ billingUserId: string; availableCredits: number }> {
  const billingUserId = resolveHarnessBillingUserId(harnessUserId) ?? harnessUserId
  console.log('[billing] ensureHarnessWalletCredits', {
    harnessUserId,
    billingUserId,
    resolved: resolveHarnessBillingUserId(harnessUserId) !== undefined,
  })
  const targets = billingUserId === harnessUserId ? [billingUserId] : [billingUserId, harnessUserId]

  let availableCredits = 0
  for (const targetId of targets) {
    availableCredits = await ensureWalletCreditsAtLeast(targetId, options)
  }
  return { billingUserId, availableCredits }
}
