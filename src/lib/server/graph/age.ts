/**
 * Apache AGE graph adapter (OpenCypher via `ag_catalog.cypher` on `AGE_GRAPH_NAME`).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { filterGraphVizEdgesToNodes } from '$lib/graph/sanitize-viz-snapshot';
import { getDb } from '$lib/server/db';
import { canonicalEntity } from '$lib/server/db/schema';
import { tokenizeLexicalQuery } from '$lib/server/memory/lexical-fold';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';
import {
	renderCypherQuery,
	runAgeCypher,
	runGraphQueryWithRetry
} from './age-cypher';
export type {
	EntityThoughtHit,
	GraphVizEdge,
	GraphVizEdgeKind,
	GraphVizNode,
	GraphVizNodeKind,
	TemporalContextHit,
	TemporalSchedulingConflictGraphHit
} from './graph-contract';
import type {
	EntityThoughtHit,
	GraphVizEdge,
	GraphVizEdgeKind,
	GraphVizNode,
	TemporalContextHit,
	TemporalSchedulingConflictGraphHit
} from './graph-contract';

type CoMentionEdgeRow = {
	source_id: string;
	target_id: string;
	rel_weight: number | string;
};

async function fetchCoMentionEdgesFromPostgres(input: {
	userId: string;
	limit: number;
}): Promise<CoMentionEdgeRow[]> {
	const result = await getDb().execute(sql`
		SELECT
			LEAST(e1.canonical_entity_id::text, e2.canonical_entity_id::text) AS source_id,
			GREATEST(e1.canonical_entity_id::text, e2.canonical_entity_id::text) AS target_id,
			COUNT(DISTINCT e1.thought_id)::int AS rel_weight
		FROM entity_resolution_log e1
		INNER JOIN entity_resolution_log e2
			ON e2.user_id = e1.user_id
			AND e2.thought_id = e1.thought_id
			AND e1.canonical_entity_id < e2.canonical_entity_id
		WHERE
			e1.user_id = ${input.userId}
			AND e1.canonical_entity_id IS NOT NULL
			AND e2.canonical_entity_id IS NOT NULL
		GROUP BY source_id, target_id
		ORDER BY rel_weight DESC
		LIMIT ${input.limit}
	`);
	const rows = (result as { rows?: unknown[] }).rows ?? [];
	return rows
		.map((row) => row as Partial<CoMentionEdgeRow>)
		.filter(
			(row): row is CoMentionEdgeRow =>
				typeof row.source_id === 'string' &&
				typeof row.target_id === 'string' &&
				(typeof row.rel_weight === 'number' || typeof row.rel_weight === 'string')
		);
}

/** Provenance anchor only — text and embedding live in Postgres `thought`. */
export async function upsertThoughtNode(input: {
	id: string;
	userId: string;
	category: string;
}): Promise<void> {
	const contextPreview = input.id.slice(0, 36);
	await runGraphQueryWithRetry(input.userId, 'age.upsert_node', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MERGE (t:Thought {id: $id})
		SET t.user_id = $user_id,
		    t.category = $category,
		    t.updated_at = timestamp()
		RETURN t.id
			`,
				{
					id: input.id,
					user_id: input.userId,
					category: input.category
				}
			),
			'ok agtype'
		);
	}, contextPreview);
}

/** Removes outgoing RELATES_TO edges only (relation re-extract without wiping entity/temporal edges). */
export async function deleteThoughtOutgoingRelatesToEdges(input: {
	userId: string;
	thoughtId: string;
}): Promise<void> {
	const thoughtId = validateNonEmptyEntityId(input.thoughtId, 'thoughtId');
	await runGraphQueryWithRetry(input.userId, 'age.delete_thought_outgoing_relates_to', async () => {
		await runAgeCypher(
			renderCypherQuery(
				`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})-[r:RELATES_TO {user_id: $user_id}]->(:Thought {user_id: $user_id})
			DELETE r
			RETURN 1 AS ok
			`,
				{
					thought_id: thoughtId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
	});
}

/** Removes outgoing thought→thought and thought→entity edges so ingest can reattach cleanly. */
export async function deleteThoughtOutgoingGraphEdges(input: {
	userId: string;
	thoughtId: string;
}): Promise<void> {
	const thoughtId = validateNonEmptyEntityId(input.thoughtId, 'thoughtId');
	await runGraphQueryWithRetry(input.userId, 'age.delete_thought_outgoing_edges', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})-[r:RELATES_TO {user_id: $user_id}]->(:Thought {user_id: $user_id})
			DELETE r
			RETURN 1 AS ok
			`,
				{
					thought_id: thoughtId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})-[r:MENTIONS {user_id: $user_id}]->(:Entity {user_id: $user_id})
			DELETE r
			RETURN 1 AS ok
			`,
				{
					thought_id: thoughtId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})-[r:OCCURS_IN {user_id: $user_id}]->(:Event {user_id: $user_id})
			DELETE r
			RETURN 1 AS ok
			`,
				{
					thought_id: thoughtId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
	});
}

