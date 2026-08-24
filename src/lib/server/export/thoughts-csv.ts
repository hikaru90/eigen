import { asc, eq } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { buildCsv, formatTimestamp } from './csv'

export const THOUGHTS_CSV_HEADERS = [
  'id',
  'created_at',
  'updated_at',
  'category',
  'raw_text',
  'normalized_text',
  'status',
] as const

function thoughtStatus(metadata: Record<string, unknown>): string {
  const status = metadata.status
  return typeof status === 'string' ? status : ''
}

export async function buildThoughtsCsv(userId: string): Promise<string> {
  const rows = await getDb()
    .select({
      id: thought.id,
      createdAt: thought.createdAt,
      updatedAt: thought.updatedAt,
      category: thought.category,
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(eq(thought.userId, userId))
    .orderBy(asc(thought.createdAt), asc(thought.id))

  const dataRows: string[][] = []
  for (const row of rows) {
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
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>
    dataRows.push([
      row.id,
      formatTimestamp(row.createdAt),
      formatTimestamp(row.updatedAt),
      row.category,
      rawText,
      normalizedText,
      thoughtStatus(metadata),
    ])
  }

  return buildCsv(THOUGHTS_CSV_HEADERS, dataRows)
}
