import type { PageServerLoad } from './$types'
import { error, redirect } from '@sveltejs/kit'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { effectiveLifecycleStatus } from '$lib/mesh/thought-status'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { canonicalEntity, thought, thoughtEntity } from '$lib/server/db/schema'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { loadThoughtKindOptions } from '$lib/server/thought/kind-options'
import type { ThoughtKindOption } from '$lib/thought/kind-option'

/**
 * A thought, up close (ei redesign, wave 3.1): the server load for /thought/[id].
 * Authorizes the way the other memory pages do (src/routes/memory/projects/[entityId]/
 * +page.server.ts:9-16: no session → /login, missing row → 404) and reads the thought
 * exactly as GET /api/thoughts/[thoughtId] does (src/routes/api/thoughts/[thoughtId]/
 * +server.ts:19-63): tenant-scoped select, per-column tenant decryption, and never the
 * embedding column (embeddings are DB-only). The thread resolves the way Yarn resolves
 * it (src/routes/mesh/yarn/+page.server.ts:85-114). Forgotten (archived) thoughts are
 * no page: 404.
 */

export type ThoughtPageThought = {
  id: string
  text: string
  category: string
  createdAtIso: string
  status: 'open' | 'completed'
  thread: { entityId: string; label: string } | null
}

/** An active thought_category kind: the type control's menu, in the user's ontology. */

export type ThoughtPageData = {
  preferredTimezone: string
  thought: ThoughtPageThought
  kinds: ThoughtKindOption[]
}

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }
  const userId = event.locals.user.id
  const thoughtId = event.params.id?.trim() ?? ''
  if (!thoughtId) error(404, 'Thought not found')

  const db = getDb()
  const [row] = await db
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
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) error(404, 'Thought not found')

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
  if (status === 'archived') error(404, 'Thought not found')

  // The thread: this thought's highest-salience membership link to a GTD project (Yarn's query).
  const [link] = await db
    .select({
      entityId: canonicalEntity.id,
      label: canonicalEntity.label,
    })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        eq(thoughtEntity.thoughtId, thoughtId),
        isNotNull(canonicalEntity.projectStatus),
        projectMembershipLinkCondition(),
      ),
    )
    .orderBy(desc(thoughtEntity.salience))
    .limit(1)

  const kinds = await loadThoughtKindOptions(db, userId)

  const preferredTimezone = await getUserPreferredTimezone(userId)

  return {
    user: event.locals.user,
    preferredTimezone,
    thought: {
      id: row.id,
      text,
      category: row.category,
      createdAtIso: row.createdAt.toISOString(),
      status,
      thread: link ? { entityId: link.entityId, label: link.label } : null,
    },
    kinds,
  } satisfies ThoughtPageData & { user: NonNullable<App.Locals['user']> }
}