/** Removes the entity vertex and every attached edge (MENTIONS in/out, ENTITY_RELATES). */
export async function deleteEntityVertexFromGraph(input: {
	userId: string;
	entityId: string;
}): Promise<void> {
	const entityId = validateNonEmptyEntityId(input.entityId, 'entityId');
	await runGraphQueryWithRetry(input.userId, 'age.delete_entity_vertex', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (e:Entity {id: $entity_id, user_id: $user_id})
			DETACH DELETE e
			RETURN 1 AS ok
			`,
				{
					entity_id: entityId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
	});
}

/** Removes the thought vertex and every attached edge (including incoming thought links). */
export async function deleteThoughtVertexFromGraph(input: {
	userId: string;
	thoughtId: string;
}): Promise<void> {
	const thoughtId = validateNonEmptyEntityId(input.thoughtId, 'thoughtId');
	await runGraphQueryWithRetry(input.userId, 'age.delete_thought_vertex', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})
			DETACH DELETE t
			RETURN 1 AS ok
			`,
				{
					thought_id: thoughtId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
	});
}

/** Wipes every vertex for the tenant graph (Thought, Entity, Event, and attached edges). */
export async function deleteAllUserGraphVertices(userId: string): Promise<void> {
	await runGraphQueryWithRetry(userId, 'age.delete_all_user_vertices', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (n {user_id: $user_id})
			DETACH DELETE n
			RETURN 1 AS ok
			`,
				{
					user_id: userId
				}
			),
			'ok agtype'
		);
	});
}

export async function upsertThoughtRelation(input: {
	userId: string;
	sourceId: string;
	targetId: string;
	relationType: string;
}): Promise<void> {
	const sourceId = validateNonEmptyEntityId(input.sourceId, 'sourceId');
	const targetId = validateNonEmptyEntityId(input.targetId, 'targetId');

	await runGraphQueryWithRetry(input.userId, 'age.upsert_relation', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (a:Thought {id: $source_id})
			MATCH (b:Thought {id: $target_id})
			MERGE (a)-[r:RELATES_TO {user_id: $user_id, type: $relation_type}]->(b)
			SET r.updated_at = timestamp()
			RETURN 1 AS ok
			`,
				{
					source_id: sourceId,
					target_id: targetId,
					user_id: input.userId,
					relation_type: input.relationType
				}
			),
			'ok agtype'
		);
	});
}

export async function expandNeighborsByIds(input: {
	userId: string;
	seedIds: string[];
	limit: number;
}): Promise<Array<{ id: string; hits: number; provenance?: string }>> {
	const normalizedSeedIds = input.seedIds
		.map((seedId) => validateNonEmptyEntityId(seedId, 'seedIds[]'))
		.filter((value, index, self) => self.indexOf(value) === index);
	if (normalizedSeedIds.length === 0) return [];

	return runGraphQueryWithRetry(input.userId, 'age.expand_neighbors', async () => {
		const rows = await runAgeCypher(
			renderCypherQuery(
			`
			UNWIND $seed_ids AS sid
			MATCH (s:Thought {id: sid, user_id: $user_id})
			MATCH (s)-[r:RELATES_TO]-(n:Thought {user_id: $user_id})
			WHERE n.id <> sid AND r.user_id = $user_id
			WITH n.id AS id, count(r) AS hits, collect(DISTINCT r.type) AS rel_types
			RETURN id, hits, rel_types
			ORDER BY hits DESC
			LIMIT $limit
			`,
				{
					seed_ids: normalizedSeedIds,
					user_id: input.userId,
					limit: input.limit
				}
			),
			'id agtype, hits agtype, rel_types agtype'
		);
		return rows
			.map((row) => {
				const id = typeof row.id === 'string' ? row.id : '';
				const hits = typeof row.hits === 'number' ? row.hits : Number(row.hits ?? 0);
				const relTypes = parseRelTypesFromAge(row.rel_types);
				const provenance =
					relTypes.length > 0 ? `via_related:${relTypes[0]}` : 'via_related:thought_link';
				return { id, hits, provenance };
			})
			.filter((row) => row.id);
	});
}

