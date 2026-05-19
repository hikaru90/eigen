import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { canonicalEntity, entityResolutionLog, temporalEvent, thought } from '$lib/server/db/schema';
import { findTemporalSchedulingConflictsInGraph } from '$lib/server/graph/falkor';
import { inferQueryTimeRange, isTemporalQuery } from '$lib/server/retrieval/temporal';

const PERSON_ENTITY_TYPES = new Set(['person']);
const PLACE_ENTITY_TYPES = new Set(['place', 'location', 'city', 'geo', 'region']);

const SCHEDULING_CONFLICT_QUERY_PATTERNS = [
	/\bconflict\b/i,
	/\bclash\b/i,
	/\boverlap\b/i,
	/\bscheduling\b/i,
	/\bdouble[- ]book/i
];

export type TemporalSchedulingConflict = {
	personEntityId: string;
	personLabel: string;
	events: Array<{
		eventId: string;
		thoughtId: string;
		semanticSummary: string;
		placeLabel: string;
	}>;
	mandatoryThoughtIds: string[];
	thoughtIds: string[];
	description: string;
};

/** Scheduling / overlap questions should use the temporal graph path. */
export function isSchedulingConflictQuery(query: string): boolean {
	const trimmed = query.trim();
	if (!trimmed) return false;
	return SCHEDULING_CONFLICT_QUERY_PATTERNS.some((p) => p.test(trimmed)) || isTemporalQuery(trimmed);
}

type EntityOnThought = {
	entityId: string;
	label: string;
	entityType: string;
};

async function loadEntitiesForThoughts(
	userId: string,
	thoughtIds: string[]
): Promise<Map<string, EntityOnThought[]>> {
	if (thoughtIds.length === 0) return new Map();

	const rows = await getDb()
		.select({
			thoughtId: entityResolutionLog.thoughtId,
			entityId: canonicalEntity.id,
			label: canonicalEntity.label,
			entityType: canonicalEntity.entityType
		})
		.from(entityResolutionLog)
		.innerJoin(canonicalEntity, eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id))
		.where(
			and(
				eq(entityResolutionLog.userId, userId),
				inArray(entityResolutionLog.thoughtId, thoughtIds),
				sql`${entityResolutionLog.canonicalEntityId} IS NOT NULL`
			)
		);

	const map = new Map<string, EntityOnThought[]>();
	for (const row of rows) {
		if (!row.entityId) continue;
		const list = map.get(row.thoughtId) ?? [];
		list.push({
			entityId: row.entityId,
			label: row.label,
			entityType: row.entityType
		});
		map.set(row.thoughtId, list);
	}
	return map;
}

function pickPerson(entities: EntityOnThought[]): EntityOnThought | null {
	return entities.find((e) => PERSON_ENTITY_TYPES.has(e.entityType)) ?? null;
}

function pickPlaces(entities: EntityOnThought[]): EntityOnThought[] {
	return entities.filter((e) => PLACE_ENTITY_TYPES.has(e.entityType));
}

function pickPlaceLabel(entities: EntityOnThought[], summary: string): string {
	const places = pickPlaces(entities);
	if (places.length > 0) return places[0]!.label;
	const fromSummary = summary.match(/\b(in|to)\s+([A-Z][a-zA-Z]+)/);
	return fromSummary?.[2] ?? 'unknown location';
}

async function findMandatoryThoughtsForPerson(input: {
	userId: string;
	personEntityId: string;
	excludeThoughtIds: Set<string>;
}): Promise<string[]> {
	const rows = await getDb()
		.select({ thoughtId: entityResolutionLog.thoughtId })
		.from(entityResolutionLog)
		.innerJoin(thought, eq(entityResolutionLog.thoughtId, thought.id))
		.where(
			and(
				eq(entityResolutionLog.userId, input.userId),
				eq(entityResolutionLog.canonicalEntityId, input.personEntityId),
				sql`${thought.normalizedText} ~* 'mandatory'`
			)
		);

	return rows
		.map((r) => r.thoughtId)
		.filter((id) => !input.excludeThoughtIds.has(id));
}

type OverlappingEventPair = {
	event1Id: string;
	thought1Id: string;
	summary1: string;
	event2Id: string;
	thought2Id: string;
	summary2: string;
};

async function loadOverlappingEventPairs(input: {
	userId: string;
	queryRange: { start: Date; end: Date } | null;
}): Promise<OverlappingEventPair[]> {
	const rangeLiteral = input.queryRange
		? `[${input.queryRange.start.toISOString()},${input.queryRange.end.toISOString()})`
		: null;

	const rangeFilter = rangeLiteral
		? sql`AND e1.active_period && ${rangeLiteral}::tsrange AND e2.active_period && ${rangeLiteral}::tsrange`
		: sql``;

	const rows = await getDb().execute<{
		event1_id: string;
		thought1_id: string;
		summary1: string;
		event2_id: string;
		thought2_id: string;
		summary2: string;
	}>(sql`
		SELECT
			e1.id AS event1_id,
			e1.thought_id AS thought1_id,
			e1.semantic_summary AS summary1,
			e2.id AS event2_id,
			e2.thought_id AS thought2_id,
			e2.semantic_summary AS summary2
		FROM temporal_event e1
		INNER JOIN temporal_event e2
			ON e1.user_id = e2.user_id
			AND e1.id < e2.id
			AND e1.active_period && e2.active_period
		WHERE e1.user_id = ${input.userId}
		${rangeFilter}
	`);

	return rows.map((row) => ({
		event1Id: row.event1_id,
		thought1Id: row.thought1_id,
		summary1: row.summary1,
		event2Id: row.event2_id,
		thought2Id: row.thought2_id,
		summary2: row.summary2
	}));
}

