/**
 * Removes Thought nodes that still exist in AGE but no longer exist in Postgres.
 * These orphans can produce phantom co_mention edges in graph visualization.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { deleteThoughtVertexFromGraph, fetchThoughtNodeIdsForUser } from '$lib/server/graph/age';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PruneOrphanThoughtNodesResult = {
	graphThoughts: number;
	orphanThoughts: number;
	removed: number;
};

function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

export async function pruneOrphanThoughtNodesForUser(
	userId: string
): Promise<PruneOrphanThoughtNodesResult> {
	const graphThoughtIds = await fetchThoughtNodeIdsForUser({ userId });
	if (graphThoughtIds.length === 0) {
		return { graphThoughts: 0, orphanThoughts: 0, removed: 0 };
	}

	const validUuidThoughtIds = graphThoughtIds.filter(isUuid);
	const existingRows =
		validUuidThoughtIds.length > 0
			? await getDb()
					.select({ id: thought.id })
					.from(thought)
					.where(and(eq(thought.userId, userId), inArray(thought.id, validUuidThoughtIds)))
			: [];
	const existingThoughtIdSet = new Set(existingRows.map((row) => row.id));

	const orphanThoughtIds = graphThoughtIds.filter(
		thoughtId => !isUuid(thoughtId) || !existingThoughtIdSet.has(thoughtId)
	);
	let removed = 0;
	for (const thoughtId of orphanThoughtIds) {
		await deleteThoughtVertexFromGraph({ userId, thoughtId });
		removed++;
	}

	return {
		graphThoughts: graphThoughtIds.length,
		orphanThoughts: orphanThoughtIds.length,
		removed
	};
}
