/**
 * Community detection consolidation job.
 *
 * Fetches entity-entity edges from the AGE graph, runs Leiden community detection,
 * then persists graph_community + community_member rows.
 *
 * Idempotent: skips DB writes when the full membership fingerprint is unchanged.
 * On change, diffs member sets by (level, sorted members) and reuses stable
 * community IDs so summaries/bundles for unchanged clusters survive.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { HeartbeatJobSample } from '$lib/consolidation/heartbeat-job-report'
import { getDb } from '$lib/server/db'
import { graphCommunity, communityMember, canonicalEntity } from '$lib/server/db/schema'
import { fetchEntityEdgesForUser } from '$lib/server/graph/age'
import {
  COMMUNITY_HIERARCHY_DEPTH,
  COMMUNITY_LEAF_LEVEL,
  COMMUNITY_LEVEL_SCHEMA,
  COMMUNITY_ROOT_LEVEL,
} from './community-levels'
import { loadLargestCommunitySamples } from './heartbeat-change-samples'
import { detectCommunities, type CommunityHierarchy } from './leiden'

export type CommunityDetectionResult = {
  entityCount: number
  communityCounts: number[]
  totalCommunities: number
  /** False when Leiden partition matches persisted membership (no DB rewrite). */
  changed: boolean
  graphHealth: CommunityGraphHealth
  samples: import('$lib/consolidation/heartbeat-job-report').HeartbeatJobSample[]
  sampleTotal: number
}

/** DB level values in leaf→root order (matches hierarchy.levels indexing). */
const LEVEL_SCHEMA_INDEX = COMMUNITY_LEVEL_SCHEMA
const LOW_DENSITY_THRESHOLD = 0.015
const HIGH_ISOLATION_THRESHOLD = 0.6
const HIGH_COMPONENT_THRESHOLD = 6

export type CommunityGraphHealth = {
  edgePolicy: 'entity_relates_only'
  leafLevel: typeof COMMUNITY_LEAF_LEVEL
  rootLevel: typeof COMMUNITY_ROOT_LEVEL
  componentCount: number
  isolatedNodeCount: number
  isolatedNodeRatio: number
  relationEdgeCount: number
  relationEdgeDensity: number
  lowConfidence: boolean
  reasons: string[]
}

/** Canonical key for matching communities across detection runs. */
export function buildMemberSignature(memberIds: Iterable<string>): string {
  return [...memberIds].sort().join(',')
}

export function buildCommunitySignature(dbLevel: number, memberIds: Iterable<string>): string {
  return `L${dbLevel}:${buildMemberSignature(memberIds)}`
}

