import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'

/**
 * Persist the early-access agreement acceptance for a user.
 * Upsert so it works even if the preference row does not exist yet.
 */
export async function acceptBetaAgreement(userId: string): Promise<Date> {
  const acceptedAt = new Date()
  await getDb()
    .insert(userPreference)
    .values({ userId, betaAgreementAcceptedAt: acceptedAt })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { betaAgreementAcceptedAt: acceptedAt, updatedAt: acceptedAt },
    })
  return acceptedAt
}
