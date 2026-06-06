/**
 * Removes canonical entities (and AGE vertices) that no longer link to any thought.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, thoughtEntity } from '$lib/server/db/schema';
import { pruneCanonicalEntitiesWithNoThoughtLinks } from '$lib/server/memory/canonical-entity-admin';

export type PruneOrphanEntityNodesResult = {
	graphEntities: number;
	orphanEntities: number;
	removed: number;
};

export async function pruneOrphanEntityNodesForUser(
	userId: string
): Promise<PruneOrphanEntityNodesResult> {
	const allRows = await getDb()
		.select({ id: canonicalEntity.id })
		.from(canonicalEntity)
		.where(eq(canonicalEntity.userId, userId));

	if (allRows.length === 0) {
		return { graphEntities: 0, orphanEntities: 0, removed: 0 };
	}

	const candidateEntityIds = allRows.map((row) => row.id);
	const linkedRows = await getDb()
		.selectDistinct({ entityId: thoughtEntity.entityId })
		.from(thoughtEntity)
		.where(and(eq(thoughtEntity.userId, userId), inArray(thoughtEntity.entityId, candidateEntityIds)));
	const linkedSet = new Set(linkedRows.map((row) => row.entityId));
	const orphanEntityIds = candidateEntityIds.filter((entityId) => !linkedSet.has(entityId));
	const removed =
		orphanEntityIds.length > 0
			? await pruneCanonicalEntitiesWithNoThoughtLinks(userId, orphanEntityIds)
			: 0;

	return {
		graphEntities: allRows.length,
		orphanEntities: orphanEntityIds.length,
		removed
	};
}