function parseRelTypesFromAge(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((v) => (typeof v === 'string' ? v.trim() : ''))
			.filter((v) => v.length > 0);
	}
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	return [];
}

function graphQueryTokens(query: string): string[] {
	return tokenizeLexicalQuery(query)
		.filter((token) => token.length >= 2)
		.slice(0, 16);
}

export async function graphOnlySearchByQuery(input: {
	userId: string;
	query: string;
	limit: number;
}): Promise<Array<{ id: string; score: number }>> {
	const tokens = graphQueryTokens(input.query);
	if (tokens.length === 0) return [];

	return runGraphQueryWithRetry(input.userId, 'age.graph_only_search', async () => {
		const rows = await runAgeCypher(
			renderCypherQuery(
			`
			UNWIND $tokens AS token
			MATCH (e:Entity {user_id: $user_id})
			WHERE toLower(e.label) CONTAINS token
			MATCH (t:Thought {user_id: $user_id})-[:MENTIONS {user_id: $user_id}]->(e)
			WITH t, count(distinct token) AS overlap
			WITH t, overlap ORDER BY overlap DESC LIMIT $seed_limit

			OPTIONAL MATCH (t)-[r:RELATES_TO]-(n:Thought {user_id: $user_id})
			WHERE r.user_id = $user_id
			WITH t, overlap, collect(n.id) AS neighbor_ids

			UNWIND ([t.id] + neighbor_ids) AS candidate_id
			WITH candidate_id AS id, sum(overlap) AS seed_score
			WITH id, seed_score ORDER BY seed_score DESC LIMIT $limit
			RETURN id, seed_score AS score
			`,
				{
					user_id: input.userId,
					tokens,
					seed_limit: Math.max(input.limit * 3, 20),
					limit: input.limit
				}
			),
			'id agtype, score agtype'
		);

		
		return rows
			.map((row) => ({
				id: typeof row.id === 'string' ? row.id : '',
				score: typeof row.score === 'number' ? row.score : Number(row.score ?? 0)
			}))
			.filter((row) => row.id);
	});
}

