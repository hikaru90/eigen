import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { lexicalSearch } from '$lib/server/retrieval/lexical';
import { reciprocalRankFusion } from '$lib/server/retrieval/fusion';
import { expandNeighborsByIds, expandThoughtIdsFromEntitySeeds } from '$lib/server/graph/age';
import type { EntityThoughtHit } from '$lib/server/graph/age';
import { matchCanonicalEntitiesByEmbedding } from '$lib/server/memory/entity-resolution';
import {
	findTemporalSchedulingConflicts,
	isSchedulingConflictQuery
} from '$lib/server/retrieval/temporal-conflicts';
import {
	filterTemporalEvents,
	isTemporalQuery,
	traverseTemporalContext
} from '$lib/server/retrieval/temporal';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import { createPhaseTimer, logRetrievalPhaseTiming } from '$lib/server/retrieval/phase-timing';

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

export type RetrievalResult = {
	id: string;
	normalizedText: string;
	category: string;
	memoryType: string | null;
	score: number;
	vectorScore: number;
	graphScore: number;
	metadata: Record<string, unknown>;
	createdAt: Date;
};

type RetrievalWeights = { vector: number; graph: number };

export type RetrievalMode = 'fast' | 'full';

const RRF_K = 60;

type GraphHit = { id: string; hits: number; provenance?: string };

type RowStub = {
	id: string;
	normalizedText: string;
	normalizedTextEncrypted?: string | null;
	category: string;
	memoryType: string | null;
	metadata: Record<string, unknown>;
	metadataEncrypted?: string | null;
	createdAt: Date;
};

