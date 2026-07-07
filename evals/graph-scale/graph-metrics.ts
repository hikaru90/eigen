import { count, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import type { AppDatabase } from '$lib/server/db';
import { canonicalEntity, graphCommunity, thought } from '$lib/server/db/schema';
import { fetchEntityEdgesForUser } from '$lib/server/graph/age';

export type GraphScaleMetrics = {
	thoughts: number;
	entities: number;
	edges: number;
	communities: number;
	projects: number;
};

export function emptyGraphScaleMetrics(): GraphScaleMetrics {
	return { thoughts: 0, entities: 0, edges: 0, communities: 0, projects: 0 };
}

/** Count thoughts, entities, AGE entity_relates edges, communities, and GTD projects for a tenant. */
export async function collectGraphScaleMetrics(
	userId: string,
	db?: AppDatabase
): Promise<GraphScaleMetrics> {
	const database = db ?? getDb();

	const [thoughtRow, entityRow, communityRow, projectRow, entityEdges] = await Promise.all([
		database
			.select({ n: count() })
			.from(thought)
			.where(eq(thought.userId, userId)),
		database
			.select({ n: count() })
			.from(canonicalEntity)
			.where(eq(canonicalEntity.userId, userId)),
		database
			.select({ n: count() })
			.from(graphCommunity)
			.where(eq(graphCommunity.userId, userId)),
		database
			.select({ n: count() })
			.from(canonicalEntity)
			.where(and(eq(canonicalEntity.userId, userId), isNotNull(canonicalEntity.projectStatus))),
		fetchEntityEdgesForUser({ userId })
	]);

	return {
		thoughts: Number(thoughtRow[0]?.n ?? 0),
		entities: Number(entityRow[0]?.n ?? 0),
		edges: entityEdges.length,
		communities: Number(communityRow[0]?.n ?? 0),
		projects: Number(projectRow[0]?.n ?? 0)
	};
}
