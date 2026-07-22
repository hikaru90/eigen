/**
 * Shared sample loaders for Heartbeat expand panels (REM / retrieval jobs).
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { HeartbeatJobSample } from '$lib/consolidation/heartbeat-job-report'
import { clipThoughtSample } from '$lib/consolidation/heartbeat-job-report'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  communityMember,
  communitySummary,
  graphCommunity,
  thought,
} from '$lib/server/db/schema'
import { COMMUNITY_MID_LEVEL } from './community-levels'

const SAMPLE_CAP = 12

/** Largest communities (default L1) with title or member-label preview. */
export async function loadTopCommunitySamples(
  userId: string,
  options?: { level?: number; limit?: number; communityIds?: string[] },
): Promise<HeartbeatJobSample[]> {
  const db = getDb()
  const limit = options?.limit ?? SAMPLE_CAP
  const level = options?.level ?? COMMUNITY_MID_LEVEL

  const communities = options?.communityIds?.length
    ? await db
        .select({
          id: graphCommunity.id,
          level: graphCommunity.level,
          memberCount: graphCommunity.memberCount,
        })
        .from(graphCommunity)
        .where(
          and(
            eq(graphCommunity.userId, userId),
            inArray(graphCommunity.id, options.communityIds.slice(0, limit)),
          ),
        )
    : await db
        .select({
          id: graphCommunity.id,
          level: graphCommunity.level,
          memberCount: graphCommunity.memberCount,
        })
        .from(graphCommunity)
        .where(and(eq(graphCommunity.userId, userId), eq(graphCommunity.level, level)))
        .orderBy(desc(graphCommunity.memberCount))
        .limit(limit)

  if (communities.length === 0) return []

  const ids = communities.map((c) => c.id)
  const summaries = await db
    .select({
      communityId: communitySummary.communityId,
      summaryShort: communitySummary.summaryShort,
    })
    .from(communitySummary)
    .where(and(eq(communitySummary.userId, userId), inArray(communitySummary.communityId, ids)))
  const titleById = new Map(summaries.map((s) => [s.communityId, s.summaryShort?.trim() || null]))

  const memberRows = await db
    .select({
      communityId: communityMember.communityId,
      label: canonicalEntity.label,
    })
    .from(communityMember)
    .innerJoin(canonicalEntity, eq(communityMember.canonicalEntityId, canonicalEntity.id))
    .where(and(eq(communityMember.userId, userId), inArray(communityMember.communityId, ids)))

  const labelsByCommunity = new Map<string, string[]>()
  for (const row of memberRows) {
    const list = labelsByCommunity.get(row.communityId) ?? []
    if (list.length < 4) list.push(row.label)
    labelsByCommunity.set(row.communityId, list)
  }

  return communities.map((c) => {
    const title = titleById.get(c.id)
    const labels = labelsByCommunity.get(c.id) ?? []
    const preview =
      title || (labels.length > 0 ? labels.join(', ') : `Community ${c.id.slice(0, 8)}`)
    return {
      kind: 'note' as const,
      id: c.id,
      label: preview,
      note: `L${c.level} · ${c.memberCount} entit${c.memberCount === 1 ? 'y' : 'ies'}`,
    }
  })
}

export async function loadThoughtTextSamples(
  userId: string,
  thoughtIds: string[],
  note?: string,
): Promise<HeartbeatJobSample[]> {
  if (thoughtIds.length === 0) return []
  const db = getDb()
  const ids = thoughtIds.slice(0, SAMPLE_CAP)
  const rows = await db
    .select({ id: thought.id, normalizedText: thought.normalizedText })
    .from(thought)
    .where(and(eq(thought.userId, userId), inArray(thought.id, ids)))
  const byId = new Map(rows.map((r) => [r.id, r.normalizedText]))
  return ids.flatMap((id) => {
    const text = byId.get(id)
    if (!text) return []
    return [
      {
        kind: 'thought' as const,
        id,
        label: clipThoughtSample(text),
        note,
      },
    ]
  })
}

export async function countCommunitiesByLevel(
  userId: string,
): Promise<{ level: number; count: number }[]> {
  const db = getDb()
  const rows = await db
    .select({
      level: graphCommunity.level,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(graphCommunity)
    .where(eq(graphCommunity.userId, userId))
    .groupBy(graphCommunity.level)
  return rows.map((r) => ({ level: r.level, count: Number(r.count) }))
}