export async function fetchGraphVisualizationSnapshot(input: {
	userId: string;
	nodeLimit?: number;
	edgeLimit?: number;
}): Promise<{ nodes: GraphVizNode[]; edges: GraphVizEdge[] }> {
	const nodeLimit = Math.min(Math.max(input.nodeLimit ?? 400, 1), 2000);
	const edgeLimit = Math.min(Math.max(input.edgeLimit ?? 800, 1), 5000);

	return runGraphQueryWithRetry(input.userId, 'age.viz_snapshot', async () => {
		const entityNodeRows = await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (e:Entity {user_id: $user_id})
			RETURN e.id AS id,
			       coalesce(e.label, e.canonical_key, '') AS label,
			       coalesce(e.entity_type, 'other') AS subtype
			LIMIT $node_limit
			`,
				{ user_id: input.userId, node_limit: nodeLimit }
			),
			'id agtype, label agtype, subtype agtype'
		);

		/**
		 * Co-mention source of truth is Postgres entity_resolution_log.
		 * This prevents stale/orphan AGE Thought nodes from creating phantom co-mentions.
		 */
		const relCoMentionRows = await fetchCoMentionEdgesFromPostgres({
			userId: input.userId,
			limit: edgeLimit
		});

		const relEntityRows = await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (a:Entity {user_id: $user_id})-[r:ENTITY_RELATES {user_id: $user_id}]->(b:Entity {user_id: $user_id})
			RETURN a.id AS source_id, b.id AS target_id, coalesce(r.predicate, 'related_to') AS rel_type
			LIMIT $edge_limit
			`,
				{ user_id: input.userId, edge_limit: edgeLimit }
			),
			'source_id agtype, target_id agtype, rel_type agtype'
		);

		const nodes: GraphVizNode[] = [];
		const seenNode = new Set<string>();

		for (const row of entityNodeRows ?? []) {
			const id = typeof row.id === 'string' ? row.id : '';
			if (!id || seenNode.has(id)) continue;
			seenNode.add(id);
			nodes.push({
				id,
				kind: 'Entity',
				label: typeof row.label === 'string' ? row.label : String(row.label ?? ''),
				subtype: typeof row.subtype === 'string' ? row.subtype : String(row.subtype ?? '')
			});
		}

		const edges: GraphVizEdge[] = [];
		let edgeSeq = 0;
		const pushEdge = (
			sourceId: string,
			targetId: string,
			relationType: string,
			kind: GraphVizEdgeKind
		) => {
			edgeSeq += 1;
			edges.push({
				id: `${kind}:${sourceId}:${targetId}:${relationType}:${edgeSeq}`,
				sourceId,
				targetId,
				relationType,
				kind
			});
		};

		for (const row of relCoMentionRows ?? []) {
			const s = typeof row.source_id === 'string' ? row.source_id : '';
			const t = typeof row.target_id === 'string' ? row.target_id : '';
			const w = typeof row.rel_weight === 'number' ? row.rel_weight : Number(row.rel_weight ?? 1);
			if (s && t) pushEdge(s, t, w > 1 ? `co_mentioned (${w})` : 'co_mentioned', 'co_mention');
		}
		for (const row of relEntityRows ?? []) {
			const s = typeof row.source_id === 'string' ? row.source_id : '';
			const t = typeof row.target_id === 'string' ? row.target_id : '';
			const rt = typeof row.rel_type === 'string' ? row.rel_type : 'related_to';
			if (s && t) pushEdge(s, t, rt, 'entity_relation');
		}

		const referencedIds = new Set<string>();
		for (const edge of edges) {
			referencedIds.add(edge.sourceId);
			referencedIds.add(edge.targetId);
		}
		const missingIds = [...referencedIds].filter((id) => !seenNode.has(id));
		if (missingIds.length > 0) {
			const supplemental = await getDb()
				.select({
					id: canonicalEntity.id,
					label: canonicalEntity.label,
					entityType: canonicalEntity.entityType
				})
				.from(canonicalEntity)
				.where(
					and(eq(canonicalEntity.userId, input.userId), inArray(canonicalEntity.id, missingIds))
				);
			for (const row of supplemental) {
				const id = String(row.id);
				if (!id || seenNode.has(id)) continue;
				seenNode.add(id);
				nodes.push({
					id,
					kind: 'Entity',
					label: row.label,
					subtype: row.entityType
				});
			}
		}

		return filterGraphVizEdgesToNodes(nodes, edges);
	});
}

export async function upsertEntityNode(input: {
	id: string;
	userId: string;
	canonicalKey: string;
	label: string;
	entityType: string;
}): Promise<void> {
	const id = validateNonEmptyEntityId(input.id, 'id');
	await runGraphQueryWithRetry(input.userId, 'age.upsert_entity', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MERGE (e:Entity {id: $id})
			SET e.user_id = $user_id,
			    e.canonical_key = $canonical_key,
			    e.label = $label,
			    e.entity_type = $entity_type,
			    e.updated_at = timestamp()
			RETURN e.id
			`,
				{
					id,
					user_id: input.userId,
					canonical_key: input.canonicalKey,
					label: input.label,
					entity_type: input.entityType
				}
			),
			'ok agtype'
		);
	});
}

export async function upsertMentionEdge(input: {
	userId: string;
	thoughtId: string;
	entityId: string;
}): Promise<void> {
	const thoughtId = validateNonEmptyEntityId(input.thoughtId, 'thoughtId');
	const entityId = validateNonEmptyEntityId(input.entityId, 'entityId');

	await runGraphQueryWithRetry(input.userId, 'age.upsert_mention', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})
			MATCH (e:Entity {id: $entity_id, user_id: $user_id})
			MERGE (t)-[r:MENTIONS {user_id: $user_id}]->(e)
			SET r.updated_at = timestamp()
			RETURN 1 AS ok
			`,
				{
					thought_id: thoughtId,
					entity_id: entityId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
	});
}

