import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { user } from '$lib/server/db/auth.schema'
import { userWallet, walletLedgerEntry, paymentOrder } from '$lib/server/db/schema'
import { getOrCreateWallet, creditFromPayment } from '$lib/server/billing/wallet'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('wallet RLS integration', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb

  const suffix = `wallet_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const userA = `wallet_a_${suffix}`
  const userB = `wallet_b_${suffix}`

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb

    for (const [id, email] of [
      [userA, `${userA}@test.local`],
      [userB, `${userB}@test.local`],
    ] as const) {
      await withOperatorDb(async (db) => {
        await db.insert(user).values({
          id,
          name: id,
          email,
          emailVerified: true,
          onboardingCompleted: true,
        })
      })
    }
  })

  afterAll(async () => {
    for (const uid of [userA, userB]) {
      await withOperatorDb(async (db) => {
        await db.delete(walletLedgerEntry).where(eq(walletLedgerEntry.userId, uid))
        await db.delete(paymentOrder).where(eq(paymentOrder.userId, uid))
        await db.delete(userWallet).where(eq(userWallet.userId, uid))
        await db.delete(user).where(eq(user.id, uid))
      }).catch(() => undefined)
    }
  })

  it('user A wallet is not visible to user B', async () => {
    await withEvalDb(userA, async () => {
      const wallet = await getOrCreateWallet(userA)
      expect(wallet.availableCredits).toBe(0)
    })

    const creditedCredits = 16_650
    const paypalOrderId = `paypal_${suffix}`

    await withEvalDb(userA, async (db) => {
      const [order] = await db
        .insert(paymentOrder)
        .values({
          userId: userA,
          paypalOrderId,
          status: 'created',
          requestedCredits: creditedCredits,
          currency: 'USD',
        })
        .returning({ id: paymentOrder.id })

      const result = await creditFromPayment({
        userId: userA,
        paymentOrderId: order.id,
        paypalOrderId,
        amountCredits: creditedCredits,
      })
      expect(result.credited).toBe(true)
      expect(result.availableCredits).toBe(creditedCredits)
    })

    await withEvalDb(userA, async () => {
      const wallet = await getOrCreateWallet(userA)
      expect(wallet.availableCredits).toBe(creditedCredits)
    })

    await withEvalDb(userB, async (db) => {
      const rows = await db.select().from(userWallet).where(eq(userWallet.userId, userA))
      expect(rows).toHaveLength(0)
    })

    await withEvalDb(userB, async (db) => {
      const ledgerRows = await db
        .select()
        .from(walletLedgerEntry)
        .where(eq(walletLedgerEntry.userId, userA))
      expect(ledgerRows).toHaveLength(0)
    })
  })
})
