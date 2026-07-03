import { and, count, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db';
import { entityResolutionLog, thought } from '$lib/server/db/schema';

export type GraphScaleIngestSnapshot = {
	thoughtId: string;
	enriched: boolean;
	entityCount: number;
	hasEmbedding: boolean;
	ok: boolean;
};

export function isGraphScaleIngestOk(input: {
	enriched: boolean;
	entityCount: number;
	hasEmbedding: boolean;
}): boolean {
	return input.enriched && input.hasEmbedding && input.entityCount > 0;
}

/** Post-enrich health for one thought (no embedding vector returned). */
export async function collectGraphScaleIngestResult(input: {
	db: AppDatabase;
	userId: string;
	thoughtId: string;
}): Promise<GraphScaleIngestSnapshot> {
	const [thoughtRow, entityRow] = await Promise.all([
		input.db
			.select({
				enrichedAt: thought.enrichedAt,
				hasEmbedding: sql<boolean>`${thought.embedding} IS NOT NULL`
			})
			.from(thought)
			.where(and(eq(thought.userId, input.userId), eq(thought.id, input.thoughtId)))
			.limit(1),
		input.db
			.select({ n: count() })
			.from(entityResolutionLog)
			.where(
				and(
					eq(entityResolutionLog.userId, input.userId),
					eq(entityResolutionLog.thoughtId, input.thoughtId)
				)
			)
	]);

	const enriched = thoughtRow[0]?.enrichedAt != null;
	const hasEmbedding = Boolean(thoughtRow[0]?.hasEmbedding);
	const entityCount = Number(entityRow[0]?.n ?? 0);

	return {
		thoughtId: input.thoughtId,
		enriched,
		entityCount,
		hasEmbedding,
		ok: isGraphScaleIngestOk({ enriched, entityCount, hasEmbedding })
	};
}

export function formatGraphScaleIngestLogLine(input: {
	index: number;
	total: number;
	ok: boolean;
	entityCount: number;
	hasEmbedding: boolean;
	enriched: boolean;
	error?: string;
}): string {
	const status = input.error ? 'FAIL' : input.ok ? 'ok' : 'weak';
	const detail = input.error
		? input.error
		: `enriched=${input.enriched} entities=${input.entityCount} embedding=${input.hasEmbedding}`;
	return `[graph-scale] ingest ${input.index}/${input.total} ${status} · ${detail}`;
}
