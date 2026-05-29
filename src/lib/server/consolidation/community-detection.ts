/**
 * Community detection consolidation job.
 *
 * Fetches entity-entity edges from the AGE graph, runs the Leiden community detection
 * algorithm, then persists:
 *   - graph_community rows (4 levels: L3 leaf → L0 root)
 *   - community_member rows (entity → community membership per level)
 *
 * Should be triggered by the nightly consolidation runner on every heartbeat.
 *
 * Idempotent: compares the new Leiden partition to persisted membership and skips
 * DB writes when unchanged (preserving community_summary rows). When the graph
 * changes, deletes all existing community/member rows for the user before writing
 * new ones (community_summary rows cascade via FK).
 */

import { eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { graphCommunity, communityMember, canonicalEntity } from '$lib/server/db/schema';
import { fetchEntityEdgesForUser } from '$lib/server/graph/falkor';
import { detectCommunities, type CommunityHierarchy } from './leiden';

export type CommunityDetectionResult = {
	entityCount: number;
	communityCounts: number[];  // per level, index 0 = L3
	totalCommunities: number;
	/** False when Leiden partition matches persisted membership (no DB rewrite). */
	changed: boolean;
	graphHealth: CommunityGraphHealth;
};

/** DB level values in leaf→root order (matches hierarchy.levels indexing). */
const LEVEL_SCHEMA_INDEX = [3, 2, 1, 0] as const;
const LOW_DENSITY_THRESHOLD = 0.015;
const HIGH_ISOLATION_THRESHOLD = 0.6;
const HIGH_COMPONENT_THRESHOLD = 6;

export type CommunityGraphHealth = {
	edgePolicy: 'entity_relates_only';
	leafLevel: 3;
	rootLevel: 0;
	componentCount: number;
	isolatedNodeCount: number;
	isolatedNodeRatio: number;
	relationEdgeCount: number;
	relationEdgeDensity: number;
	lowConfidence: boolean;
	reasons: string[];
};

function buildGraphHealth(input: {
	nodeIds: string[];
	edges: Array<{ sourceId: string; targetId: string }>;
}): CommunityGraphHealth {
	const neighbors = new Map<string, Set<string>>();
	for (const nodeId of input.nodeIds) {
		neighbors.set(nodeId, new Set<string>());
	}
	for (const edge of input.edges) {
		if (edge.sourceId === edge.targetId) continue;
		const source = neighbors.get(edge.sourceId);
		const target = neighbors.get(edge.targetId);
		if (!source || !target) continue;
		source.add(edge.targetId);
		target.add(edge.sourceId);
	}

	let isolatedNodeCount = 0;
	for (const nodeId of input.nodeIds) {
		if ((neighbors.get(nodeId)?.size ?? 0) === 0) isolatedNodeCount++;
	}

	const visited = new Set<string>();
	let componentCount = 0;
	for (const nodeId of input.nodeIds) {
		if (visited.has(nodeId)) continue;
		componentCount++;
		const queue: string[] = [nodeId];
		visited.add(nodeId);
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) continue;
			for (const next of neighbors.get(current) ?? []) {
				if (visited.has(next)) continue;
				visited.add(next);
				queue.push(next);
			}
		}
	}

	const nodeCount = input.nodeIds.length;
	const relationEdgeCount = input.edges.length;
	const possibleEdgeCount = nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 1;
	const relationEdgeDensity = relationEdgeCount / possibleEdgeCount;
	const isolatedNodeRatio = nodeCount > 0 ? isolatedNodeCount / nodeCount : 0;
	const reasons: string[] = [];
	if (relationEdgeDensity < LOW_DENSITY_THRESHOLD) {
		reasons.push(`low relation density (${relationEdgeDensity.toFixed(4)})`);
	}
	if (isolatedNodeRatio > HIGH_ISOLATION_THRESHOLD) {
		reasons.push(`high isolation (${Math.round(isolatedNodeRatio * 100)}%)`);
	}
	if (componentCount > HIGH_COMPONENT_THRESHOLD) {
		reasons.push(`many disconnected components (${componentCount})`);
	}

	return {
		edgePolicy: 'entity_relates_only',
		leafLevel: 3,
		rootLevel: 0,
		componentCount,
		isolatedNodeCount,
		isolatedNodeRatio,
		relationEdgeCount,
		relationEdgeDensity,
		lowConfidence: reasons.length > 0,
		reasons
	};
}

