/**
 * Community detection consolidation job.
 *
 * Fetches entity-entity edges from FalkorDB, runs the Leiden community detection
 * algorithm, then persists:
 *   - graph_community rows (4 levels: L3 leaf → L0 root)
 *   - community_member rows (entity → community membership per level)
 *
 * Should be triggered by the nightly consolidation runner when the entity count
 * has grown by ≥15% since the last run, or ≥24h have passed with new captures.
 *
 * Idempotent: deletes all existing community/member rows for the user before
 * writing new ones. This is safe because downstream community_summary rows are
 * also cascaded when graph_community rows are deleted.
 */

import { eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { graphCommunity, communityMember, canonicalEntity } from '$lib/server/db/schema';
import { fetchEntityEdgesForUser } from '$lib/server/graph/falkor';
import { detectCommunities } from './leiden';

export type CommunityDetectionResult = {
	entityCount: number;
	communityCounts: number[];  // per level, index 0 = L3
	totalCommunities: number;
};

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

	if (nodeIds.length < 2) {
		// Not enough entities for meaningful communities.
		return { entityCount: nodeIds.length, communityCounts: [], totalCommunities: 0 };
	}

	// Load entity-entity edges with weights from FalkorDB.
	const edges = await fetchEntityEdgesForUser({ userId });

	// Run Leiden community detection (4 levels).
	const hierarchy = detectCommunities(nodeIds, edges, 4);

	// Delete existing community data for this user (cascade deletes community_member
	// and community_summary rows via FK cascade).
	await db.delete(graphCommunity).where(eq(graphCommunity.userId, userId));

	// Persist communities and memberships for each level.
	// L3 = level 3 (leaf), L0 = level 0 (root).
	// hierarchy.levels[0] = L3, hierarchy.levels[3] = L0.
	const communityCounts: number[] = [];
	const levelSchemaIndex = [3, 2, 1, 0]; // hierarchy array index → DB level value

	// We need to build parent relationships between levels.
	// communityIdMap: algorithmCommunityKey → DB uuid
	const levelDbIds: Array<Map<string, string>> = [];

	for (let i = 0; i < hierarchy.levels.length; i++) {
		const level = hierarchy.levels[i];
		const dbLevel = levelSchemaIndex[i]; // 3, 2, 1, 0

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
		totalCommunities: communityCounts.reduce((s, n) => s + n, 0)
	};
}

/**
 * Check whether community detection should run for a user.
 * Returns true if:
 *   - No communities exist yet, OR
 *   - Entity count has grown by ≥15% since last detection
 */
export async function shouldRunCommunityDetection(userId: string): Promise<boolean> {
	const db = getDb();

	const [communityCountRow] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId));

	if ((communityCountRow?.n ?? 0) === 0) return true;

	// Check entity count growth.
	const [entityCountRow] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(canonicalEntity)
		.where(eq(canonicalEntity.userId, userId));

	const [lastMemberCountRow] = await db
		.select({ total: sql<number>`sum(member_count)::int` })
		.from(graphCommunity)
		.where(eq(graphCommunity.userId, userId));

	const currentEntities = entityCountRow?.n ?? 0;
	const lastDetectedEntities = lastMemberCountRow?.total ?? 0;

	if (lastDetectedEntities === 0) return true;

	const growthRate = (currentEntities - lastDetectedEntities) / lastDetectedEntities;
	return growthRate >= 0.15;
}
