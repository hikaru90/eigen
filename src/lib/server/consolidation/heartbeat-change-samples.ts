/**
 * Sample communities / summaries for Heartbeat change-log panels.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import type { HeartbeatJobSample } from '$lib/consolidation/heartbeat-job-report'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  communityBundle,
  communityMember,
  communitySummary,
  graphCommunity,
} from '$lib/server/db/schema'
import { COMMUNITY_MID_LEVEL } from './community-levels'

const SAMPLE_CAP = 12

function clip(text: string, max = 90): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Largest L1 communities with a short member preview (and summary title when present). */
export async function loadLargestCommunitySamples(
  userId: string,
  limit = SAMPLE_CAP,
): Promise<HeartbeatJobSample[]> {
  const db = getDb()
  const communities = await db
    .select({
      id: graphCommunity.id,
      memberCount: graphCommunity.memberCount,
      summaryShort: communitySummary.summaryShort,
    })
    .from(graphCommunity)
    .leftJoin(communitySummary, eq(communitySummary.communityId, graphCommunity.id))
    .where(and(eq(graphCommunity.userId, userId), eq(graphCommunity.level, COMMUNITY_MID_LEVEL)))
    .orderBy(desc(graphCommunity.memberCount))
    .limit(limit)

  if (communities.length === 0) return []

  const ids = communities.map((c) => c.id)
  const members = await db
    .select({
      communityId: communityMember.communityId,
      label: canonicalEntity.label,
    })
    .from(communityMember)
    .innerJoin(canonicalEntity, eq(communityMember.canonicalEntityId, canonicalEntity.id))
    .where(and(eq(communityMember.userId, userId), inArray(communityMember.communityId, ids)))
    .limit(limit * 4)

  const labelsByCommunity = new Map<string, string[]>()
  for (const row of members) {
    const list = labelsByCommunity.get(row.communityId) ?? []
    if (list.length < 4) list.push(row.label)
    labelsByCommunity.set(row.communityId, list)
  }

  return communities.map((c) => {
    const memberPreview = (labelsByCommunity.get(c.id) ?? []).join(', ')
    const title = c.summaryShort?.trim()
    return {
      kind: 'note' as const,
      id: c.id,
      label: title || memberPreview || `Community (${c.memberCount} entities)`,
      note: title
        ? `${c.memberCount} entities · e.g. ${memberPreview || '—'}`
        : `${c.memberCount} entities`,
    }
  })
}

/** Recently written L1 routing summary titles (change log for “what got summarized”). */
export async function loadRecentSummarySamples(
  userId: string,
  limit = SAMPLE_CAP,
): Promise<HeartbeatJobSample[]> {
  const db = getDb()
  const rows = await db
    .select({
      communityId: communitySummary.communityId,
      summaryShort: communitySummary.summaryShort,
      summaryText: communitySummary.summaryText,
      entityCount: communitySummary.entityCount,
      thoughtCount: communitySummary.thoughtCount,
    })
    .from(communitySummary)
    .where(
      and(eq(communitySummary.userId, userId), eq(communitySummary.level, COMMUNITY_MID_LEVEL)),
    )
    .orderBy(desc(communitySummary.generatedAt))
    .limit(limit)

  return rows.map((row) => ({
    kind: 'note' as const,
    id: row.communityId,
    label: clip(row.summaryShort?.trim() || row.summaryText),
    note: `summarized · ${row.entityCount} entities, ${row.thoughtCount} thoughts`,
  }))
}

/** Bundle rows for “what got packaged for retrieval”. */
export async function loadBundleSamples(
  userId: string,
  communityIds: string[],
  limit = SAMPLE_CAP,
): Promise<HeartbeatJobSample[]> {
  if (communityIds.length === 0) return []
  const db = getDb()
  const take = communityIds.slice(0, limit)
  const bundled = await db
    .select({
      communityId: communityBundle.communityId,
      payload: communityBundle.payload,
      summaryShort: communitySummary.summaryShort,
      memberCount: graphCommunity.memberCount,
    })
    .from(communityBundle)
    .innerJoin(graphCommunity, eq(communityBundle.communityId, graphCommunity.id))
    .leftJoin(communitySummary, eq(communitySummary.communityId, communityBundle.communityId))
    .where(and(eq(communityBundle.userId, userId), inArray(communityBundle.communityId, take)))
    .limit(limit)

  return bundled.map((row) => {
    const thoughtCount =
      row.payload && typeof row.payload === 'object' && 'thoughtCount' in row.payload
        ? Number((row.payload as { thoughtCount?: number }).thoughtCount ?? 0)
        : 0
    return {
      kind: 'note' as const,
      id: row.communityId,
      label: clip(row.summaryShort?.trim() || `Community (${row.memberCount} entities)`),
      note: `bundled · ${thoughtCount} top thoughts`,
    }
  })
}