function buildMembershipFingerprint(
	byLevel: Map<number, Map<string, Set<string>>>
): string {
	const parts: string[] = [];
	for (const dbLevel of [...byLevel.keys()].sort((a, b) => b - a)) {
		const commMap = byLevel.get(dbLevel)!;
		const entityAssignments: string[] = [];
		for (const members of commMap.values()) {
			const signature = [...members].sort().join(',');
			for (const entityId of members) {
				entityAssignments.push(`${entityId}=${signature}`);
			}
		}
		entityAssignments.sort();
		parts.push(`L${dbLevel}:${entityAssignments.join('|')}`);
	}
	return parts.join('\n');
}

function buildHierarchyFingerprint(hierarchy: CommunityHierarchy): string {
	const byLevel = new Map<number, Map<string, Set<string>>>();
	for (let i = 0; i < hierarchy.levels.length; i++) {
		const level = hierarchy.levels[i];
		const dbLevel = LEVEL_SCHEMA_INDEX[i];
		const levelMap = new Map<string, Set<string>>();
		for (const [commKey, members] of level.communities) {
			levelMap.set(commKey, new Set(members));
		}
		byLevel.set(dbLevel, levelMap);
	}
	return buildMembershipFingerprint(byLevel);
}

async function loadStoredMembershipFingerprint(userId: string): Promise<string | null> {
	const db = getDb();
	const rows = await db
		.select({
			level: graphCommunity.level,
			entityId: communityMember.canonicalEntityId,
			communityId: communityMember.communityId
		})
		.from(communityMember)
		.innerJoin(graphCommunity, eq(communityMember.communityId, graphCommunity.id))
		.where(eq(communityMember.userId, userId));

	if (rows.length === 0) return null;

	const byLevel = new Map<number, Map<string, Set<string>>>();
	for (const row of rows) {
		if (!byLevel.has(row.level)) byLevel.set(row.level, new Map());
		const levelMap = byLevel.get(row.level)!;
		if (!levelMap.has(row.communityId)) levelMap.set(row.communityId, new Set());
		levelMap.get(row.communityId)!.add(row.entityId);
	}
	return buildMembershipFingerprint(byLevel);
}

async function loadStoredCommunityCounts(userId: string): Promise<number[]> {
	const db = getDb();
	const rows = await db
		.select({
			level: graphCommunity.level,
			n: sql<number>`count(*)::int`
		})
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId))
		.groupBy(graphCommunity.level);

	const countsByLevel = new Map(rows.map((row) => [row.level, row.n]));
	return LEVEL_SCHEMA_INDEX.map((level) => countsByLevel.get(level) ?? 0);
}

/**
 * Run community detection for a user and persist results.
 * Returns detection statistics.
 *
 * Throws on DB or graph errors (caller should catch and log).
 */
