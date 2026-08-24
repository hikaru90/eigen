import { and, eq } from 'drizzle-orm'
import { encryptTenantValue } from '../src/lib/server/crypto/tenant-encryption'
import { getDb } from '../src/lib/server/db/context'
import { thought, llmProviderConfig } from '../src/lib/server/db/schema'

async function backfillThoughtsForUser(userId) {
  const rows = await getDb()
    .select({
      id: thought.id,
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(eq(thought.userId, userId))

  for (const row of rows) {
    if (row.rawTextEncrypted && row.normalizedTextEncrypted && row.metadataEncrypted) continue
    const [rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted] = await Promise.all([
      row.rawTextEncrypted ??
        encryptTenantValue({
          userId,
          table: 'thought',
          column: 'raw_text',
          plaintext: row.rawText,
        }),
      row.normalizedTextEncrypted ??
        encryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          plaintext: row.normalizedText,
        }),
      row.metadataEncrypted ??
        encryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          plaintext: JSON.stringify(row.metadata ?? {}),
        }),
    ])
    await getDb()
      .update(thought)
      .set({ rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted, updatedAt: new Date() })
      .where(and(eq(thought.id, row.id), eq(thought.userId, userId)))
  }
}

async function backfillLlmCredentialsForUser(userId) {
  const rows = await getDb()
    .select({
      provider: llmProviderConfig.provider,
      apiKey: llmProviderConfig.apiKey,
      apiKeyEncrypted: llmProviderConfig.apiKeyEncrypted,
    })
    .from(llmProviderConfig)
    .where(eq(llmProviderConfig.userId, userId))
  for (const row of rows) {
    if (row.apiKeyEncrypted) continue
    const apiKeyEncrypted = await encryptTenantValue({
      userId,
      table: 'llm_provider_config',
      column: 'api_key',
      plaintext: row.apiKey,
    })
    await getDb()
      .update(llmProviderConfig)
      .set({ apiKeyEncrypted, updatedAt: new Date() })
      .where(
        and(eq(llmProviderConfig.userId, userId), eq(llmProviderConfig.provider, row.provider)),
      )
  }
}

async function main() {
  const userId = process.argv[2]?.trim()
  if (!userId) {
    throw new Error('usage: node scripts/backfill-tenant-encryption.mjs <userId>')
  }
  await backfillThoughtsForUser(userId)
  await backfillLlmCredentialsForUser(userId)
  console.log(`[tenant-encryption] backfill complete for ${userId}`)
}

main().catch((err) => {
  console.error('[tenant-encryption] backfill failed', err)
  process.exitCode = 1
})
