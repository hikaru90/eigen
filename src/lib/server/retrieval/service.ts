import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { lexicalSearch } from '$lib/server/retrieval/lexical';
import { reciprocalRankFusion } from '$lib/server/retrieval/fusion';
import { expandNeighborsByIds, expandThoughtIdsFromEntitySeeds } from '$lib/server/graph/falkor';
import type { EntityThoughtHit } from '$lib/server/graph/falkor';
import { matchCanonicalEntitiesByEmbedding } from '$lib/server/memory/entity-resolution';

/** Salience cap — prevents unbounded growth from high-frequency retrieval. */
const SALIENCE_MAX = 5.0;
/** Per-retrieval salience boost. */
const SALIENCE_BOOST = 0.05;

/**
 * Fire-and-forget: bump salience_score and access_count for thoughts that were
 * returned in a retrieval result. This is the reconsolidation signal — the system
 * learns what memories are actually useful from how often they surface.
 *
 * Never throws; failures are logged and ignored.
 */
async function bumpAccessAsync(userId: string, ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	try {
		await getDb()
			.update(thought)
			.set({
				accessCount: sql`${thought.accessCount} + 1`,
				lastAccessedAt: new Date(),
				salienceScore: sql`LEAST(${thought.salienceScore} + ${SALIENCE_BOOST}, ${SALIENCE_MAX})`
			})
			.where(and(eq(thought.userId, userId), inArray(thought.id, ids)));
	} catch (err) {
		console.warn('[retrieval.reconsolidation] salience bump failed', {
			userId,
			count: ids.length,
			message: err instanceof Error ? err.message : String(err)
		});
	}
}

type RetrievalResult = {
	id: string;
	normalizedText: string;
	category: string;
	score: number;
	vectorScore: number;
	graphScore: number;
	metadata: Record<string, unknown>;
};

type RetrievalWeights = { vector: number; graph: number };

const RRF_K = 60;

/** Neighbor + entity-anchored graph expansion merged by hit count. */
function mergeGraphHitMaps(
	thoughtNeighbors: Array<{ id: string; hits: number }>,
	entityHits: EntityThoughtHit[]
): Array<{ id: string; hits: number; provenance?: string }> {
	const map = new Map<string, { hits: number; provenance?: string }>();
	for (const n of thoughtNeighbors) {
		const cur = map.get(n.id);
		if (!cur) map.set(n.id, { hits: n.hits });
		else cur.hits += n.hits;
	}
	for (const e of entityHits) {
		const cur = map.get(e.id);
		if (!cur) {
			map.set(e.id, { hits: e.hits, provenance: e.provenance });
		} else {
			cur.hits += e.hits;
			if (e.provenance && !cur.provenance) cur.provenance = e.provenance;
		}
	}
	return [...map.entries()].map(([id, v]) => ({ id, hits: v.hits, provenance: v.provenance }));
}

function rrfContribution(rank: number | undefined, weight: number): number {
	if (rank === undefined || weight === 0) return 0;
	return weight * (1 / (RRF_K + rank));
}

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

/**
 * Hybrid retrieval over three channels:
 *
 *   - vector  (pgvector cosine distance)
 *   - lexical (Postgres ts_rank_cd over precomputed lexical_text)
 *   - graph   (FalkorDB neighbor expansion from semantic seeds)
 *
 * Channels are merged via weighted reciprocal rank fusion. Vector and lexical
 * share the "semantic" weight (`weights.vector`) because lexical is the keyword
 * complement of the embedding signal; graph contributes via `weights.graph`.
 * `weights = {vector: 0, graph: 1}` therefore yields graph-only behavior, and
 * `{vector: 1, graph: 0}` yields the semantic (vector + lexical) channel only,
 * matching the eval harness's preset semantics.
 */
