/**
 * Incremental community/bundle refresh after enrich — not only nightly cron.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, withDbUser } from '$lib/server/db'
import { communityMember, graphCommunity, thoughtEntity } from '$lib/server/db/schema'
import { buildCommunityBundle } from './community-bundles'
import { COMMUNITY_MID_LEVEL } from './community-levels'

/** Mark L1 communities containing entities linked to this thought as dirty. */
export async function markCommunitiesDirtyForThought(
  userId: string,
  thoughtId: string,
): Promise<string[]> {
  const db = getDb()
  const entityRows = await db
    .select({ entityId: thoughtEntity.entityId })
    .from(thoughtEntity)
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, thoughtId)))

  const entityIds = entityRows.map((r) => r.entityId)
  if (entityIds.length === 0) return []

  const communityRows = await db
    .select({ communityId: communityMember.communityId })
    .from(communityMember)
    .innerJoin(graphCommunity, eq(communityMember.communityId, graphCommunity.id))
    .where(
      and(
        eq(communityMember.userId, userId),
        inArray(communityMember.canonicalEntityId, entityIds),
        eq(graphCommunity.level, COMMUNITY_MID_LEVEL),
      ),
    )

  const communityIds = [...new Set(communityRows.map((r) => r.communityId))]
  if (communityIds.length === 0) return []

  await db
    .update(graphCommunity)
    .set({ dirtyAt: sql`now()` })
    .where(and(eq(graphCommunity.userId, userId), inArray(graphCommunity.id, communityIds)))

  return communityIds
}

/** Refresh bundles for dirty L1 communities. Summaries run on the next heartbeat batch. */
export async function refreshDirtyCommunitiesForUser(userId: string): Promise<{
  bundlesRefreshed: number
  summariesTriggered: boolean
}> {
  const db = getDb()
  const dirty = await db
    .select({
      id: graphCommunity.id,
      level: graphCommunity.level,
    })
    .from(graphCommunity)
    .where(
      and(
        eq(graphCommunity.userId, userId),
        eq(graphCommunity.level, COMMUNITY_MID_LEVEL),
        sql`${graphCommunity.dirtyAt} IS NOT NULL`,
      ),
    )
    .limit(50)

  if (dirty.length === 0) {
    return { bundlesRefreshed: 0, summariesTriggered: false }
  }

  let bundlesRefreshed = 0
  for (const community of dirty) {
    const built = await buildCommunityBundle(userId, community.id)
    if (built) bundlesRefreshed++
  }

  return { bundlesRefreshed, summariesTriggered: dirty.length > 0 }
}

/**
 * Schedule incremental refresh after enrich (non-blocking). Self-wraps its own tenant
 * connection: the detached task may outlive the caller's reserved connection, and under
 * FORCE RLS an expired tenant session silently reads/writes zero rows.
 */
export function scheduleIncrementalConsolidation(userId: string, thoughtId: string): void {
  void withDbUser(userId, async () => {
    await markCommunitiesDirtyForThought(userId, thoughtId)
    await refreshDirtyCommunitiesForUser(userId)
  }).catch((err) => {
    console.warn('[incremental-consolidation] refresh failed', {
      userId,
      thoughtId,
      message: err instanceof Error ? err.message : String(err),
    })
  })
}