export async function upsertEntityRelationEdge(input: {
	userId: string;
	sourceEntityId: string;
	targetEntityId: string;
	predicate: string;
}): Promise<void> {
	const sourceEntityId = validateNonEmptyEntityId(input.sourceEntityId, 'sourceEntityId');
	const targetEntityId = validateNonEmptyEntityId(input.targetEntityId, 'targetEntityId');

	await runGraphQueryWithRetry(input.userId, 'age.upsert_entity_relation', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (a:Entity {id: $a_id, user_id: $user_id})
			MATCH (b:Entity {id: $b_id, user_id: $user_id})
			MERGE (a)-[r:ENTITY_RELATES {user_id: $user_id, predicate: $predicate}]->(b)
			SET r.updated_at = timestamp(),
			    r.weight = coalesce(r.weight, 0) + 1
			RETURN 1 AS ok
			`,
				{
					a_id: sourceEntityId,
					b_id: targetEntityId,
					user_id: input.userId,
					predicate: input.predicate
				}
			),
			'ok agtype'
		);
	});
}

/**
 * Fetch all entity-entity edges with weights for community detection (Leiden algorithm).
 * Returns edges as adjacency list: [{sourceId, targetId, weight, predicate}].
 * Only returns edges where both endpoints exist; self-loops are excluded.
 */
export async function fetchEntityEdgesForUser(input: {
	userId: string;
}): Promise<Array<{ sourceId: string; targetId: string; weight: number; predicate: string }>> {
	return runGraphQueryWithRetry(input.userId, 'age.fetch_entity_edges', async () => {
		const rows = await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (a:Entity {user_id: $user_id})-[r:ENTITY_RELATES {user_id: $user_id}]->(b:Entity {user_id: $user_id})
			WHERE a.id <> b.id
			RETURN a.id AS source_id, b.id AS target_id, coalesce(r.weight, 1) AS weight, r.predicate AS predicate
			`,
				{ user_id: input.userId }
			),
			'source_id agtype, target_id agtype, weight agtype, predicate agtype'
		);

		return (rows ?? [])
			.map((row) => ({
				sourceId: typeof row.source_id === 'string' ? row.source_id : '',
				targetId: typeof row.target_id === 'string' ? row.target_id : '',
				weight: typeof row.weight === 'number' ? row.weight : Number(row.weight ?? 1),
				predicate: typeof row.predicate === 'string' ? row.predicate : 'related_to'
			}))
			.filter((r) => r.sourceId && r.targetId);
	});
}

export async function deleteEntityRelationEdge(input: {
	userId: string;
	sourceEntityId: string;
	targetEntityId: string;
	predicate: string;
}): Promise<void> {
	const sourceEntityId = validateNonEmptyEntityId(input.sourceEntityId, 'sourceEntityId');
	const targetEntityId = validateNonEmptyEntityId(input.targetEntityId, 'targetEntityId');

	await runGraphQueryWithRetry(input.userId, 'age.delete_entity_relation', async () => {
		await runAgeCypher(
			renderCypherQuery(
				`
			MATCH (a:Entity {id: $a_id, user_id: $user_id})-[r:ENTITY_RELATES {user_id: $user_id, predicate: $predicate}]->(b:Entity {id: $b_id, user_id: $user_id})
			DELETE r
			RETURN 1 AS ok
			`,
				{
					a_id: sourceEntityId,
					b_id: targetEntityId,
					user_id: input.userId,
					predicate: input.predicate
				}
			),
			'ok agtype'
		);
	});
}

function mergeHitMaps(a: EntityThoughtHit[], b: EntityThoughtHit[]): EntityThoughtHit[] {
	const map = new Map<string, { hits: number; provenance?: string }>();
	for (const row of [...a, ...b]) {
		const cur = map.get(row.id);
		if (!cur) {
			map.set(row.id, { hits: row.hits, provenance: row.provenance });
		} else {
			cur.hits += row.hits;
			if (row.provenance && !cur.provenance) cur.provenance = row.provenance;
		}
	}
	return [...map.entries()].map(([id, v]) => ({
		id,
		hits: v.hits,
		provenance: v.provenance
	}));
}

