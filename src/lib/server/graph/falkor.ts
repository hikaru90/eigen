import { env } from '$env/dynamic/private';
import { FalkorDB, type FalkorDBOptions } from 'falkordb';
import { getDb } from '$lib/server/db';
import { logActivityCall } from '$lib/server/activity/log-call';
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args';

type FalkorClient = Awaited<ReturnType<typeof FalkorDB.connect>>;

let clientPromise: Promise<FalkorClient> | null = null;

function requiredEnv(name: 'FALKOR_HOST' | 'FALKOR_PORT' | 'FALKOR_PASSWORD' | 'FALKOR_USERNAME'): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required and must be non-empty`);
	}
	return value;
}

function falkorHost(): string {
	return requiredEnv('FALKOR_HOST');
}

function falkorPort(): number {
	const raw = requiredEnv('FALKOR_PORT');
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`Invalid FALKOR_PORT: ${raw}`);
	}
	return value;
}

function normalizeGraphKeyPart(input: string): string {
	const out = input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
	const collapsed = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
	if (collapsed.length === 0) {
		throw new Error('Invalid user id for Falkor graph name: no usable characters after normalization');
	}
	return collapsed;
}

function falkorGraphForUser(userId: string): string {
	const user = normalizeGraphKeyPart(userId).slice(0, 80);
	return `user_${user}`;
}

function falkorPassword(): string {
	return requiredEnv('FALKOR_PASSWORD');
}

function falkorUsername(): string {
	return requiredEnv('FALKOR_USERNAME');
}

async function getClient(): Promise<FalkorClient> {
	if (!clientPromise) {
		const options: FalkorDBOptions = {
			socket: {
				host: falkorHost(),
				port: falkorPort()
			},
			password: falkorPassword(),
			username: falkorUsername()
		};
		clientPromise = FalkorDB.connect(options);
	}
	return clientPromise;
}

async function runFalkorQueryWithRetry<T>(
	userId: string,
	operation: string,
	query: () => Promise<T>
): Promise<T> {
	const maxAttempts = 3;
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const result = await query();
			await logActivityCall(getDb(), userId, {
				provider: 'falkor',
				operation: `${operation}.success(attempt=${attempt})`,
				baseCostUsd: 0
			});
			return result;
		} catch (err) {
			lastError = err;
			await logActivityCall(getDb(), userId, {
				provider: 'falkor',
				operation: `${operation}.error(attempt=${attempt})`,
				baseCostUsd: 0
			});
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Falkor operation failed after ${maxAttempts} attempts`);
}

