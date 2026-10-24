import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { effectiveLifecycleStatus, isTodoCategory } from '$lib/mesh/thought-status'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { canonicalEntity, thought, thoughtEntity, type MemoryAuthor } from '$lib/server/db/schema'
import { resolveAuthorSqlCondition } from '$lib/server/memory/authorship'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'

/**
 * The Yarn journal's thought list, shared by the page server load (SSR seed)
 * and GET /api/mesh/yarn (client refetch on data-view change). Traces the
 * existing thought-list path: the same select fields and per-row tenant
 * decryption as `listThoughts` (src/lib/server/capture/service.ts:661-724,
 * the function behind GET /api/capture/recent), widened to include completed
 * thoughts — the journal shows finished to-dos crossed out, so the browse
 * lists' `activeThoughtLifecycleCondition` (thought-lifecycle-filter.ts)
 * would hide exactly the rows the tick needs. Thread names resolve the way
 * the unified timeline resolves them (loadProjectLinksByThoughtId,
 * src/lib/server/memory/temporal-event-list.ts:255-286): thoughtEntity ⨝
 * canonical_entity where project_status is set, highest salience wins.
 * Embedding columns are never selected (embeddings are DB-only).
 */

/** Same ceiling as listThoughts (capture/service.ts caps its limit at 100). */
const YARN_THOUGHT_LIMIT = 100

export type YarnThought = {
  id: string
  text: string
  category: string
  createdAtIso: string
  status: 'open' | 'completed'
  isTodo: boolean
  threadLabel: string | null
  threadEntityId: string | null
}

/** Author scope for the strand — 'all' means the whole tenant (you + agents). */
export type YarnAuthorFilter = {
  author?: MemoryAuthor | 'all'
  authorLayerKey?: string | null
}

export async function loadYarnThoughts(
  userId: string,
  filter?: YarnAuthorFilter,
): Promise<YarnThought[]> {
  const db = getDb()

  const authorCondition = resolveAuthorSqlCondition(
    {
      author: thought.author,
      authorKeyId: thought.authorKeyId,
      authorLabel: thought.authorLabel,
    },
    {
      author: filter?.author === 'all' ? undefined : filter?.author,
      authorLayerKey: filter?.authorLayerKey,
    },
  )

  const rows = await db
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      category: thought.category,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      lifecycleStatus: thought.lifecycleStatus,
      createdAt: thought.createdAt,
    })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        // open + completed on the strand; archived (forgotten) stays off it
        inArray(thought.lifecycleStatus, ['open', 'completed']),
        ...(authorCondition ? [authorCondition] : []),
      ),
    )
    .orderBy(desc(thought.createdAt), desc(thought.id))
    .limit(YARN_THOUGHT_LIMIT)

  // Thread (project) links for exactly these rows — the timeline's query shape
  // (loadProjectLinksByThoughtId, temporal-event-list.ts): only membership rows
  // whose entity is a GTD project (project_status set), highest salience wins.
  const thoughtIds = rows.map((row) => row.id)
  const linkRows =
    thoughtIds.length > 0
      ? await db
          .select({
            thoughtId: thoughtEntity.thoughtId,
            entityId: canonicalEntity.id,
            label: canonicalEntity.label,
            salience: thoughtEntity.salience,
          })
          .from(thoughtEntity)
          .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
          .where(
            and(
              eq(thoughtEntity.userId, userId),
              inArray(thoughtEntity.thoughtId, thoughtIds),
              isNotNull(canonicalEntity.projectStatus),
              projectMembershipLinkCondition(),
            ),
          )
          .orderBy(desc(thoughtEntity.salience))
      : []
  const threadByThought = new Map<string, { entityId: string; label: string }>()
  for (const link of linkRows) {
    if (!threadByThought.has(link.thoughtId)) {
      threadByThought.set(link.thoughtId, { entityId: link.entityId, label: link.label })
    }
  }

  const thoughts: YarnThought[] = (
    await Promise.all(
      rows.map(async (row) => {
        const [text, metadataJson] = await Promise.all([
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
        const status = effectiveLifecycleStatus(row.lifecycleStatus, metadata.status)
        if (status === 'archived') return null
        const thread = threadByThought.get(row.id) ?? null
        return {
          id: row.id,
          text,
          category: row.category,
          createdAtIso: row.createdAt.toISOString(),
          status,
          isTodo: isTodoCategory(row.category),
          threadLabel: thread?.label ?? null,
          threadEntityId: thread?.entityId ?? null,
        } satisfies YarnThought
      }),
    )
  ).filter((row): row is YarnThought => row !== null)

  return thoughts
}