/** Thoughts connected to entity roots via MENTIONS and one ENTITY_RELATES hop. */
export async function expandThoughtIdsFromEntitySeeds(input: {
	userId: string;
	entityIds: string[];
	limit: number;
}): Promise<EntityThoughtHit[]> {
	const ids = input.entityIds
		.map((id) => validateNonEmptyEntityId(id, 'entityIds[]'))
		.filter((v, i, a) => a.indexOf(v) === i);
	if (ids.length === 0) return [];

	return runGraphQueryWithRetry(input.userId, 'age.expand_from_entities', async () => {
		const directRows = await runAgeCypher(
			renderCypherQuery(
			`
			UNWIND $entity_ids AS eid
			MATCH (t:Thought {user_id: $user_id})-[:MENTIONS {user_id: $user_id}]->(e:Entity {id: eid, user_id: $user_id})
			RETURN t.id AS id, count(*) AS hits, collect(distinct e.label)[0] AS via_label
			`,
				{ entity_ids: ids, user_id: input.userId }
			),
			'id agtype, hits agtype, via_label agtype'
		);

		const hopRows = await runAgeCypher(
			renderCypherQuery(
			`
			UNWIND $entity_ids AS eid
			MATCH (e:Entity {id: eid, user_id: $user_id})-[:ENTITY_RELATES {user_id: $user_id}]-(e2:Entity {user_id: $user_id})
			MATCH (t:Thought {user_id: $user_id})-[:MENTIONS {user_id: $user_id}]->(e2)
			RETURN t.id AS id, count(*) AS hits, collect(distinct e2.label)[0] AS via_label
			`,
				{ entity_ids: ids, user_id: input.userId }
			),
			'id agtype, hits agtype, via_label agtype'
		);

		const directHits: EntityThoughtHit[] = directRows.map((row) => ({
			id: typeof row.id === 'string' ? row.id : '',
			hits: typeof row.hits === 'number' ? row.hits : Number(row.hits ?? 0),
			provenance:
				typeof row.via_label === 'string' && row.via_label
					? `entity:${row.via_label}`
					: undefined
		}));

		const hopHits: EntityThoughtHit[] = hopRows.map((row) => ({
			id: typeof row.id === 'string' ? row.id : '',
			hits: typeof row.hits === 'number' ? row.hits : Number(row.hits ?? 0),
			provenance:
				typeof row.via_label === 'string' && row.via_label
					? `via_related:${row.via_label}`
					: undefined
		}));

		const merged = mergeHitMaps(directHits, hopHits)
			.filter((row) => row.id)
			.sort((a, b) => b.hits - a.hits)
			.slice(0, input.limit);

		return merged;
	});
}

/** Temporal Event node — scalar dates for reference; range math lives in Postgres. */
export async function upsertEventNode(input: {
	id: string;
	userId: string;
	kind: string;
	label: string;
	startAt: string;
	endAt: string;
}): Promise<void> {
	const id = validateNonEmptyEntityId(input.id, 'id');
	await runGraphQueryWithRetry(input.userId, 'age.upsert_event', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MERGE (e:Event {id: $id})
			SET e.user_id = $user_id,
			    e.kind = $kind,
			    e.label = $label,
			    e.start_at = $start_at,
			    e.end_at = $end_at,
			    e.updated_at = timestamp()
			RETURN e.id
			`,
				{
					id,
					user_id: input.userId,
					kind: input.kind,
					label: input.label,
					start_at: input.startAt,
					end_at: input.endAt
				}
			),
			'ok agtype'
		);
	});
}

export async function deleteEventNodeFromGraph(input: {
	userId: string;
	eventId: string;
}): Promise<void> {
	const eventId = validateNonEmptyEntityId(input.eventId, 'eventId');
	await runGraphQueryWithRetry(input.userId, 'age.delete_event', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (e:Event {id: $event_id, user_id: $user_id})
			DETACH DELETE e
			RETURN 1 AS ok
			`,
				{ event_id: eventId, user_id: input.userId }
			),
			'ok agtype'
		);
	});
}

