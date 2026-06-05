/**
 * Materialize Postgres link tables from enrich outputs.
 * Replaces live AGE graph reads at retrieval time.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	entityResolutionLog,
	entityTopThoughts,
	thought,
	thoughtEntity,
	thoughtNeighbor,
	thoughtRelation
} from '$lib/server/db/schema';

const RERANK_SNIPPET_LEN = 300;
const ENTITY_TOP_THOUGHTS_LIMIT = 20;

function confidenceToSalience(confidence: string): number {
	if (confidence === 'high') return 1.0;
	if (confidence === 'medium') return 0.7;
	return 0.4;
}

/** Sync thought_entity rows from entity_resolution_log for one thought. */
export async function syncThoughtEntityLinks(userId: string, thoughtId: string): Promise<number> {
	const db = getDb();
	await db
		.delete(thoughtEntity)
		.where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, thoughtId)));

	const logs = await db
		.select({
			entityId: entityResolutionLog.canonicalEntityId,
			confidence: entityResolutionLog.confidence
		})
		.from(entityResolutionLog)
		.where(
			and(
				eq(entityResolutionLog.userId, userId),
				eq(entityResolutionLog.thoughtId, thoughtId),
				sql`${entityResolutionLog.canonicalEntityId} IS NOT NULL`
			)
		);

	const byEntity = new Map<string, number>();
	for (const row of logs) {
		if (!row.entityId) continue;
		const salience = confidenceToSalience(row.confidence);
		const prev = byEntity.get(row.entityId) ?? 0;
		byEntity.set(row.entityId, Math.max(prev, salience));
	}

	if (byEntity.size === 0) return 0;

	await db.insert(thoughtEntity).values(
		[...byEntity.entries()].map(([entityId, salience]) => ({
			userId,
			thoughtId,
			entityId,
			salience
		}))
	);

	return byEntity.size;
}

/** Sync thought_neighbor rows from thought_relation for one source thought. */
export async function syncThoughtNeighborLinks(userId: string, thoughtId: string): Promise<number> {
	const db = getDb();
	await db
		.delete(thoughtNeighbor)
		.where(and(eq(thoughtNeighbor.userId, userId), eq(thoughtNeighbor.thoughtId, thoughtId)));

	const relations = await db
		.select({
			targetThoughtId: thoughtRelation.targetThoughtId,
			relationType: thoughtRelation.relationType
		})
		.from(thoughtRelation)
		.where(
			and(eq(thoughtRelation.userId, userId), eq(thoughtRelation.sourceThoughtId, thoughtId))
		);

	if (relations.length === 0) return 0;

	await db.insert(thoughtNeighbor).values(
		relations.map((r) => ({
			userId,
			thoughtId,
			neighborId: r.targetThoughtId,
			relationType: r.relationType,
			weight: 1
		}))
	);

	return relations.length;
}

/** Set rerank_snippet on a thought after enrich. */
export async function syncThoughtRerankSnippet(
	userId: string,
	thoughtId: string,
	normalizedText: string
): Promise<void> {
	const snippet = normalizedText.trim().slice(0, RERANK_SNIPPET_LEN);
	await getDb()
		.update(thought)
		.set({ rerankSnippet: snippet })
		.where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)));
}

/** Rebuild entity_top_thoughts for entities touched by a thought. */
export async function rebuildEntityTopThoughtsForThought(
	userId: string,
	thoughtId: string
): Promise<void> {
	const db = getDb();
	const entityRows = await db
		.select({ entityId: thoughtEntity.entityId })
		.from(thoughtEntity)
		.where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, thoughtId)));

	const entityIds = entityRows.map((r) => r.entityId);
	if (entityIds.length === 0) return;

	await rebuildEntityTopThoughtsForEntities(userId, entityIds);
}

/** Rebuild pre-ranked thought lists for the given entities. */
export async function rebuildEntityTopThoughtsForEntities(
	userId: string,
	entityIds: string[]
): Promise<void> {
	if (entityIds.length === 0) return;
	const db = getDb();

	for (const entityId of entityIds) {
		const rows = await db
			.select({
				thoughtId: thoughtEntity.thoughtId,
				salience: thoughtEntity.salience,
				createdAt: thought.createdAt,
				thoughtSalience: thought.salienceScore
			})
			.from(thoughtEntity)
			.innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
			.where(
				and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, entityId))
			)
			.orderBy(
				sql`${thoughtEntity.salience} DESC`,
				sql`${thought.salienceScore} DESC`,
				sql`${thought.createdAt} DESC`
			)
			.limit(ENTITY_TOP_THOUGHTS_LIMIT);

		const thoughtIds = rows.map((r) => r.thoughtId);
		const ranks = rows.map((r, i) => {
			const recency = r.createdAt ? 1 / (1 + (Date.now() - r.createdAt.getTime()) / 86400000) : 0;
			return r.salience * 0.5 + r.thoughtSalience * 0.3 + recency * 0.2 - i * 0.01;
		});

		await db
			.insert(entityTopThoughts)
			.values({
				entityId,
				userId,
				thoughtIds,
				ranks
			})
			.onConflictDoUpdate({
				target: entityTopThoughts.entityId,
				set: {
					thoughtIds,
					ranks,
					updatedAt: sql`now()`
				}
			});
	}
}

/** Full materialization pass after successful enrich. */
export async function materializeRetrievalLinksForThought(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
}): Promise<void> {
	await syncThoughtRerankSnippet(input.userId, input.thoughtId, input.normalizedText);
	await syncThoughtEntityLinks(input.userId, input.thoughtId);
	await syncThoughtNeighborLinks(input.userId, input.thoughtId);
	await rebuildEntityTopThoughtsForThought(input.userId, input.thoughtId);
}

/** Backfill all link tables for a user (consolidation / migration). */
export async function backfillRetrievalLinksForUser(userId: string): Promise<{
	thoughts: number;
	entities: number;
}> {
	const db = getDb();
	const thoughts = await db
		.select({ id: thought.id, normalizedText: thought.normalizedText })
		.from(thought)
		.where(eq(thought.userId, userId));

	for (const row of thoughts) {
		await materializeRetrievalLinksForThought({
			userId,
			thoughtId: row.id,
			normalizedText: row.normalizedText
		});
	}

	const entityIds = await db
		.select({ entityId: thoughtEntity.entityId })
		.from(thoughtEntity)
		.where(eq(thoughtEntity.userId, userId));

	const uniqueEntityIds = [...new Set(entityIds.map((r) => r.entityId))];
	await rebuildEntityTopThoughtsForEntities(userId, uniqueEntityIds);

	return { thoughts: thoughts.length, entities: uniqueEntityIds.length };
}
