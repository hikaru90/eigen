/**
 * Incremental community/bundle refresh after enrich — not only nightly cron.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	communityMember,
	communitySummary,
	graphCommunity,
	thoughtEntity
} from '$lib/server/db/schema';
import { buildCommunityBundle } from './community-bundles';
import { runCommunitySummaryGeneration } from './community-summaries';

const MEMBERSHIP_CHURN_THRESHOLD = 0.1;

/** Mark communities containing entities linked to this thought as dirty. */
export async function markCommunitiesDirtyForThought(
	userId: string,
	thoughtId: string
): Promise<string[]> {
	const db = getDb();
	const entityRows = await db
		.select({ entityId: thoughtEntity.entityId })
		.from(thoughtEntity)
		.where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, thoughtId)));

	const entityIds = entityRows.map((r) => r.entityId);
	if (entityIds.length === 0) return [];

	const communityRows = await db
		.select({ communityId: communityMember.communityId })
		.from(communityMember)
		.where(
			and(
				eq(communityMember.userId, userId),
				inArray(communityMember.canonicalEntityId, entityIds)
			)
		);

	const communityIds = [...new Set(communityRows.map((r) => r.communityId))];
	if (communityIds.length === 0) return [];

	await db
		.update(graphCommunity)
		.set({ dirtyAt: sql`now()` })
		.where(
			and(eq(graphCommunity.userId, userId), inArray(graphCommunity.id, communityIds))
		);

	return communityIds;
}

/** Refresh bundles (and summaries if stale) for dirty communities. Fire-and-forget safe. */
export async function refreshDirtyCommunitiesForUser(userId: string): Promise<{
	bundlesRefreshed: number;
	summariesTriggered: boolean;
}> {
	const db = getDb();
	const dirty = await db
		.select({
			id: graphCommunity.id,
			memberCount: graphCommunity.memberCount,
			level: graphCommunity.level
		})
		.from(graphCommunity)
		.where(
			and(eq(graphCommunity.userId, userId), sql`${graphCommunity.dirtyAt} IS NOT NULL`)
		)
		.limit(50);

	if (dirty.length === 0) {
		return { bundlesRefreshed: 0, summariesTriggered: false };
	}

	let bundlesRefreshed = 0;
	let needsSummaryRefresh = false;

	for (const community of dirty) {
		const built = await buildCommunityBundle(userId, community.id);
		if (built) bundlesRefreshed++;

		const [summary] = await db
			.select({
				entityCount: communitySummary.entityCount,
				thoughtCount: communitySummary.thoughtCount,
				generatedAt: communitySummary.generatedAt
			})
			.from(communitySummary)
			.where(eq(communitySummary.communityId, community.id))
			.limit(1);

		if (!summary) {
			needsSummaryRefresh = true;
			continue;
		}

		const entityChurn =
			summary.entityCount > 0
				? Math.abs(community.memberCount - summary.entityCount) / summary.entityCount
				: 1;
		if (entityChurn >= MEMBERSHIP_CHURN_THRESHOLD) {
			needsSummaryRefresh = true;
			await db
				.delete(communitySummary)
				.where(
					and(
						eq(communitySummary.userId, userId),
						eq(communitySummary.communityId, community.id)
					)
				);
		}
	}

	if (needsSummaryRefresh) {
		await runCommunitySummaryGeneration(userId, { batchSize: 10 });
	}

	await db
		.update(graphCommunity)
		.set({ dirtyAt: null })
		.where(
			and(
				eq(graphCommunity.userId, userId),
				inArray(
					graphCommunity.id,
					dirty.map((d) => d.id)
				)
			)
		);

	return { bundlesRefreshed, summariesTriggered: needsSummaryRefresh };
}

/** Schedule incremental refresh after enrich (non-blocking). */
export function scheduleIncrementalConsolidation(userId: string, thoughtId: string): void {
	void (async () => {
		try {
			await markCommunitiesDirtyForThought(userId, thoughtId);
			await refreshDirtyCommunitiesForUser(userId);
		} catch (err) {
			console.warn('[incremental-consolidation] refresh failed', {
				userId,
				thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	})();
}
