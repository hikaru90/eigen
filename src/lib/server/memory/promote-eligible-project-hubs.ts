import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity } from '$lib/server/db/schema';
import { maybePromoteHubToGtdProject } from '$lib/server/memory/maybe-promote-gtd-project';

/** LLM-judge hubs linked from the current thought (no bulk corpus scan). */
export async function evaluateHubsForGtdPromotion(
	userId: string,
	entityIds: string[],
	options?: { forceJudge?: boolean }
): Promise<number> {
	const unique = [...new Set(entityIds)];
	if (unique.length === 0) return 0;

	const rows = await getDb()
		.select({ id: canonicalEntity.id })
		.from(canonicalEntity)
		.where(and(eq(canonicalEntity.userId, userId), inArray(canonicalEntity.id, unique)));

	let promoted = 0;
	for (const row of rows) {
		if (
			await maybePromoteHubToGtdProject({
				userId,
				entityId: row.id,
				source: 'capture',
				forceJudge: options?.forceJudge
			})
		) {
			promoted += 1;
		}
	}
	return promoted;
}

export { auditGtdProjectProfiles } from '$lib/server/memory/judge-gtd-project';
