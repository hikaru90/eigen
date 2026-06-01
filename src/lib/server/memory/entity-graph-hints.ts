import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, entityResolutionLog } from '$lib/server/db/schema';
import { fetchEntityEdgesForUser } from '$lib/server/graph/age';
import { buildEntityAdjacency, neighborEntityIds } from '$lib/server/memory/entity-link-graph';
import type { KnownEntityHint } from '$lib/server/memory/entity-extraction';

const GRAPH_HINT_LIMIT = 12;

/**
 * Known-entity hints from graph context (same-thought resolutions + ENTITY_RELATES neighbors).
 * Does not use embedding similarity.
 */
export async function loadGraphKnownEntityHints(input: {
	userId: string;
	thoughtId: string;
}): Promise<KnownEntityHint[]> {
	const db = getDb();
	const resolved = await db
		.select({
			entityId: entityResolutionLog.canonicalEntityId,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(entityResolutionLog)
		.innerJoin(
			canonicalEntity,
			and(
				eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id),
				eq(canonicalEntity.userId, input.userId)
			)
		)
		.where(
			and(
				eq(entityResolutionLog.userId, input.userId),
				eq(entityResolutionLog.thoughtId, input.thoughtId),
				isNotNull(entityResolutionLog.canonicalEntityId)
			)
		);

	const byId = new Map<string, KnownEntityHint>();
	for (const row of resolved) {
		if (!row.entityId) continue;
		byId.set(row.entityId, { label: row.label, entityType: row.entityType });
	}

	const seedIds = [...byId.keys()];
	if (seedIds.length === 0) return [];

	const edges = await fetchEntityEdgesForUser({ userId: input.userId });
	const adjacency = buildEntityAdjacency(edges);
	const neighborIds = neighborEntityIds(adjacency, seedIds);

	const missingNeighborIds = [...neighborIds].filter((id) => !byId.has(id)).slice(0, GRAPH_HINT_LIMIT);
	if (missingNeighborIds.length > 0) {
		const rows = await db
			.select({
				id: canonicalEntity.id,
				label: canonicalEntity.label,
				entityType: canonicalEntity.entityType
			})
			.from(canonicalEntity)
			.where(
				and(eq(canonicalEntity.userId, input.userId), inArray(canonicalEntity.id, missingNeighborIds))
			);

		for (const row of rows) {
			byId.set(row.id, { label: row.label, entityType: row.entityType });
		}
	}

	return [...byId.values()].slice(0, GRAPH_HINT_LIMIT);
}
