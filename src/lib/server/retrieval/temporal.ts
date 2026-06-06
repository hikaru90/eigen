import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { temporalEvent } from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { expandContextFromTemporalEventSeeds } from '$lib/server/graph/age';
import type { QueryIntent } from '$lib/server/retrieval/classify-query-intent';

export type TemporalFilterResult = {
	eventId: string;
	graphNodeId: string | null;
	semanticSummary: string;
	thoughtId: string;
	score: number;
	startAt: Date | null;
};

export type TemporalEventSeed = {
	eventId: string;
	thoughtId: string;
	semanticSummary: string;
	startAt: Date | null;
	activePeriod: string;
};

export type TemporalQueryIntent = Pick<QueryIntent, 'temporal' | 'kind' | 'timeWindow'>;

/** True when LLM query intent marks the question as temporal. */
export function isTemporalQuery(intent?: TemporalQueryIntent | null): boolean {
	return intent?.temporal === true;
}

/** Time window from LLM query intent (no string parsing). */
export function resolveQueryTimeRange(intent?: TemporalQueryIntent | null): { start: Date; end: Date } | null {
	return intent?.timeWindow ?? null;
}

/** @deprecated Use resolveQueryTimeRange with LLM intent. */
export function inferQueryTimeRange(
	_query: string,
	_referenceDate: Date = new Date()
): { start: Date; end: Date } | null {
	return null;
}

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

/**
 * Postgres time slice: overlap filter and/or semantic match on temporal_event rows.
 */
export async function filterTemporalEvents(input: {
	userId: string;
	query: string;
	queryEmbedding?: number[];
	limit?: number;
	queryRange?: { start: Date; end: Date } | null;
}): Promise<TemporalFilterResult[]> {
	const limit = Math.max(1, Math.min(input.limit ?? 24, 100));
	const db = getDb();
	const queryEmbedding =
		input.queryEmbedding ?? (await createThoughtEmbedding(input.userId, input.query));
	const vectorLiteral = toVectorLiteral(queryEmbedding);
	const distance = sql<number>`${temporalEvent.embedding} <=> ${vectorLiteral}::vector`;

	const range = input.queryRange ?? null;
	const rangeLiteral = range
		? `[${range.start.toISOString()},${range.end.toISOString()})`
		: null;

	const rows = await db
		.select({
			id: temporalEvent.id,
			graphNodeId: temporalEvent.graphNodeId,
			semanticSummary: temporalEvent.semanticSummary,
			thoughtId: temporalEvent.thoughtId,
			startAt: temporalEvent.startAt,
			distance
		})
		.from(temporalEvent)
		.where(
			and(
				eq(temporalEvent.userId, input.userId),
				isNotNull(temporalEvent.embedding),
				rangeLiteral
					? sql`${temporalEvent.activePeriod} && ${rangeLiteral}::tsrange`
					: undefined
			)
		)
		.orderBy(distance)
		.limit(limit);

	return rows.map((row, index) => ({
		eventId: row.id,
		graphNodeId: row.graphNodeId,
		semanticSummary: row.semanticSummary,
		thoughtId: row.thoughtId,
		startAt: row.startAt,
		score: 1 / (index + 1)
	}));
}

/**
 * Semantic match on temporal_event rows, ordered chronologically by start_at.
 */
export async function fetchTemporalEventSeeds(input: {
	userId: string;
	query: string;
	queryEmbedding: number[];
	limit?: number;
}): Promise<TemporalEventSeed[]> {
	const limit = Math.max(1, Math.min(input.limit ?? 24, 100));
	const db = getDb();
	const vectorLiteral = toVectorLiteral(input.queryEmbedding);
	const distance = sql<number>`${temporalEvent.embedding} <=> ${vectorLiteral}::vector`;

	const rows = await db
		.select({
			id: temporalEvent.id,
			thoughtId: temporalEvent.thoughtId,
			semanticSummary: temporalEvent.semanticSummary,
			startAt: temporalEvent.startAt,
			activePeriod: temporalEvent.activePeriod,
			distance
		})
		.from(temporalEvent)
		.where(and(eq(temporalEvent.userId, input.userId), isNotNull(temporalEvent.embedding)))
		.orderBy(distance)
		.limit(limit * 3);

	const sorted = [...rows].sort((a, b) => {
		const aTime = a.startAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
		const bTime = b.startAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
		return aTime - bTime;
	});

	return sorted.slice(0, limit).map((row) => ({
		eventId: row.id,
		thoughtId: row.thoughtId,
		semanticSummary: row.semanticSummary,
		startAt: row.startAt,
		activePeriod: row.activePeriod
	}));
}

/**
 * Filter-then-traverse: AGE graph expansion from Postgres-seeded event ids.
 */
export async function traverseTemporalContext(input: {
	userId: string;
	seeds: TemporalFilterResult[];
	limit?: number;
}): Promise<Array<{ thoughtId: string; hits: number; provenance?: string }>> {
	const eventIds = input.seeds
		.map((s) => s.graphNodeId ?? s.eventId)
		.filter((id) => id.length > 0);

	if (eventIds.length === 0) return [];

	return expandContextFromTemporalEventSeeds({
		userId: input.userId,
		eventIds,
		limit: input.limit ?? 40
	});
}

export type TemporalSearchHit = TemporalFilterResult;
