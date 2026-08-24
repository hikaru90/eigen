import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import { HARNESS_E2E_PASSWORD } from '$lib/e2e/harness-credentials'
import { authDb } from '$lib/server/db/auth-db'
import { account, user } from '$lib/server/db/auth.schema'

/** Ensure a harness user can sign in with email/password (Playwright, dev tools). */
export async function ensureHarnessCredentialAccount(
  targetUserId: string,
): Promise<{ email: string; password: string }> {
  const trimmedId = targetUserId.trim()
  if (!trimmedId) {
    throw new Error('ensureHarnessCredentialAccount: userId is required')
  }

  const [row] = await authDb.select().from(user).where(eq(user.id, trimmedId)).limit(1)
  if (!row) {
    throw new Error(`Harness user not found: ${trimmedId}`)
  }
  if (row.accountKind !== 'harness') {
    throw new Error(`Refusing credential bootstrap for non-harness user: ${trimmedId}`)
  }

  const passwordHash = await hashPassword(HARNESS_E2E_PASSWORD)
  const [existingAccount] = await authDb
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, trimmedId), eq(account.providerId, 'credential')))
    .limit(1)

  const now = new Date()
  if (!existingAccount) {
    await authDb.insert(account).values({
      id: randomUUID(),
      accountId: randomUUID(),
      providerId: 'credential',
      userId: trimmedId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    await authDb
      .update(account)
      .set({ password: passwordHash, updatedAt: now })
      .where(eq(account.id, existingAccount.id))
  }

  const { ensureHarnessWalletCredits } = await import('$lib/server/billing/ensure-harness-credits')
  await ensureHarnessWalletCredits(trimmedId)

  return { email: row.email, password: HARNESS_E2E_PASSWORD }
}