function buildGraphHealth(input: {
  nodeIds: string[]
  edges: Array<{ sourceId: string; targetId: string }>
}): CommunityGraphHealth {
  const neighbors = new Map<string, Set<string>>()
  for (const nodeId of input.nodeIds) {
    neighbors.set(nodeId, new Set<string>())
  }
  for (const edge of input.edges) {
    if (edge.sourceId === edge.targetId) continue
    const source = neighbors.get(edge.sourceId)
    const target = neighbors.get(edge.targetId)
    if (!source || !target) continue
    source.add(edge.targetId)
    target.add(edge.sourceId)
  }

  let isolatedNodeCount = 0
  for (const nodeId of input.nodeIds) {
    if ((neighbors.get(nodeId)?.size ?? 0) === 0) isolatedNodeCount++
  }

  const visited = new Set<string>()
  let componentCount = 0
  for (const nodeId of input.nodeIds) {
    if (visited.has(nodeId)) continue
    componentCount++
    const queue: string[] = [nodeId]
    visited.add(nodeId)
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      for (const next of neighbors.get(current) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
  }

  const nodeCount = input.nodeIds.length
  const relationEdgeCount = input.edges.length
  const possibleEdgeCount = nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 1
  const relationEdgeDensity = relationEdgeCount / possibleEdgeCount
  const isolatedNodeRatio = nodeCount > 0 ? isolatedNodeCount / nodeCount : 0
  const reasons: string[] = []
  if (relationEdgeDensity < LOW_DENSITY_THRESHOLD) {
    reasons.push(`low relation density (${relationEdgeDensity.toFixed(4)})`)
  }
  if (isolatedNodeRatio > HIGH_ISOLATION_THRESHOLD) {
    reasons.push(`high isolation (${Math.round(isolatedNodeRatio * 100)}%)`)
  }
  if (componentCount > HIGH_COMPONENT_THRESHOLD) {
    reasons.push(`many disconnected components (${componentCount})`)
  }

  return {
    edgePolicy: 'entity_relates_only',
    leafLevel: COMMUNITY_LEAF_LEVEL,
    rootLevel: COMMUNITY_ROOT_LEVEL,
    componentCount,
    isolatedNodeCount,
    isolatedNodeRatio,
    relationEdgeCount,
    relationEdgeDensity,
    lowConfidence: reasons.length > 0,
    reasons,
  }
}

function buildMembershipFingerprint(byLevel: Map<number, Map<string, Set<string>>>): string {
  const parts: string[] = []
  for (const dbLevel of [...byLevel.keys()].sort((a, b) => b - a)) {
    const commMap = byLevel.get(dbLevel)!
    const entityAssignments: string[] = []
    for (const members of commMap.values()) {
      const signature = buildMemberSignature(members)
      for (const entityId of members) {
        entityAssignments.push(`${entityId}=${signature}`)
      }
    }
    entityAssignments.sort()
    parts.push(`L${dbLevel}:${entityAssignments.join('|')}`)
  }
  return parts.join('\n')
}

function buildHierarchyFingerprint(hierarchy: CommunityHierarchy): string {
  const byLevel = new Map<number, Map<string, Set<string>>>()
  for (let i = 0; i < hierarchy.levels.length; i++) {
    const level = hierarchy.levels[i]
    const dbLevel = LEVEL_SCHEMA_INDEX[i]
    const levelMap = new Map<string, Set<string>>()
    for (const [, members] of level.communities) {
      const signature = buildMemberSignature(members)
      levelMap.set(signature, new Set(members))
    }
    byLevel.set(dbLevel, levelMap)
  }
  return buildMembershipFingerprint(byLevel)
}

async function loadStoredMembershipFingerprint(userId: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({
      level: graphCommunity.level,
      entityId: communityMember.canonicalEntityId,
      communityId: communityMember.communityId,
    })
    .from(communityMember)
    .innerJoin(graphCommunity, eq(communityMember.communityId, graphCommunity.id))
    .where(eq(communityMember.userId, userId))

  if (rows.length === 0) return null

  const byLevel = new Map<number, Map<string, Set<string>>>()
  for (const row of rows) {
    if (!byLevel.has(row.level)) byLevel.set(row.level, new Map())
    const levelMap = byLevel.get(row.level)!
    if (!levelMap.has(row.communityId)) levelMap.set(row.communityId, new Set())
    levelMap.get(row.communityId)!.add(row.entityId)
  }
  return buildMembershipFingerprint(byLevel)
}

async function loadStoredCommunityCounts(userId: string): Promise<number[]> {
  const db = getDb()
  const rows = await db
    .select({
      level: graphCommunity.level,
      n: sql<number>`count(*)::int`,
    })
    .from(graphCommunity)
    .where(eq(graphCommunity.userId, userId))
    .groupBy(graphCommunity.level)

  const countsByLevel = new Map(rows.map((row) => [row.level, row.n]))
  return LEVEL_SCHEMA_INDEX.map((level) => countsByLevel.get(level) ?? 0)
}

type StoredCommunity = {
  id: string
  level: number
  signature: string
  memberIds: Set<string>
}

async function loadStoredCommunities(userId: string): Promise<StoredCommunity[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: graphCommunity.id,
      level: graphCommunity.level,
      entityId: communityMember.canonicalEntityId,
    })
    .from(graphCommunity)
    .leftJoin(communityMember, eq(communityMember.communityId, graphCommunity.id))
    .where(eq(graphCommunity.userId, userId))

  const byId = new Map<string, StoredCommunity>()
  for (const row of rows) {
    let entry = byId.get(row.id)
    if (!entry) {
      entry = { id: row.id, level: row.level, signature: '', memberIds: new Set() }
      byId.set(row.id, entry)
    }
    if (row.entityId) entry.memberIds.add(row.entityId)
  }

  for (const entry of byId.values()) {
    entry.signature = buildCommunitySignature(entry.level, entry.memberIds)
  }
  return [...byId.values()]
}

