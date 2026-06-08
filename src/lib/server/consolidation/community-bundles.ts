/**
 * Build materialized community bundles for zero-traversal retrieval.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	canonicalEntity,
	communityBundle,
	communityMember,
	graphCommunity,
	thought,
	thoughtEntity
} from '$lib/server/db/schema';
import { COMMUNITY_MID_LEVEL } from './community-levels';

const TOP_THOUGHTS_PER_COMMUNITY = 20;
const TOP_ENTITIES_PER_COMMUNITY = 10;

export type CommunityBundleBuildResult = {
	built: number;
	skipped: number;
};

/** Thoughts mentioning member entities, ranked by salience + recency. */
export async function loadCommunityThoughtIds(
	userId: string,
	communityId: string,
	limit = TOP_THOUGHTS_PER_COMMUNITY
): Promise<string[]> {
	const db = getDb();
	const memberEntityIds = await db
		.select({ entityId: communityMember.canonicalEntityId })
		.from(communityMember)
		.where(
			and(eq(communityMember.userId, userId), eq(communityMember.communityId, communityId))
		);

	const entityIds = memberEntityIds.map((r) => r.entityId);
	if (entityIds.length === 0) return [];

	const rows = await db
		.select({
			thoughtId: thoughtEntity.thoughtId,
			salience: thoughtEntity.salience,
			createdAt: thought.createdAt
		})
		.from(thoughtEntity)
		.innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
		.where(
			and(eq(thoughtEntity.userId, userId), inArray(thoughtEntity.entityId, entityIds))
		)
		.orderBy(
			sql`${thoughtEntity.salience} DESC`,
			sql`${thought.createdAt} DESC`
		)
		.limit(limit * 2);

	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const row of rows) {
		if (seen.has(row.thoughtId)) continue;
		seen.add(row.thoughtId);
		ordered.push(row.thoughtId);
		if (ordered.length >= limit) break;
	}
	return ordered;
}

async function loadTopEntityIds(userId: string, communityId: string): Promise<string[]> {
	const db = getDb();
	const rows = await db
		.select({ entityId: communityMember.canonicalEntityId })
		.from(communityMember)
		.innerJoin(canonicalEntity, eq(communityMember.canonicalEntityId, canonicalEntity.id))
		.where(
			and(eq(communityMember.userId, userId), eq(communityMember.communityId, communityId))
		)
		.limit(TOP_ENTITIES_PER_COMMUNITY);
	return rows.map((r) => r.entityId);
}

/** Sibling communities sharing the same parent (adjacency for bundle payload). */
async function loadAdjacentCommunityIds(
	userId: string,
	communityId: string,
	parentCommunityId: string | null
): Promise<string[]> {
	if (!parentCommunityId) return [];
	const db = getDb();
	const rows = await db
		.select({ id: graphCommunity.id })
		.from(graphCommunity)
		.where(
			and(
				eq(graphCommunity.userId, userId),
				eq(graphCommunity.parentCommunityId, parentCommunityId),
				sql`${graphCommunity.id} <> ${communityId}`
			)
		)
		.limit(8);
	return rows.map((r) => r.id);
}

/** Build or refresh bundle for one community. */
export async function buildCommunityBundle(
	userId: string,
	communityId: string
): Promise<boolean> {
	const db = getDb();
	const [community] = await db
		.select({
			id: graphCommunity.id,
			level: graphCommunity.level,
			parentCommunityId: graphCommunity.parentCommunityId,
			memberCount: graphCommunity.memberCount
		})
		.from(graphCommunity)
		.where(and(eq(graphCommunity.userId, userId), eq(graphCommunity.id, communityId)))
		.limit(1);

	if (!community) return false;

	const [topThoughtIds, topEntityIds, adjacentCommunityIds] = await Promise.all([
		loadCommunityThoughtIds(userId, communityId),
		loadTopEntityIds(userId, communityId),
		loadAdjacentCommunityIds(userId, communityId, community.parentCommunityId)
	]);

	await db
		.insert(communityBundle)
		.values({
			communityId,
			userId,
			level: community.level,
			topThoughtIds,
			topEntityIds,
			adjacentCommunityIds,
			payload: {
				memberCount: community.memberCount,
				thoughtCount: topThoughtIds.length
			}
		})
		.onConflictDoUpdate({
			target: communityBundle.communityId,
			set: {
				level: community.level,
				topThoughtIds,
				topEntityIds,
				adjacentCommunityIds,
				payload: {
					memberCount: community.memberCount,
					thoughtCount: topThoughtIds.length
				},
				updatedAt: sql`now()`
			}
		});

	return true;
}

/** Build bundles for all communities at domain + leaf levels (L1–L2). */
export async function buildAllCommunityBundles(userId: string): Promise<CommunityBundleBuildResult> {
	const db = getDb();
	const communities = await db
		.select({ id: graphCommunity.id })
		.from(graphCommunity)
		.where(
			and(eq(graphCommunity.userId, userId), sql`${graphCommunity.level} >= ${COMMUNITY_MID_LEVEL}`)
		);

	let built = 0;
	let skipped = 0;
	for (const c of communities) {
		const ok = await buildCommunityBundle(userId, c.id);
		if (ok) built++;
		else skipped++;
	}
	return { built, skipped };
}
