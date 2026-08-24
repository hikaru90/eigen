import { and, eq } from 'drizzle-orm'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { rotateTenantDek } from '$lib/server/crypto/tenant-keys'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'

export async function rotateTenantEncryptedThoughtData(
  userId: string,
): Promise<{ reencrypted: number }> {
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

  await rotateTenantDek(userId)
  let reencrypted = 0
  for (const row of rows) {
    if (!row.rawTextEncrypted && !row.normalizedTextEncrypted && !row.metadataEncrypted) continue
    const [rawText, normalizedText, metadataJson] = await Promise.all([
      row.rawTextEncrypted
        ? decryptTenantValue({
            userId,
            table: 'thought',
            column: 'raw_text',
            ciphertext: row.rawTextEncrypted,
          })
        : Promise.resolve(row.rawText),
      row.normalizedTextEncrypted
        ? decryptTenantValue({
            userId,
            table: 'thought',
            column: 'normalized_text',
            ciphertext: row.normalizedTextEncrypted,
          })
        : Promise.resolve(row.normalizedText),
      row.metadataEncrypted
        ? decryptTenantValue({
            userId,
            table: 'thought',
            column: 'metadata',
            ciphertext: row.metadataEncrypted,
          })
        : Promise.resolve(JSON.stringify(row.metadata ?? {})),
    ])
    const [rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted] = await Promise.all([
      encryptTenantValue({ userId, table: 'thought', column: 'raw_text', plaintext: rawText }),
      encryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        plaintext: normalizedText,
      }),
      encryptTenantValue({
        userId,
        table: 'thought',
        column: 'metadata',
        plaintext: metadataJson,
      }),
    ])
    await getDb()
      .update(thought)
      .set({ rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted, updatedAt: new Date() })
      .where(and(eq(thought.id, row.id), eq(thought.userId, userId)))
    reencrypted += 1
  }
  return { reencrypted }
}