type NextCommunity = {
  commKey: string
  dbLevel: number
  members: Set<string>
  signature: string
  parentCommKey: string | null
}

function flattenHierarchy(hierarchy: CommunityHierarchy): NextCommunity[] {
  const result: NextCommunity[] = []
  for (let i = 0; i < hierarchy.levels.length; i++) {
    const level = hierarchy.levels[i]
    const dbLevel = LEVEL_SCHEMA_INDEX[i]
    const parentLevel = i < hierarchy.levels.length - 1 ? hierarchy.levels[i + 1] : null

    for (const [commKey, members] of level.communities) {
      let parentCommKey: string | null = null
      if (parentLevel) {
        const anyMember = [...members][0]
        if (anyMember) {
          parentCommKey = parentLevel.membership.get(anyMember) ?? null
        }
      }
      result.push({
        commKey,
        dbLevel,
        members,
        signature: buildCommunitySignature(dbLevel, members),
        parentCommKey,
      })
    }
  }
  return result
}

async function persistCommunityDiff(
  userId: string,
  hierarchy: CommunityHierarchy,
): Promise<number[]> {
  const db = getDb()
  const nextCommunities = flattenHierarchy(hierarchy)
  const stored = await loadStoredCommunities(userId)
  const signatureToStoredId = new Map(stored.map((row) => [row.signature, row.id]))

  return db.transaction(async (tx) => {
    const commKeyToId = new Map<string, string>()
    const reusedIds = new Set<string>()
    const newCommunityIds: string[] = []

    // Root → leaf so parent IDs exist before children are linked.
    const sorted = [...nextCommunities].sort((a, b) => a.dbLevel - b.dbLevel)

    for (const community of sorted) {
      const existingId = signatureToStoredId.get(community.signature)
      if (existingId) {
        commKeyToId.set(community.commKey, existingId)
        reusedIds.add(existingId)
      } else {
        const [inserted] = await tx
          .insert(graphCommunity)
          .values({
            userId,
            level: community.dbLevel,
            memberCount: community.members.size,
          })
          .returning({ id: graphCommunity.id })
        commKeyToId.set(community.commKey, inserted.id)
        newCommunityIds.push(inserted.id)

        const memberRows = [...community.members].map((entityId) => ({
          communityId: inserted.id,
          canonicalEntityId: entityId,
          userId,
        }))
        if (memberRows.length > 0) {
          const CHUNK = 500
          for (let j = 0; j < memberRows.length; j += CHUNK) {
            await tx.insert(communityMember).values(memberRows.slice(j, j + CHUNK))
          }
        }
      }
    }

    for (const community of sorted) {
      const communityId = commKeyToId.get(community.commKey)
      if (!communityId) continue
      const parentCommunityId =
        community.parentCommKey !== null ? (commKeyToId.get(community.parentCommKey) ?? null) : null
      await tx
        .update(graphCommunity)
        .set({
          parentCommunityId,
          memberCount: community.members.size,
          updatedAt: sql`now()`,
        })
        .where(and(eq(graphCommunity.id, communityId), eq(graphCommunity.userId, userId)))
    }

    const obsoleteIds = stored
      .map((row) => row.id)
      .filter((id) => !reusedIds.has(id) && !newCommunityIds.includes(id))

    if (obsoleteIds.length > 0) {
      await tx
        .delete(graphCommunity)
        .where(and(eq(graphCommunity.userId, userId), inArray(graphCommunity.id, obsoleteIds)))
    }

    const countsByLevel = new Map<number, number>()
    for (const community of nextCommunities) {
      countsByLevel.set(community.dbLevel, (countsByLevel.get(community.dbLevel) ?? 0) + 1)
    }
    return LEVEL_SCHEMA_INDEX.map((level) => countsByLevel.get(level) ?? 0)
  })
}