/**
 * Postgres ledger: overlapping temporal_event rows + shared person entity + distinct places.
 */
export async function findTemporalSchedulingConflictsInPostgres(input: {
	userId: string;
	query: string;
}): Promise<TemporalSchedulingConflict[]> {
	const queryRange = inferQueryTimeRange(input.query);
	const pairs = await loadOverlappingEventPairs({ userId: input.userId, queryRange });
	if (pairs.length === 0) return [];

	const thoughtIds = [...new Set(pairs.flatMap((p) => [p.thought1Id, p.thought2Id]))];
	const entitiesByThought = await loadEntitiesForThoughts(input.userId, thoughtIds);

	const conflicts: TemporalSchedulingConflict[] = [];
	const seen = new Set<string>();

	for (const pair of pairs) {
		const entities1 = entitiesByThought.get(pair.thought1Id) ?? [];
		const entities2 = entitiesByThought.get(pair.thought2Id) ?? [];
		const person1 = pickPerson(entities1);
		const person2 = pickPerson(entities2);
		if (!person1 || !person2 || person1.entityId !== person2.entityId) continue;

		const place1 = pickPlaceLabel(entities1, pair.summary1);
		const place2 = pickPlaceLabel(entities2, pair.summary2);
		if (place1 === place2) continue;

		const key = [person1.entityId, pair.event1Id, pair.event2Id].sort().join('::');
		if (seen.has(key)) continue;
		seen.add(key);

		const exclude = new Set([pair.thought1Id, pair.thought2Id]);
		const mandatoryThoughtIds = await findMandatoryThoughtsForPerson({
			userId: input.userId,
			personEntityId: person1.entityId,
			excludeThoughtIds: exclude
		});

		const thoughtIds = [...exclude, ...mandatoryThoughtIds];
		const description = `${person1.label} has overlapping events in ${place1} and ${place2}`;

		conflicts.push({
			personEntityId: person1.entityId,
			personLabel: person1.label,
			events: [
				{
					eventId: pair.event1Id,
					thoughtId: pair.thought1Id,
					semanticSummary: pair.summary1,
					placeLabel: place1
				},
				{
					eventId: pair.event2Id,
					thoughtId: pair.thought2Id,
					semanticSummary: pair.summary2,
					placeLabel: place2
				}
			],
			mandatoryThoughtIds,
			thoughtIds,
			description
		});
	}

	return conflicts;
}

function graphHitsToConflicts(
	hits: Awaited<ReturnType<typeof findTemporalSchedulingConflictsInGraph>>
): TemporalSchedulingConflict[] {
	const byKey = new Map<string, TemporalSchedulingConflict>();

	for (const hit of hits) {
		const key = [hit.personEntityId, hit.event1Id, hit.event2Id].sort().join('::');
		const existing = byKey.get(key);
		const eventA = {
			eventId: hit.event1Id,
			thoughtId: hit.thought1Id,
			semanticSummary: hit.event1Label,
			placeLabel: hit.place1Label
		};
		const eventB = {
			eventId: hit.event2Id,
			thoughtId: hit.thought2Id,
			semanticSummary: hit.event2Label,
			placeLabel: hit.place2Label
		};
		const mandatoryThoughtIds = hit.mandatoryThoughtIds ?? [];
		const thoughtIds = [
			hit.thought1Id,
			hit.thought2Id,
			...mandatoryThoughtIds
		];
		const description = `${hit.personLabel} has overlapping events in ${hit.place1Label} and ${hit.place2Label}`;

		if (!existing) {
			byKey.set(key, {
				personEntityId: hit.personEntityId,
				personLabel: hit.personLabel,
				events: [eventA, eventB],
				mandatoryThoughtIds,
				thoughtIds: [...new Set(thoughtIds)],
				description
			});
		}
	}

	return [...byKey.values()];
}

/**
 * Detect scheduling clashes via temporal graph (Falkor Event/INVOLVES) with Postgres ledger fallback.
 */
export async function findTemporalSchedulingConflicts(input: {
	userId: string;
	query: string;
}): Promise<TemporalSchedulingConflict[]> {
	const graphHits = await findTemporalSchedulingConflictsInGraph(input.userId);
	if (graphHits.length > 0) {
		return graphHitsToConflicts(graphHits);
	}
	return findTemporalSchedulingConflictsInPostgres(input);
}

/** Factual conflict context derived from the temporal graph — not answer-style instructions. */
export function formatTemporalConflictsForPrompt(conflicts: TemporalSchedulingConflict[]): string {
	if (conflicts.length === 0) return '';

	const lines = conflicts.map((c) => {
		const eventLines = c.events
			.map(
				(e) =>
					`    - ${e.semanticSummary} (${e.placeLabel}) [thought=${e.thoughtId}, event=${e.eventId}]`
			)
			.join('\n');
		const mandatory =
			c.mandatoryThoughtIds.length > 0
				? `\n    Mandatory notes: ${c.mandatoryThoughtIds.map((id) => `[${id}]`).join(', ')}`
				: '';
		return `  - ${c.description} (person=${c.personLabel})\n${eventLines}${mandatory}`;
	});

	return (
		'\n\nTemporal scheduling conflicts (from overlapping events and shared entities in memory graph):\n' +
		lines.join('\n')
	);
}
