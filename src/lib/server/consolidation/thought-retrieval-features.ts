/**
 * Precompute per-thought retrieval ranking features at consolidation time.
 */

import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  communityMember,
  graphCommunity,
  thought,
  thoughtEntity,
} from '$lib/server/db/schema'
import { COMMUNITY_EVIDENCE_MIN_LEVEL } from './community-levels'

const RECENCY_HALF_LIFE_DAYS = 90

function recencyBucket(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / 86400000
  return Math.exp((-ageDays * Math.LN2) / RECENCY_HALF_LIFE_DAYS)
}

/** Assign primary communities and ranking features to thoughts for a user. */
export async function computeThoughtRetrievalFeatures(userId: string): Promise<{
  updated: number
  samples: { kind: 'thought'; id: string; label: string; note: string }[]
  sampleTotal: number
}> {
  const db = getDb()

  // Entity degree proxy: count of thought_entity links per entity.
  const entityDegrees = await db
    .select({
      entityId: thoughtEntity.entityId,
      degree: sql<number>`count(*)::int`.as('degree'),
    })
    .from(thoughtEntity)
    .where(eq(thoughtEntity.userId, userId))
    .groupBy(thoughtEntity.entityId)

  const degreeByEntity = new Map(entityDegrees.map((r) => [r.entityId, r.degree]))
  const maxDegree = Math.max(1, ...entityDegrees.map((r) => r.degree))

  // Community membership: entity → communities at leaf + domain levels (L1–L2).
  const members = await db
    .select({
      entityId: communityMember.canonicalEntityId,
      communityId: communityMember.communityId,
      level: graphCommunity.level,
    })
    .from(communityMember)
    .innerJoin(graphCommunity, eq(communityMember.communityId, graphCommunity.id))
    .where(
      and(
        eq(communityMember.userId, userId),
        sql`${graphCommunity.level} >= ${COMMUNITY_EVIDENCE_MIN_LEVEL}`,
      ),
    )

  const communitiesByEntity = new Map<string, string[]>()
  for (const m of members) {
    const list = communitiesByEntity.get(m.entityId) ?? []
    list.push(m.communityId)
    communitiesByEntity.set(m.entityId, list)
  }

  const communityFrequency = new Map<string, number>()
  for (const m of members) {
    communityFrequency.set(m.communityId, (communityFrequency.get(m.communityId) ?? 0) + 1)
  }
  const maxCommunityFreq = Math.max(1, ...communityFrequency.values())

  const thoughtLinks = await db
    .select({
      thoughtId: thoughtEntity.thoughtId,
      entityId: thoughtEntity.entityId,
      salience: thoughtEntity.salience,
    })
    .from(thoughtEntity)
    .where(eq(thoughtEntity.userId, userId))

  const featuresByThought = new Map<
    string,
    {
      communityIds: Set<string>
      centralityMax: number
      specificitySum: number
      specificityCount: number
    }
  >()

  for (const link of thoughtLinks) {
    let feat = featuresByThought.get(link.thoughtId)
    if (!feat) {
      feat = {
        communityIds: new Set(),
        centralityMax: 0,
        specificitySum: 0,
        specificityCount: 0,
      }
      featuresByThought.set(link.thoughtId, feat)
    }

    const degree = degreeByEntity.get(link.entityId) ?? 0
    feat.centralityMax = Math.max(feat.centralityMax, degree / maxDegree)

    for (const cid of communitiesByEntity.get(link.entityId) ?? []) {
      feat.communityIds.add(cid)
      const freq = communityFrequency.get(cid) ?? 1
      feat.specificitySum += 1 - freq / maxCommunityFreq
      feat.specificityCount += 1
    }
  }

  const thoughts = await db
    .select({
      id: thought.id,
      createdAt: thought.createdAt,
      normalizedText: thought.normalizedText,
    })
    .from(thought)
    .where(eq(thought.userId, userId))

  let updated = 0
  const samples: { kind: 'thought'; id: string; label: string; note: string }[] = []
  for (const t of thoughts) {
    const feat = featuresByThought.get(t.id)
    const primaryCommunityIds = feat ? [...feat.communityIds].slice(0, 3) : []
    const entityCentralityMax = feat?.centralityMax ?? 0
    const specificityScore =
      feat && feat.specificityCount > 0 ? feat.specificitySum / feat.specificityCount : 0

    await db
      .update(thought)
      .set({
        primaryCommunityIds,
        entityCentralityMax,
        specificityScore,
        recencyBucket: recencyBucket(t.createdAt),
      })
      .where(and(eq(thought.userId, userId), eq(thought.id, t.id)))
    updated++
    if (samples.length < 12) {
      samples.push({
        kind: 'thought',
        id: t.id,
        label: t.normalizedText.trim().replace(/\s+/g, ' ').slice(0, 90),
        note:
          primaryCommunityIds.length > 0
            ? `ranking features · ${primaryCommunityIds.length} communities`
            : 'ranking features · no community yet',
      })
    }
  }

  return { updated, samples, sampleTotal: updated }
}