/**
 * Run community detection for a user and persist results.
 */
export async function runCommunityDetection(userId: string): Promise<CommunityDetectionResult> {
  const db = getDb()

  const entities = await db
    .select({ id: canonicalEntity.id })
    .from(canonicalEntity)
    .where(eq(canonicalEntity.userId, userId))

  const nodeIds = entities.map((e) => e.id)
  const emptyHealth: CommunityGraphHealth = {
    edgePolicy: 'entity_relates_only',
    leafLevel: COMMUNITY_LEAF_LEVEL,
    rootLevel: COMMUNITY_ROOT_LEVEL,
    componentCount: nodeIds.length > 0 ? nodeIds.length : 0,
    isolatedNodeCount: nodeIds.length,
    isolatedNodeRatio: nodeIds.length > 0 ? 1 : 0,
    relationEdgeCount: 0,
    relationEdgeDensity: 0,
    lowConfidence: nodeIds.length > 0,
    reasons: nodeIds.length > 0 ? ['insufficient relation edges'] : [],
  }

  async function withSamples(
    base: Omit<CommunityDetectionResult, 'samples' | 'sampleTotal'>,
  ): Promise<CommunityDetectionResult> {
    const healthNotes: HeartbeatJobSample[] = base.graphHealth.reasons.map((reason) => ({
      kind: 'note',
      label: reason,
      note: 'graph health signal',
    }))
    const communities = await loadLargestCommunitySamples(userId).catch(() => [])
    const samples = [...healthNotes, ...communities].slice(0, 12)
    return {
      ...base,
      samples,
      sampleTotal: healthNotes.length + communities.length,
    }
  }

  if (nodeIds.length < 2) {
    const storedFingerprint = await loadStoredMembershipFingerprint(userId)
    const changed = storedFingerprint !== null
    if (changed) {
      await db.delete(graphCommunity).where(eq(graphCommunity.userId, userId))
    }
    return withSamples({
      entityCount: nodeIds.length,
      communityCounts: [],
      totalCommunities: 0,
      changed,
      graphHealth: emptyHealth,
    })
  }

  const edges = await fetchEntityEdgesForUser({ userId })
  const graphHealth = buildGraphHealth({ nodeIds, edges })

  const hierarchy = detectCommunities(nodeIds, edges, COMMUNITY_HIERARCHY_DEPTH)
  const nextFingerprint = buildHierarchyFingerprint(hierarchy)
  const storedFingerprint = await loadStoredMembershipFingerprint(userId)

  if (storedFingerprint !== null && storedFingerprint === nextFingerprint) {
    const communityCounts = await loadStoredCommunityCounts(userId)
    return withSamples({
      entityCount: nodeIds.length,
      communityCounts,
      totalCommunities: communityCounts.reduce((s, n) => s + n, 0),
      changed: false,
      graphHealth,
    })
  }

  const communityCounts = await persistCommunityDiff(userId, hierarchy)

  return withSamples({
    entityCount: nodeIds.length,
    communityCounts,
    totalCommunities: communityCounts.reduce((s, n) => s + n, 0),
    changed: true,
    graphHealth,
  })
}