export async function searchThoughts(params: {
	userId: string;
	query: string;
	topK?: number;
	weights?: RetrievalWeights;
}): Promise<RetrievalResult[]> {
	const topK = params.topK ?? 20;
	const limit = Math.max(1, Math.min(topK, 100));
	const weights: RetrievalWeights = params.weights ?? CONTEXT_WEIGHTS.default;
	const candidateLimit = Math.max(limit * 2, 20);

	const queryEmbedding = await createThoughtEmbedding(params.userId, params.query);
	const vectorLiteral = toVectorLiteral(queryEmbedding);
	const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`;

	const vectorRows = await getDb()
		.select({
			id: thought.id,
			normalizedText: thought.normalizedText,
			category: thought.category,
			metadata: thought.metadata,
			distance: vectorDistance
		})
		.from(thought)
		.where(and(eq(thought.userId, params.userId), isNotNull(thought.embedding)))
		.orderBy(vectorDistance)
		.limit(candidateLimit);

	const lexicalRows = await lexicalSearch({
		userId: params.userId,
		query: params.query,
		limit: candidateLimit
	});

	if (vectorRows.length === 0 && lexicalRows.length === 0) return [];

	const vectorRanks = new Map<string, number>();
	vectorRows.forEach((row, index) => vectorRanks.set(row.id, index + 1));
	const lexicalRanks = new Map<string, number>();
	lexicalRows.forEach((row, index) => lexicalRanks.set(row.id, index + 1));

	// Seed graph expansion from the RRF-fused semantic top so we expand from the
	// best joint vector+lexical evidence rather than only the vector top.
	const fusedSemantic = reciprocalRankFusion([
		vectorRows.map((row, index) => ({ id: row.id, rank: index + 1 })),
		lexicalRows.map((row, index) => ({ id: row.id, rank: index + 1 }))
	]);
	const semanticSeedIds = [...fusedSemantic.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, candidateLimit)
		.map(([id]) => id);

	const graphNeighbors = await expandNeighborsByIds({
		userId: params.userId,
		seedIds: semanticSeedIds,
		limit: candidateLimit
	});

	const entityMatches = await matchCanonicalEntitiesByEmbedding({
		userId: params.userId,
		embedding: queryEmbedding,
		limit: 12
	});

	const ENTITY_MATCH_MAX_DISTANCE = 0.48;
	const entityIds = entityMatches
		.filter((m) => m.distance < ENTITY_MATCH_MAX_DISTANCE)
		.map((m) => m.id);

	const entityThoughtHits =
		entityIds.length > 0
			? await expandThoughtIdsFromEntitySeeds({
					userId: params.userId,
					entityIds,
					limit: candidateLimit
				})
			: [];

	const mergedGraphHits = mergeGraphHitMaps(graphNeighbors, entityThoughtHits);
	const graphProvenanceByThoughtId = new Map<string, string>();
	for (const row of mergedGraphHits) {
		if (row.provenance) {
			graphProvenanceByThoughtId.set(row.id, row.provenance);
		}
	}

	// Convert neighbor hit-counts into a deterministic rank list (more shared
	// seeds => higher rank) so graph contributes to RRF on equal footing.
	const graphRanks = new Map<string, number>();
	[...mergedGraphHits]
		.sort((a, b) => b.hits - a.hits)
		.forEach((neighbor, index) => graphRanks.set(neighbor.id, index + 1));

	const semanticIds = new Set<string>([...vectorRanks.keys(), ...lexicalRanks.keys()]);
	const connectedOnlyIds = [...graphRanks.keys()].filter((id) => !semanticIds.has(id));
	const connectedRows =
		connectedOnlyIds.length === 0
			? []
			: await getDb()
					.select({
						id: thought.id,
						normalizedText: thought.normalizedText,
						category: thought.category,
						metadata: thought.metadata
					})
					.from(thought)
					.where(and(eq(thought.userId, params.userId), inArray(thought.id, connectedOnlyIds)));

	type RowMeta = {
		normalizedText: string;
		category: string;
		metadata: Record<string, unknown>;
	};
	const metaById = new Map<string, RowMeta>();
	const recordMeta = (
		id: string,
		source: { normalizedText: string; category: string; metadata: unknown },
		graphProvenance?: string
	) => {
		const prev = metaById.get(id);
		const incomingMeta = (source.metadata as Record<string, unknown>) ?? {};
		const mergedMeta: Record<string, unknown> = {
			...(prev?.metadata ?? {}),
			...incomingMeta,
			...(graphProvenance ? { graphProvenance } : {})
		};
		metaById.set(id, {
			normalizedText: prev?.normalizedText ?? source.normalizedText,
			category: prev?.category ?? source.category,
			metadata: mergedMeta
		});
	};
	for (const row of vectorRows) recordMeta(row.id, row);
	for (const row of lexicalRows) recordMeta(row.id, row);
	for (const row of connectedRows)
		recordMeta(row.id, row, graphProvenanceByThoughtId.get(row.id));

	// Attach entity-graph provenance even when the thought was also a semantic hit.
	for (const [thoughtId, prov] of graphProvenanceByThoughtId) {
		if (!semanticIds.has(thoughtId)) continue;
		const existing = metaById.get(thoughtId);
		if (existing && typeof existing.metadata.graphProvenance !== 'string') {
			metaById.set(thoughtId, {
				...existing,
				metadata: { ...existing.metadata, graphProvenance: prov }
			});
		}
	}

	const candidateIds = new Set<string>([
		...vectorRanks.keys(),
		...lexicalRanks.keys(),
		...graphRanks.keys()
	]);

	const scored = [...candidateIds]
		.map((id) => {
			const meta = metaById.get(id);
			if (!meta) return null;
			const vectorScore =
				rrfContribution(vectorRanks.get(id), weights.vector) +
				rrfContribution(lexicalRanks.get(id), weights.vector);
			const graphScore = rrfContribution(graphRanks.get(id), weights.graph);
			return {
				id,
				normalizedText: meta.normalizedText,
				category: meta.category,
				metadata: meta.metadata,
				vectorScore,
				graphScore,
				score: vectorScore + graphScore
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	// Reconsolidation: bump salience for returned thoughts (fire-and-forget).
	void bumpAccessAsync(params.userId, scored.map((r) => r.id));

	return scored;
}