export async function runCommunityDetection(userId: string): Promise<CommunityDetectionResult> {
	const db = getDb();

	// Load all canonical entities for this user.
	const entities = await db
		.select({ id: canonicalEntity.id })
		.from(canonicalEntity)
		.where(eq(canonicalEntity.userId, userId));

	const nodeIds = entities.map((e) => e.id);
	const emptyHealth: CommunityGraphHealth = {
		edgePolicy: 'entity_relates_only',
		leafLevel: 3,
		rootLevel: 0,
		componentCount: nodeIds.length > 0 ? nodeIds.length : 0,
		isolatedNodeCount: nodeIds.length,
		isolatedNodeRatio: nodeIds.length > 0 ? 1 : 0,
		relationEdgeCount: 0,
		relationEdgeDensity: 0,
		lowConfidence: nodeIds.length > 0,
		reasons: nodeIds.length > 0 ? ['insufficient relation edges'] : []
	};

	if (nodeIds.length < 2) {
		// Not enough entities for meaningful communities.
		const storedFingerprint = await loadStoredMembershipFingerprint(userId);
		const changed = storedFingerprint !== null;
		if (changed) {
			await db.delete(graphCommunity).where(eq(graphCommunity.userId, userId));
		}
		return {
			entityCount: nodeIds.length,
			communityCounts: [],
			totalCommunities: 0,
			changed,
			graphHealth: emptyHealth
		};
	}

	// Load entity-entity edges with weights from the AGE graph.
	const edges = await fetchEntityEdgesForUser({ userId });
	const graphHealth = buildGraphHealth({ nodeIds, edges });

	// Run Leiden community detection (4 levels).
	const hierarchy = detectCommunities(nodeIds, edges, 4);
	const nextFingerprint = buildHierarchyFingerprint(hierarchy);
	const storedFingerprint = await loadStoredMembershipFingerprint(userId);

	if (storedFingerprint !== null && storedFingerprint === nextFingerprint) {
		const communityCounts = await loadStoredCommunityCounts(userId);
		return {
			entityCount: nodeIds.length,
			communityCounts,
			totalCommunities: communityCounts.reduce((s, n) => s + n, 0),
			changed: false,
			graphHealth
		};
	}

	// Delete existing community data for this user (cascade deletes community_member
	// and community_summary rows via FK cascade).
	await db.delete(graphCommunity).where(eq(graphCommunity.userId, userId));

	// Persist communities and memberships for each level.
	// L3 = level 3 (leaf), L0 = level 0 (root).
	// hierarchy.levels[0] = L3, hierarchy.levels[3] = L0.
	const communityCounts: number[] = [];

	// We need to build parent relationships between levels.
	// communityIdMap: algorithmCommunityKey → DB uuid
	const levelDbIds: Array<Map<string, string>> = [];

	for (let i = 0; i < hierarchy.levels.length; i++) {
		const level = hierarchy.levels[i];
		const dbLevel = LEVEL_SCHEMA_INDEX[i]; // 3, 2, 1, 0

		// Determine parent community UUIDs from level i+1 (coarser).
		// The "parent" of a community at level i is the community that the same
		// nodes map to at level i+1.
		const parentDbIdMap = i < hierarchy.levels.length - 1 ? levelDbIds[i + 1] : undefined;

		const communityDbIdMap = new Map<string, string>();
		const uniqueComms = [...level.communities.keys()];
		communityCounts.push(uniqueComms.length);

		// Batch insert graph_community rows.
		for (const commKey of uniqueComms) {
			const members = level.communities.get(commKey)!;

			// Find parent community: look up any member at level i+1.
			let parentCommunityId: string | null = null;
			if (parentDbIdMap) {
				const parentLevel = hierarchy.levels[i + 1];
				const anyMember = [...members][0];
				if (anyMember) {
					const parentKey = parentLevel.membership.get(anyMember);
					if (parentKey) parentCommunityId = parentDbIdMap.get(parentKey) ?? null;
				}
			}

			const [inserted] = await db
				.insert(graphCommunity)
				.values({
					userId,
					level: dbLevel,
					parentCommunityId: parentCommunityId ?? undefined,
					memberCount: members.size
				})
				.returning({ id: graphCommunity.id });

			communityDbIdMap.set(commKey, inserted.id);
		}

		levelDbIds[i] = communityDbIdMap;

		// Batch insert community_member rows.
		const memberRows: Array<{ communityId: string; canonicalEntityId: string; userId: string }> = [];
		for (const [commKey, members] of level.communities) {
			const communityId = communityDbIdMap.get(commKey)!;
			for (const entityId of members) {
				memberRows.push({ communityId, canonicalEntityId: entityId, userId });
			}
		}

		if (memberRows.length > 0) {
			// Insert in chunks to avoid hitting prepared statement limits.
			const CHUNK = 500;
			for (let j = 0; j < memberRows.length; j += CHUNK) {
				await db.insert(communityMember).values(memberRows.slice(j, j + CHUNK));
			}
		}
	}

	return {
		entityCount: nodeIds.length,
		communityCounts,
		totalCommunities: communityCounts.reduce((s, n) => s + n, 0),
		changed: true,
		graphHealth
	};
}
