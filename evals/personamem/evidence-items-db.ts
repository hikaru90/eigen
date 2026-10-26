import { eq } from 'drizzle-orm'
import { withEvalDb } from '../harness/eval-context'
import { splitFromOf, type FamilyThought, type NoteLink } from './evidence-items'

export type TenantStructure = { thoughts: FamilyThought[]; links: NoteLink[] }

/**
 * Every thought of the tenant (with the parent it was split from, if any) and every
 * thought-to-note link. Structure only: no text, no embedding. Live path only.
 */
export async function loadTenantStructure(
  tenant: string,
  billing: { billingUserId: string; chatModel: string },
): Promise<TenantStructure> {
  const { thought, thoughtTextFile } = await import('$lib/server/db/schema')
  const { decryptTenantValue } = await import('$lib/server/crypto/tenant-encryption')
  return withEvalDb(
    tenant,
    async (db) => {
      const rows = await db
        .select({
          id: thought.id,
          metadata: thought.metadata,
          metadataEncrypted: thought.metadataEncrypted,
        })
        .from(thought)
        .where(eq(thought.userId, tenant))
      const thoughts: FamilyThought[] = []
      for (const row of rows) {
        const metadata: unknown = row.metadataEncrypted
          ? JSON.parse(
              await decryptTenantValue({
                userId: tenant,
                table: 'thought',
                column: 'metadata',
                ciphertext: row.metadataEncrypted,
              }),
            )
          : row.metadata
        thoughts.push({ id: row.id, splitFrom: splitFromOf(metadata) })
      }
      const links = await db
        .select({ thoughtId: thoughtTextFile.thoughtId, textFileId: thoughtTextFile.textFileId })
        .from(thoughtTextFile)
        .where(eq(thoughtTextFile.userId, tenant))
      return { thoughts, links }
    },
    billing,
  )
}