export async function upsertThoughtOccurrenceEdge(input: {
	userId: string;
	thoughtId: string;
	eventId: string;
}): Promise<void> {
	const thoughtId = validateNonEmptyEntityId(input.thoughtId, 'thoughtId');
	const eventId = validateNonEmptyEntityId(input.eventId, 'eventId');
	await runGraphQueryWithRetry(input.userId, 'age.upsert_occurs_in', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})
			MATCH (e:Event {id: $event_id, user_id: $user_id})
			MERGE (t)-[r:OCCURS_IN {user_id: $user_id}]->(e)
			SET r.updated_at = timestamp()
			RETURN 1 AS ok
			`,
				{
					thought_id: thoughtId,
					event_id: eventId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
	});
}

export async function upsertEventInvolvesEntityEdge(input: {
	userId: string;
	eventId: string;
	entityId: string;
}): Promise<void> {
	const eventId = validateNonEmptyEntityId(input.eventId, 'eventId');
	const entityId = validateNonEmptyEntityId(input.entityId, 'entityId');
	await runGraphQueryWithRetry(input.userId, 'age.upsert_event_involves', async () => {
		await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (e:Event {id: $event_id, user_id: $user_id})
			MATCH (n:Entity {id: $entity_id, user_id: $user_id})
			MERGE (e)-[r:INVOLVES {user_id: $user_id}]->(n)
			SET r.updated_at = timestamp()
			RETURN 1 AS ok
			`,
				{
					event_id: eventId,
					entity_id: entityId,
					user_id: input.userId
				}
			),
			'ok agtype'
		);
	});
}

/**
 * Filter-then-traverse step 2: expand thoughts linked to seeded Event nodes (1–2 hops).
 */
export async function expandContextFromTemporalEventSeeds(input: {
	userId: string;
	eventIds: string[];
	limit: number;
}): Promise<TemporalContextHit[]> {
	const ids = input.eventIds
		.map((id) => validateNonEmptyEntityId(id, 'eventIds[]'))
		.filter((v, i, a) => a.indexOf(v) === i);
	if (ids.length === 0) return [];

	return runGraphQueryWithRetry(input.userId, 'age.expand_from_events', async () => {
		const directRows = await runAgeCypher(
			renderCypherQuery(
			`
			UNWIND $event_ids AS eid
			MATCH (t:Thought {user_id: $user_id})-[:OCCURS_IN {user_id: $user_id}]->(ev:Event {id: eid, user_id: $user_id})
			RETURN t.id AS thought_id, count(*) AS hits, collect(distinct ev.label)[0] AS via_label
			`,
				{ event_ids: ids, user_id: input.userId }
			),
			'thought_id agtype, hits agtype, via_label agtype'
		);

		const viaEntityRows = await runAgeCypher(
			renderCypherQuery(
			`
			UNWIND $event_ids AS eid
			MATCH (ev:Event {id: eid, user_id: $user_id})-[:INVOLVES {user_id: $user_id}]->(ent:Entity {user_id: $user_id})
			MATCH (t:Thought {user_id: $user_id})-[:MENTIONS {user_id: $user_id}]->(ent)
			RETURN t.id AS thought_id, count(*) AS hits, collect(distinct ent.label)[0] AS via_label
			`,
				{ event_ids: ids, user_id: input.userId }
			),
			'thought_id agtype, hits agtype, via_label agtype'
		);

		const map = new Map<string, { hits: number; provenance?: string }>();
		for (const row of [...directRows, ...viaEntityRows]) {
			const thoughtId = typeof row.thought_id === 'string' ? row.thought_id : '';
			if (!thoughtId) continue;
			const hits = typeof row.hits === 'number' ? row.hits : Number(row.hits ?? 0);
			const viaLabel = typeof row.via_label === 'string' ? row.via_label : '';
			const cur = map.get(thoughtId);
			if (!cur) {
				map.set(thoughtId, {
					hits,
					provenance: viaLabel ? `event:${viaLabel}` : 'event'
				});
			} else {
				cur.hits += hits;
			}
		}

		return [...map.entries()]
			.map(([thoughtId, v]) => ({
				thoughtId,
				hits: v.hits,
				provenance: v.provenance
			}))
			.sort((a, b) => b.hits - a.hits)
			.slice(0, input.limit);
	});
}

/**
 * Temporal graph: overlapping Event nodes sharing a person entity with distinct place entities.
 */
