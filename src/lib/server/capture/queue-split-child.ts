/**
 * Shared child-creation step of every capture fan-out (multi-to-do fan-out in
 * `memory/split-multi-task.ts`, content-role span split in `apply-capture-content-split.ts`):
 * the child is queued like any capture, speaks as the parent's author, is as old as the capture
 * it came from (not as old as the enrich pass), and carries `metadata.splitFrom` so it is never
 * decided or split again.
 */
import { and, eq } from 'drizzle-orm'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought, type MemoryAuthor } from '$lib/server/db/schema'

export type SplitParent = {
  author: MemoryAuthor
  authorLabel: string | null
  authorKeyId: string | null
  /** The parent's capture time — children inherit it. */
  createdAt: Date
}

/** Queues one child thought and returns its id. `category` is set only when the fan-out already knows the kind. */
export async function queueSplitChild(input: {
  userId: string
  parentThoughtId: string
  parent: SplitParent
  text: string
  category?: { key: string; ontologyEntityKindId: string }
}): Promise<string> {
  const { userId, parent } = input
  const queued = await queueCapture(userId, input.text, {
    source: 'ui',
    author: parent.author,
    ...(parent.authorLabel !== null ? { authorLabel: parent.authorLabel } : {}),
    ...(parent.authorKeyId !== null ? { authorKeyId: parent.authorKeyId } : {}),
    // a child is as old as the capture it came from, not as old as the enrich pass
    capturedAt: parent.createdAt,
  })

  const metadataEncrypted = await encryptTenantValue({
    userId,
    table: 'thought',
    column: 'metadata',
    plaintext: JSON.stringify({ splitFrom: input.parentThoughtId }),
  })
  await getDb()
    .update(thought)
    .set({
      ...(input.category
        ? {
            category: input.category.key,
            ontologyEntityKindId: input.category.ontologyEntityKindId,
          }
        : {}),
      metadata: { encrypted: true },
      metadataEncrypted,
      updatedAt: new Date(),
    })
    .where(and(eq(thought.id, queued.thoughtId), eq(thought.userId, userId)))

  return queued.thoughtId
}
