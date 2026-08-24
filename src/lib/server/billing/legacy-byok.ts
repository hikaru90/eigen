import { eq } from 'drizzle-orm'
import { captureServerEvent } from '$lib/server/analytics/posthog-server'
import { withDbUser } from '$lib/server/db'
import {
  llmActiveProvider,
  llmProviderConfig,
  userPreference,
  type BillingMode,
} from '$lib/server/db/schema'

export function legacyByokMigrationNeeded(opts: {
  byokUiEnabled: boolean
  billingMode: BillingMode
  hasStoredCredentials: boolean
}): boolean {
  if (opts.byokUiEnabled) return false
  return opts.billingMode === 'byok' || opts.hasStoredCredentials
}

/** Remove stored BYOK credentials and switch billing to platform credits. */
export async function clearLegacyByokForUser(userId: string): Promise<void> {
  await withDbUser(userId, async (db) => {
    await db.delete(llmProviderConfig).where(eq(llmProviderConfig.userId, userId))
    await db.delete(llmActiveProvider).where(eq(llmActiveProvider.userId, userId))
    await db
      .insert(userPreference)
      .values({ userId, billingMode: 'platform_credits' })
      .onConflictDoUpdate({
        target: userPreference.userId,
        set: { billingMode: 'platform_credits', updatedAt: new Date() },
      })
  })

  captureServerEvent({
    distinctId: userId,
    event: 'legacy_byok_migrated_to_platform_credits',
    properties: {},
  })
}