export async function findTemporalSchedulingConflictsInGraph(
	userId: string
): Promise<TemporalSchedulingConflictGraphHit[]> {
	return runGraphQueryWithRetry(userId, 'age.temporal_scheduling_conflicts', async () => {
		const rows = await runAgeCypher(
			renderCypherQuery(
			`
			MATCH (e1:Event {user_id: $user_id})-[:INVOLVES {user_id: $user_id}]->(person:Entity {user_id: $user_id}),
			      (e2:Event {user_id: $user_id})-[:INVOLVES {user_id: $user_id}]->(person)
			WHERE e1.id < e2.id
			  AND person.entity_type = 'person'
			  AND e1.start_at < e2.end_at
			  AND e2.start_at < e1.end_at
			MATCH (e1)-[:INVOLVES {user_id: $user_id}]->(place1:Entity {user_id: $user_id}),
			      (e2)-[:INVOLVES {user_id: $user_id}]->(place2:Entity {user_id: $user_id})
			WHERE place1.entity_type = 'place'
			  AND place2.entity_type = 'place'
			  AND place1.id <> place2.id
			MATCH (t1:Thought {user_id: $user_id})-[:OCCURS_IN {user_id: $user_id}]->(e1)
			MATCH (t2:Thought {user_id: $user_id})-[:OCCURS_IN {user_id: $user_id}]->(e2)
			RETURN
			  person.id AS person_entity_id,
			  person.label AS person_label,
			  place1.id AS place1_entity_id,
			  place1.label AS place1_label,
			  place2.id AS place2_entity_id,
			  place2.label AS place2_label,
			  e1.id AS event1_id,
			  e2.id AS event2_id,
			  e1.label AS event1_label,
			  e2.label AS event2_label,
			  t1.id AS thought1_id,
			  t2.id AS thought2_id
			`,
				{ user_id: userId }
			),
			'person_entity_id agtype, person_label agtype, place1_entity_id agtype, place1_label agtype, place2_entity_id agtype, place2_label agtype, event1_id agtype, event2_id agtype, event1_label agtype, event2_label agtype, thought1_id agtype, thought2_id agtype'
		);

		const hits: TemporalSchedulingConflictGraphHit[] = [];
		for (const row of rows) {
			const personEntityId = typeof row.person_entity_id === 'string' ? row.person_entity_id : '';
			const thought1Id = typeof row.thought1_id === 'string' ? row.thought1_id : '';
			const thought2Id = typeof row.thought2_id === 'string' ? row.thought2_id : '';
			const event1Id = typeof row.event1_id === 'string' ? row.event1_id : '';
			const event2Id = typeof row.event2_id === 'string' ? row.event2_id : '';
			if (!personEntityId || !thought1Id || !thought2Id || !event1Id || !event2Id) continue;
			hits.push({
				personEntityId,
				personLabel: typeof row.person_label === 'string' ? row.person_label : '',
				place1EntityId: typeof row.place1_entity_id === 'string' ? row.place1_entity_id : '',
				place1Label: typeof row.place1_label === 'string' ? row.place1_label : '',
				place2EntityId: typeof row.place2_entity_id === 'string' ? row.place2_entity_id : '',
				place2Label: typeof row.place2_label === 'string' ? row.place2_label : '',
				event1Id,
				event2Id,
				event1Label: typeof row.event1_label === 'string' ? row.event1_label : '',
				event2Label: typeof row.event2_label === 'string' ? row.event2_label : '',
				thought1Id,
				thought2Id
			});
		}
		return hits;
	});
}

/** Returns true when a Thought node exists for this user in the graph. */
export async function thoughtExistsInGraph(userId: string, thoughtId: string): Promise<boolean> {
	const id = validateNonEmptyEntityId(thoughtId, 'thoughtId');
	const rows = await runGraphQueryWithRetry(userId, 'age.thought_exists', async () => {
		return runAgeCypher(
			renderCypherQuery(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})
			RETURN t.id AS id
			LIMIT 1
			`,
				{
					thought_id: id,
					user_id: userId
				}
			),
			'id agtype'
		);
	});
	return rows.length > 0;
}

/** Returns all Thought node ids for this user from AGE. */
export async function fetchThoughtNodeIdsForUser(input: { userId: string }): Promise<string[]> {
	return runGraphQueryWithRetry(input.userId, 'age.fetch_thought_node_ids', async () => {
		const rows = await runAgeCypher(
			renderCypherQuery(
				`
			MATCH (t:Thought {user_id: $user_id})
			RETURN t.id AS id
			`,
				{
					user_id: input.userId
				}
			),
			'id agtype'
		);
		return rows
			.map((row) => (typeof row.id === 'string' ? row.id : ''))
			.filter((id) => id.length > 0);
	});
}