/** Neighbor + entity-anchored graph expansion merged by hit count. */
function mergeGraphHitMaps(
	thoughtNeighbors: GraphHit[],
	entityHits: EntityThoughtHit[]
): GraphHit[] {
	const map = new Map<string, { hits: number; provenance?: string }>();
	for (const n of thoughtNeighbors) {
		const cur = map.get(n.id);
		if (!cur) map.set(n.id, { hits: n.hits, provenance: n.provenance });
		else {
			cur.hits += n.hits;
			if (n.provenance && !cur.provenance) cur.provenance = n.provenance;
		}
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

function candidateLimitForMode(mode: RetrievalMode, limit: number): number {
	if (mode === 'fast') return Math.min(limit + 5, 20);
	return Math.max(limit * 2, 20);
}

/**
 * Hybrid retrieval over three channels:
 *
 *   - vector  (pgvector cosine distance)
 *   - lexical (Postgres ts_rank_cd over precomputed lexical_text)
 *   - graph   (Apache AGE neighbor expansion from semantic seeds)
 *
 * `mode: 'fast'` skips graph, entity, temporal, and connected-only hydration.
 *
 * Pass `queryEmbedding` to skip the embedding LLM call (e.g. when the caller
 * already embedded the same text earlier in the pipeline).
 */
export async function searchThoughts(params: {
	userId: string;
	query: string;
	topK?: number;
	weights?: RetrievalWeights;
	mode?: RetrievalMode;
	/** Pre-computed embedding for `query`. Skips the embedding LLM call when provided. */
	queryEmbedding?: number[];
}): Promise<RetrievalResult[]> {
	const timer = createPhaseTimer();
	const mode: RetrievalMode = params.mode ?? 'full';
	const topK = params.topK ?? 20;
	const limit = Math.max(1, Math.min(topK, 100));
	const weights: RetrievalWeights = params.weights ?? CONTEXT_WEIGHTS.default;
	const candidateLimit = candidateLimitForMode(mode, limit);

	timer.mark('embed');
	const queryEmbedding =
		params.queryEmbedding ?? (await createThoughtEmbedding(params.userId, params.query));

	const decryptRow = async (row: RowStub): Promise<RowStub> => {
		const [normalizedText, metadataJson] = await Promise.all([
			row.normalizedTextEncrypted
				? decryptTenantValue({
						userId: params.userId,
						table: 'thought',
						column: 'normalized_text',
						ciphertext: row.normalizedTextEncrypted
					})
				: Promise.resolve(row.normalizedText),
			row.metadataEncrypted
				? decryptTenantValue({
						userId: params.userId,
						table: 'thought',
						column: 'metadata',
						ciphertext: row.metadataEncrypted
					})
				: Promise.resolve(JSON.stringify(row.metadata ?? {}))
		]);
		return {
			...row,
			normalizedText,
			metadata: JSON.parse(metadataJson) as Record<string, unknown>
		};
	};

	const vectorLiteral = toVectorLiteral(queryEmbedding);
	const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`;

	timer.mark('vector');
	timer.mark('lexical');

	const vectorQuery = getDb()
		.select({
			id: thought.id,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			category: thought.category,
			memoryType: thought.memoryType,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted,
			createdAt: thought.createdAt,
			distance: vectorDistance
		})
		.from(thought)
		.where(and(eq(thought.userId, params.userId), isNotNull(thought.embedding)))
		.orderBy(vectorDistance)
		.limit(candidateLimit);

	const lexicalQuery = lexicalSearch({
		userId: params.userId,
		query: params.query,
		limit: candidateLimit
	});

	let temporalSeeds: Awaited<ReturnType<typeof filterTemporalEvents>> = [];
	let temporalContextHits: Awaited<ReturnType<typeof traverseTemporalContext>> = [];
	let entityMatches: Awaited<ReturnType<typeof matchCanonicalEntitiesByEmbedding>> = [];

	if (mode === 'full') {
		timer.mark('entity');
		const [vectorRows, lexicalRows, temporalSeedRows, entityMatchRows] = await Promise.all([
			vectorQuery,
			lexicalQuery,
			isTemporalQuery(params.query)
				? filterTemporalEvents({
						userId: params.userId,
						query: params.query,
						queryEmbedding,
						limit: candidateLimit
					})
				: Promise.resolve([]),
			matchCanonicalEntitiesByEmbedding({
				userId: params.userId,
				embedding: queryEmbedding,
				limit: 12
			})
		]);
		temporalSeeds = temporalSeedRows;
		entityMatches = entityMatchRows;

		if (temporalSeeds.length > 0) {
			temporalContextHits = await traverseTemporalContext({
				userId: params.userId,
				seeds: temporalSeeds,
				limit: candidateLimit
			});
		}

		const vectorRanks = new Map<string, number>();
		vectorRows.forEach((row, index) => vectorRanks.set(row.id, index + 1));
		const lexicalRanks = new Map<string, number>();
		lexicalRows.forEach((row, index) => lexicalRanks.set(row.id, index + 1));

		const fusedSemantic = reciprocalRankFusion([
			vectorRows.map((row, index) => ({ id: row.id, rank: index + 1 })),
			lexicalRows.map((row, index) => ({ id: row.id, rank: index + 1 }))
		]);
		const semanticSeedIds = [...fusedSemantic.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, candidateLimit)
			.map(([id]) => id);

		timer.mark('graph');
		const ENTITY_MATCH_MAX_DISTANCE = 0.48;
		const entityIds = entityMatches
			.filter((m) => m.distance < ENTITY_MATCH_MAX_DISTANCE)
			.map((m) => m.id);

		const [graphNeighbors, entityThoughtHits] = await Promise.all([
			expandNeighborsByIds({
				userId: params.userId,
				seedIds: semanticSeedIds,
				limit: candidateLimit
			}),
			entityIds.length > 0
				? expandThoughtIdsFromEntitySeeds({
						userId: params.userId,
						entityIds,
						limit: candidateLimit
					})
				: Promise.resolve([])
		]);

		const temporalGraphHits = temporalContextHits.map((h) => ({
			id: h.thoughtId,
			hits: h.hits,
			provenance: h.provenance
		}));

		const mergedGraphHits = mergeGraphHitMaps(
			mergeGraphHitMaps(graphNeighbors, entityThoughtHits),
			temporalGraphHits
		);
		const graphProvenanceByThoughtId = new Map<string, string>();
		for (const row of mergedGraphHits) {
			if (row.provenance) graphProvenanceByThoughtId.set(row.id, row.provenance);
		}

		const graphRanks = new Map<string, number>();
		[...mergedGraphHits]
			.sort((a, b) => b.hits - a.hits)
			.forEach((neighbor, index) => graphRanks.set(neighbor.id, index + 1));

		const temporalThoughtIds = [
			...temporalSeeds.map((s) => s.thoughtId),
			...temporalContextHits.map((h) => h.thoughtId)
		];

		const schedulingConflicts = isSchedulingConflictQuery(params.query)
			? await findTemporalSchedulingConflicts({
					userId: params.userId,
					query: params.query
				})
			: [];
		const conflictThoughtIds = [...new Set(schedulingConflicts.flatMap((c) => c.thoughtIds))];
		for (const thoughtId of conflictThoughtIds) {
			graphRanks.set(thoughtId, 1);
			graphProvenanceByThoughtId.set(
				thoughtId,
				graphProvenanceByThoughtId.get(thoughtId) ?? 'temporal:scheduling_conflict'
			);
		}

		const semanticIds = new Set<string>([...vectorRanks.keys(), ...lexicalRanks.keys()]);
		const connectedOnlyIds = [
			...graphRanks.keys(),
			...temporalThoughtIds,
			...conflictThoughtIds
		].filter((id) => !semanticIds.has(id));

		type RowMeta = {
			normalizedText: string;
			category: string;
			memoryType: string | null;
			metadata: Record<string, unknown>;
			createdAt: Date;
			normalizedTextEncrypted?: string | null;
			metadataEncrypted?: string | null;
		};
		const metaById = new Map<string, RowMeta>();

		const recordMeta = (
			id: string,
			source: {
				normalizedText: string;
				category: string;
				memoryType?: string | null;
				metadata: unknown;
				createdAt?: Date | null;
				normalizedTextEncrypted?: string | null;
				metadataEncrypted?: string | null;
			},
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
				normalizedText: source.normalizedText,
				category: source.category,
				memoryType: source.memoryType ?? prev?.memoryType ?? null,
				metadata: mergedMeta,
				createdAt: source.createdAt ?? prev?.createdAt ?? new Date(0),
				normalizedTextEncrypted: source.normalizedTextEncrypted ?? prev?.normalizedTextEncrypted,
				metadataEncrypted: source.metadataEncrypted ?? prev?.metadataEncrypted
			});
		};

		for (const row of vectorRows) recordMeta(row.id, row);
		for (const row of lexicalRows) recordMeta(row.id, row);

		timer.mark('hydrate');
		const connectedRows =
			connectedOnlyIds.length === 0
				? []
				: await getDb()
						.select({
							id: thought.id,
							normalizedText: thought.normalizedText,
							normalizedTextEncrypted: thought.normalizedTextEncrypted,
							category: thought.category,
							memoryType: thought.memoryType,
							metadata: thought.metadata,
							metadataEncrypted: thought.metadataEncrypted,
							createdAt: thought.createdAt
						})
						.from(thought)
						.where(and(eq(thought.userId, params.userId), inArray(thought.id, connectedOnlyIds)));

		for (const row of connectedRows) {
			recordMeta(row.id, row, graphProvenanceByThoughtId.get(row.id));
		}

		for (const seed of temporalSeeds) {
			const existing = metaById.get(seed.thoughtId);
			const temporalMeta = {
				temporalEventId: seed.eventId,
				semanticSummary: seed.semanticSummary,
				temporalScore: seed.score
			};
			if (existing) {
				metaById.set(seed.thoughtId, {
					...existing,
					metadata: { ...existing.metadata, ...temporalMeta }
				});
			}
		}

		for (const [thoughtId, prov] of graphProvenanceByThoughtId) {
			if (!semanticIds.has(thoughtId) || !prov) continue;
			const existing = metaById.get(thoughtId);
			if (!existing) continue;
			if (!existing.metadata.graphProvenance) {
				metaById.set(thoughtId, {
					...existing,
					metadata: { ...existing.metadata, graphProvenance: prov }
				});
			}
		}

		timer.mark('fuse');
		const candidateIds = new Set<string>([
			...vectorRanks.keys(),
			...lexicalRanks.keys(),
			...graphRanks.keys(),
			...temporalThoughtIds,
			...conflictThoughtIds
		]);

		const scoredIds = [...candidateIds]
			.map((id) => {
				const meta = metaById.get(id);
				if (!meta) return null;
				const vectorScore =
					rrfContribution(vectorRanks.get(id), weights.vector) +
					rrfContribution(lexicalRanks.get(id), weights.vector);
				const graphScore = rrfContribution(graphRanks.get(id), weights.graph);
				const score = vectorScore + graphScore;
				if (score <= 0) return null;
				return { id, meta, vectorScore, graphScore, score };
			})
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		timer.mark('decrypt');
		const scored = await Promise.all(
			scoredIds.map(async ({ id, meta, vectorScore, graphScore, score }) => {
				const decrypted = await decryptRow({
					id,
					normalizedText: meta.normalizedText,
					normalizedTextEncrypted: meta.normalizedTextEncrypted,
					category: meta.category,
					memoryType: meta.memoryType,
					metadata: meta.metadata,
					metadataEncrypted: meta.metadataEncrypted,
					createdAt: meta.createdAt
				});
				return {
					id,
					normalizedText: decrypted.normalizedText,
					category: decrypted.category,
					memoryType: decrypted.memoryType,
					metadata: decrypted.metadata,
					createdAt: decrypted.createdAt,
					vectorScore,
					graphScore,
					score
				};
			})
		);

		void bumpAccessAsync(
			params.userId,
			scored.map((r) => r.id)
		);
		logRetrievalPhaseTiming({
			userId: params.userId,
			query: params.query,
			mode,
			topK: limit,
			timing: timer.finish()
		});
		return scored;
	}

	// Fast mode: vector + lexical only.
	const [vectorRows, lexicalRows] = await Promise.all([vectorQuery, lexicalQuery]);

	const vectorRanks = new Map<string, number>();
	vectorRows.forEach((row, index) => vectorRanks.set(row.id, index + 1));
	const lexicalRanks = new Map<string, number>();
	lexicalRows.forEach((row, index) => lexicalRanks.set(row.id, index + 1));

	type RowMeta = {
		normalizedText: string;
		category: string;
		memoryType: string | null;
		metadata: Record<string, unknown>;
		createdAt: Date;
		normalizedTextEncrypted?: string | null;
		metadataEncrypted?: string | null;
	};
	const metaById = new Map<string, RowMeta>();

	const recordMeta = (id: string, source: RowMeta) => {
		const prev = metaById.get(id);
		metaById.set(id, {
			normalizedText: source.normalizedText,
			category: source.category,
			memoryType: source.memoryType ?? prev?.memoryType ?? null,
			metadata: { ...(prev?.metadata ?? {}), ...(source.metadata ?? {}) },
			createdAt: source.createdAt ?? prev?.createdAt ?? new Date(0),
			normalizedTextEncrypted: source.normalizedTextEncrypted ?? prev?.normalizedTextEncrypted,
			metadataEncrypted: source.metadataEncrypted ?? prev?.metadataEncrypted
		});
	};

	for (const row of vectorRows) {
		recordMeta(row.id, {
			normalizedText: row.normalizedText,
			category: row.category,
			memoryType: row.memoryType,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			createdAt: row.createdAt,
			normalizedTextEncrypted: row.normalizedTextEncrypted,
			metadataEncrypted: row.metadataEncrypted
		});
	}
	for (const row of lexicalRows) {
		recordMeta(row.id, {
			normalizedText: row.normalizedText,
			category: row.category,
			memoryType: null,
			metadata: row.metadata,
			createdAt: row.createdAt
		});
	}

	timer.mark('fuse');
	const candidateIds = new Set<string>([...vectorRanks.keys(), ...lexicalRanks.keys()]);
	const scoredIds = [...candidateIds]
		.map((id) => {
			const meta = metaById.get(id);
			if (!meta) return null;
			const vectorScore =
				rrfContribution(vectorRanks.get(id), weights.vector) +
				rrfContribution(lexicalRanks.get(id), weights.vector);
			const score = vectorScore;
			if (score <= 0) return null;
			return { id, meta, vectorScore, graphScore: 0, score };
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	timer.mark('decrypt');
	const scored = await Promise.all(
		scoredIds.map(async ({ id, meta, vectorScore, graphScore, score }) => {
			const decrypted = await decryptRow({
				id,
				normalizedText: meta.normalizedText,
				normalizedTextEncrypted: meta.normalizedTextEncrypted,
				category: meta.category,
				memoryType: meta.memoryType,
				metadata: meta.metadata,
				metadataEncrypted: meta.metadataEncrypted,
				createdAt: meta.createdAt
			});
			return {
				id,
				normalizedText: decrypted.normalizedText,
				category: decrypted.category,
				memoryType: decrypted.memoryType,
				metadata: decrypted.metadata,
				createdAt: decrypted.createdAt,
				vectorScore,
				graphScore,
				score
			};
		})
	);

	void bumpAccessAsync(
		params.userId,
		scored.map((r) => r.id)
	);
	logRetrievalPhaseTiming({
		userId: params.userId,
		query: params.query,
		mode,
		topK: limit,
		timing: timer.finish()
	});
	return scored;
}