export async function upsertThoughtNode(input: {
	id: string;
	userId: string;
	rawText: string;
	normalizedText: string;
	lexicalText: string;
	category: string;
}): Promise<void> {
	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	await runFalkorQueryWithRetry(input.userId, 'falkor.upsert_node', async () => {
		await graph.query(
			`
		MERGE (t:Thought {id: $id})
		SET t.user_id = $user_id,
		    t.raw_text = $raw_text,
		    t.normalized_text = $normalized_text,
		    t.lexical_text = $lexical_text,
		    t.category = $category,
		    t.updated_at = timestamp()
		RETURN t.id
			`,
			{
				params: {
					id: input.id,
					user_id: input.userId,
					raw_text: input.rawText,
					normalized_text: input.normalizedText,
					lexical_text: input.lexicalText,
					category: input.category
				}
			}
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

	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	await runFalkorQueryWithRetry(input.userId, 'falkor.upsert_relation', async () => {
		await graph.query(
			`
			MATCH (a:Thought {id: $source_id})
			MATCH (b:Thought {id: $target_id})
			MERGE (a)-[r:RELATES_TO {user_id: $user_id, type: $relation_type}]->(b)
			SET r.updated_at = timestamp()
			RETURN a.id, b.id
			`,
			{
				params: {
					source_id: sourceId,
					target_id: targetId,
					user_id: input.userId,
					relation_type: input.relationType
				}
			}
		);
	});
}

export async function expandNeighborsByIds(input: {
	userId: string;
	seedIds: string[];
	limit: number;
}): Promise<Array<{ id: string; hits: number }>> {
	const normalizedSeedIds = input.seedIds
		.map((seedId) => validateNonEmptyEntityId(seedId, 'seedIds[]'))
		.filter((value, index, self) => self.indexOf(value) === index);
	if (normalizedSeedIds.length === 0) return [];

	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	return runFalkorQueryWithRetry(input.userId, 'falkor.expand_neighbors', async () => {
		const result = (await graph.query(
			`
			UNWIND $seed_ids AS sid
			MATCH (s:Thought {id: sid, user_id: $user_id})
			MATCH (s)-[r:RELATES_TO]-(n:Thought {user_id: $user_id})
			WHERE n.id <> sid AND r.user_id = $user_id
			RETURN n.id AS id, count(r) AS hits
			ORDER BY hits DESC
			LIMIT $limit
			`,
			{
				params: {
					seed_ids: normalizedSeedIds,
					user_id: input.userId,
					limit: input.limit
				}
			}
		)) as { data?: Array<{ id: unknown; hits: unknown }> };

		const rows = result?.data ?? [];
		return rows
			.map((row) => ({
				id: typeof row.id === 'string' ? row.id : '',
				hits: typeof row.hits === 'number' ? row.hits : Number(row.hits ?? 0)
			}))
			.filter((row) => row.id);
	});
}

function graphQueryTokens(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token, index, arr) => token.length >= 2 && arr.indexOf(token) === index)
		.slice(0, 16);
}

export async function graphOnlySearchByQuery(input: {
	userId: string;
	query: string;
	limit: number;
}): Promise<Array<{ id: string; score: number }>> {
	const tokens = graphQueryTokens(input.query);
	if (tokens.length === 0) return [];

	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	return runFalkorQueryWithRetry(input.userId, 'falkor.graph_only_search', async () => {
		const result = (await graph.query(
			`
			MATCH (t:Thought {user_id: $user_id})
			WITH t, [token IN $tokens WHERE t.lexical_text CONTAINS token] AS matches
			WHERE size(matches) > 0
			WITH t, size(matches) AS overlap
			ORDER BY overlap DESC
			LIMIT $seed_limit

			OPTIONAL MATCH (t)-[r:RELATES_TO]-(n:Thought {user_id: $user_id})
			WHERE r.user_id = $user_id
			WITH t, overlap, collect(n.id) AS neighbor_ids

			UNWIND ([t.id] + neighbor_ids) AS candidate_id
			WITH candidate_id AS id, sum(overlap) AS seed_score
			RETURN id, seed_score AS score
			ORDER BY score DESC
			LIMIT $limit
			`,
			{
				params: {
					user_id: input.userId,
					tokens,
					seed_limit: Math.max(input.limit * 3, 20),
					limit: input.limit
				}
			}
		)) as { data?: Array<{ id: unknown; score: unknown }> };

		const rows = result?.data ?? [];
		return rows
			.map((row) => ({
				id: typeof row.id === 'string' ? row.id : '',
				score: typeof row.score === 'number' ? row.score : Number(row.score ?? 0)
			}))
			.filter((row) => row.id);
	});
}

/** Browser-safe snapshot for `/graph` visualization (Thought + Entity layers). */
export type GraphVizNodeKind = 'Thought' | 'Entity';

export type GraphVizNode = {
	id: string;
	kind: GraphVizNodeKind;
	label: string;
	subtype: string;
};

export type GraphVizEdgeKind = 'thought_link' | 'mention' | 'entity_relation';

export type GraphVizEdge = {
	id: string;
	sourceId: string;
	targetId: string;
	relationType: string;
	kind: GraphVizEdgeKind;
};

export async function fetchGraphVisualizationSnapshot(input: {
	userId: string;
	nodeLimit?: number;
	edgeLimit?: number;
}): Promise<{ nodes: GraphVizNode[]; edges: GraphVizEdge[] }> {
	const nodeLimit = Math.min(Math.max(input.nodeLimit ?? 400, 1), 2000);
	const edgeLimit = Math.min(Math.max(input.edgeLimit ?? 800, 1), 5000);

	return runFalkorQueryWithRetry(input.userId, 'falkor.viz_snapshot', async () => {
		const client = await getClient();
		const graph = client.selectGraph(falkorGraphForUser(input.userId));

		const thoughtNodes = (await graph.query(
			`
			MATCH (t:Thought {user_id: $user_id})
			RETURN t.id AS id,
			       coalesce(t.lexical_text, t.normalized_text, '') AS label,
			       coalesce(t.category, 'thought') AS subtype
			LIMIT $node_limit
			`,
			{ params: { user_id: input.userId, node_limit: nodeLimit } }
		)) as { data?: Array<{ id?: unknown; label?: unknown; subtype?: unknown }> };

		const entityNodes = (await graph.query(
			`
			MATCH (e:Entity {user_id: $user_id})
			RETURN e.id AS id,
			       coalesce(e.label, e.canonical_key, '') AS label,
			       coalesce(e.entity_type, 'other') AS subtype
			LIMIT $node_limit
			`,
			{ params: { user_id: input.userId, node_limit: nodeLimit } }
		)) as { data?: Array<{ id?: unknown; label?: unknown; subtype?: unknown }> };

		const relThought = (await graph.query(
			`
			MATCH (a:Thought {user_id: $user_id})-[r:RELATES_TO {user_id: $user_id}]->(b:Thought {user_id: $user_id})
			RETURN a.id AS source_id, b.id AS target_id, coalesce(r.type, 'related_to') AS rel_type
			LIMIT $edge_limit
			`,
			{ params: { user_id: input.userId, edge_limit: edgeLimit } }
		)) as { data?: Array<{ source_id?: unknown; target_id?: unknown; rel_type?: unknown }> };

		const relMentions = (await graph.query(
			`
			MATCH (a:Thought {user_id: $user_id})-[r:MENTIONS {user_id: $user_id}]->(b:Entity {user_id: $user_id})
			RETURN a.id AS source_id, b.id AS target_id, 'mentions' AS rel_type
			LIMIT $edge_limit
			`,
			{ params: { user_id: input.userId, edge_limit: edgeLimit } }
		)) as { data?: Array<{ source_id?: unknown; target_id?: unknown; rel_type?: unknown }> };

		const relEntity = (await graph.query(
			`
			MATCH (a:Entity {user_id: $user_id})-[r:ENTITY_RELATES {user_id: $user_id}]->(b:Entity {user_id: $user_id})
			RETURN a.id AS source_id, b.id AS target_id, coalesce(r.predicate, 'related_to') AS rel_type
			LIMIT $edge_limit
			`,
			{ params: { user_id: input.userId, edge_limit: edgeLimit } }
		)) as { data?: Array<{ source_id?: unknown; target_id?: unknown; rel_type?: unknown }> };

		const nodes: GraphVizNode[] = [];
		const seenNode = new Set<string>();

		for (const row of thoughtNodes.data ?? []) {
			const id = typeof row.id === 'string' ? row.id : '';
			if (!id || seenNode.has(id)) continue;
			seenNode.add(id);
			nodes.push({
				id,
				kind: 'Thought',
				label: typeof row.label === 'string' ? row.label : String(row.label ?? ''),
				subtype: typeof row.subtype === 'string' ? row.subtype : String(row.subtype ?? '')
			});
		}
		for (const row of entityNodes.data ?? []) {
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

		for (const row of relThought.data ?? []) {
			const s = typeof row.source_id === 'string' ? row.source_id : '';
			const t = typeof row.target_id === 'string' ? row.target_id : '';
			const rt = typeof row.rel_type === 'string' ? row.rel_type : 'related_to';
			if (s && t) pushEdge(s, t, rt, 'thought_link');
		}
		for (const row of relMentions.data ?? []) {
			const s = typeof row.source_id === 'string' ? row.source_id : '';
			const t = typeof row.target_id === 'string' ? row.target_id : '';
			const rt = typeof row.rel_type === 'string' ? row.rel_type : 'mentions';
			if (s && t) pushEdge(s, t, rt, 'mention');
		}
		for (const row of relEntity.data ?? []) {
			const s = typeof row.source_id === 'string' ? row.source_id : '';
			const t = typeof row.target_id === 'string' ? row.target_id : '';
			const rt = typeof row.rel_type === 'string' ? row.rel_type : 'related_to';
			if (s && t) pushEdge(s, t, rt, 'entity_relation');
		}

		return { nodes, edges };
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
	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	await runFalkorQueryWithRetry(input.userId, 'falkor.upsert_entity', async () => {
		await graph.query(
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
				params: {
					id,
					user_id: input.userId,
					canonical_key: input.canonicalKey,
					label: input.label,
					entity_type: input.entityType
				}
			}
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

	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	await runFalkorQueryWithRetry(input.userId, 'falkor.upsert_mention', async () => {
		await graph.query(
			`
			MATCH (t:Thought {id: $thought_id, user_id: $user_id})
			MATCH (e:Entity {id: $entity_id, user_id: $user_id})
			MERGE (t)-[r:MENTIONS {user_id: $user_id}]->(e)
			SET r.updated_at = timestamp()
			RETURN t.id, e.id
			`,
			{
				params: {
					thought_id: thoughtId,
					entity_id: entityId,
					user_id: input.userId
				}
			}
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

	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	await runFalkorQueryWithRetry(input.userId, 'falkor.upsert_entity_relation', async () => {
		await graph.query(
			`
			MATCH (a:Entity {id: $a_id, user_id: $user_id})
			MATCH (b:Entity {id: $b_id, user_id: $user_id})
			MERGE (a)-[r:ENTITY_RELATES {user_id: $user_id, predicate: $predicate}]->(b)
			SET r.updated_at = timestamp()
			RETURN a.id, b.id
			`,
			{
				params: {
					a_id: sourceEntityId,
					b_id: targetEntityId,
					user_id: input.userId,
					predicate: input.predicate
				}
			}
		);
	});
}

export type EntityThoughtHit = { id: string; hits: number; provenance?: string };

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

	const client = await getClient();
	const graph = client.selectGraph(falkorGraphForUser(input.userId));
	return runFalkorQueryWithRetry(input.userId, 'falkor.expand_from_entities', async () => {
		const direct = (await graph.query(
			`
			UNWIND $entity_ids AS eid
			MATCH (t:Thought {user_id: $user_id})-[:MENTIONS {user_id: $user_id}]->(e:Entity {id: eid, user_id: $user_id})
			RETURN t.id AS id, count(*) AS hits, collect(distinct e.label)[0] AS via_label
			`,
			{ params: { entity_ids: ids, user_id: input.userId } }
		)) as { data?: Array<{ id?: unknown; hits?: unknown; via_label?: unknown }> };

		const hop = (await graph.query(
			`
			UNWIND $entity_ids AS eid
			MATCH (e:Entity {id: eid, user_id: $user_id})-[:ENTITY_RELATES {user_id: $user_id}]-(e2:Entity {user_id: $user_id})
			MATCH (t:Thought {user_id: $user_id})-[:MENTIONS {user_id: $user_id}]->(e2)
			RETURN t.id AS id, count(*) AS hits, collect(distinct e2.label)[0] AS via_label
			`,
			{ params: { entity_ids: ids, user_id: input.userId } }
		)) as { data?: Array<{ id?: unknown; hits?: unknown; via_label?: unknown }> };

		const directHits: EntityThoughtHit[] = (direct.data ?? []).map((row) => ({
			id: typeof row.id === 'string' ? row.id : '',
			hits: typeof row.hits === 'number' ? row.hits : Number(row.hits ?? 0),
			provenance:
				typeof row.via_label === 'string' && row.via_label
					? `entity:${row.via_label}`
					: undefined
		}));

		const hopHits: EntityThoughtHit[] = (hop.data ?? []).map((row) => ({
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
