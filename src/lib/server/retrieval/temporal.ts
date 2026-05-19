import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { temporalEvent } from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { expandContextFromTemporalEventSeeds } from '$lib/server/graph/falkor';

export type TemporalFilterResult = {
	eventId: string;
	falkordbNodeId: string | null;
	semanticSummary: string;
	thoughtId: string;
	score: number;
};

const TEMPORAL_QUERY_PATTERNS = [
	/\bwhen\b/i,
	/\bdeadline\b/i,
	/\bdue\b/i,
	/\bschedule\b/i,
	/\bappointment\b/i,
	/\blast (week|month|year|time)\b/i,
	/\bnext (week|month|year|friday|monday)\b/i,
	/\bin \d{4}\b/,
	/\b(between|from|until|before|after)\b/i,
	/\b(timeline|timeframe|time frame|period)\b/i
];

/** Heuristic: does this query need temporal filtering? */
export function isTemporalQuery(query: string): boolean {
	const trimmed = query.trim();
	if (!trimmed) return false;
	return TEMPORAL_QUERY_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Parse a coarse query range from natural language (v1 heuristics).
 * Returns null when no explicit window is inferred — caller may use semantic-only filter.
 */
export function inferQueryTimeRange(query: string): { start: Date; end: Date } | null {
	const monthYear = query.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/i);
	if (monthYear) {
		const months = [
			'january',
			'february',
			'march',
			'april',
			'may',
			'june',
			'july',
			'august',
			'september',
			'october',
			'november',
			'december'
		];
		const monthIdx = months.indexOf(monthYear[1].toLowerCase());
		const year = Number(monthYear[2]);
		return {
			start: new Date(Date.UTC(year, monthIdx, 1)),
			end: new Date(Date.UTC(year, monthIdx + 1, 1))
		};
	}

	const yearMatch = query.match(/\b(20\d{2})\b/);
	if (yearMatch) {
		const year = Number(yearMatch[1]);
		return {
			start: new Date(Date.UTC(year, 0, 1)),
			end: new Date(Date.UTC(year + 1, 0, 1))
		};
	}

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

	const range = input.queryRange ?? inferQueryTimeRange(input.query);
	const rangeLiteral = range
		? `[${range.start.toISOString()},${range.end.toISOString()})`
		: null;

	const rows = await db
		.select({
			id: temporalEvent.id,
			falkordbNodeId: temporalEvent.falkordbNodeId,
			semanticSummary: temporalEvent.semanticSummary,
			thoughtId: temporalEvent.thoughtId,
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
		falkordbNodeId: row.falkordbNodeId,
		semanticSummary: row.semanticSummary,
		thoughtId: row.thoughtId,
		score: 1 / (index + 1)
	}));
}

/**
 * Filter-then-traverse: Falkor expansion from Postgres-seeded event ids.
 */
export async function traverseTemporalContext(input: {
	userId: string;
	seeds: TemporalFilterResult[];
	limit?: number;
}): Promise<Array<{ thoughtId: string; hits: number; provenance?: string }>> {
	const eventIds = input.seeds
		.map((s) => s.falkordbNodeId ?? s.eventId)
		.filter((id) => id.length > 0);

	if (eventIds.length === 0) return [];

	return expandContextFromTemporalEventSeeds({
		userId: input.userId,
		eventIds,
		limit: input.limit ?? 40
	});
}
