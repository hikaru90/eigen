/**
 * Unified retrieval — one path for MCP, HTTP, and compose.
 *
 * Query time: embed once → parallel ANN/FTS → bundle/key fetch → weighted merge → rerank.
 * No live AGE graph traversal.
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import {
	communityBundle,
	communitySummary,
	entityTopThoughts,
	thought,
	thoughtNeighbor
} from '$lib/server/db/schema';
import { lexicalSearch } from '$lib/server/retrieval/lexical';
import { matchCanonicalEntitiesByEmbedding } from '$lib/server/memory/entity-resolution';
import { rerankCandidates, shouldSkipRerank, type RerankCandidate } from '$lib/server/retrieval/reranker';
import { createPhaseTimer, logRetrievalPhaseTiming } from '$lib/server/retrieval/phase-timing';
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption';
import {
	filterTemporalEvents,
	isTemporalQuery,
	type TemporalSearchHit
} from '$lib/server/retrieval/temporal';
import {
	findTemporalSchedulingConflicts,
	isSchedulingConflictQuery
} from '$lib/server/retrieval/temporal-conflicts';
import type { RetrievalResult } from '$lib/server/retrieval/service';

const THOUGHT_ANN_LIMIT = 30;
const COMMUNITY_ANN_LIMIT = 12;
const ENTITY_ANN_LIMIT = 20;
const NEIGHBOR_PER_SEED = 2;
const MERGE_CANDIDATE_CAP = 80;
const RERANK_POOL = 15;

const SCORE_WEIGHTS = {
	thoughtSim: 0.42,
	communitySim: 0.25,
	entitySim: 0.1,
	centrality: 0.08,
	specificity: 0.05,
	salience: 0.04,
	recency: 0.06
} as const;

const SALIENCE_MAX = 5.0;
const SALIENCE_BOOST = 0.05;

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

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

function cosineSimilarityFromDistance(distance: number): number {
	return Math.max(0, 1 - distance);
}

type CandidateSource =
	| 'vector'
	| 'lexical'
	| 'community_bundle'
	| 'entity_top'
	| 'neighbor'
	| 'temporal';

type ScoredCandidate = {
	id: string;
	sources: Set<CandidateSource>;
	vectorDistance?: number;
	communityDistance?: number;
	entityDistance?: number;
	bundleRank?: number;
};

function redundancyPenalty(
	candidate: ScoredCandidate,
	seenCommunityIds: Map<string, number>
): number {
	let penalty = 0;
	if (candidate.sources.has('community_bundle')) penalty += 0.05;
	const communityHits = candidate.communityDistance !== undefined ? 1 : 0;
	if (communityHits > 0) {
		for (const [, count] of seenCommunityIds) {
			if (count > 2) penalty += 0.02;
		}
	}
	return Math.min(0.15, penalty);
}

async function fetchCommunityAnn(
	userId: string,
	queryEmbedding: number[],
	limit: number
): Promise<Array<{ communityId: string; distance: number }>> {
	const vectorLiteral = toVectorLiteral(queryEmbedding);
	const distanceExpr = sql<number>`${communitySummary.summaryEmbedding} <=> ${vectorLiteral}::vector`;
	const db = getDb();
	const rows = await db
		.select({
			communityId: communitySummary.communityId,
			distance: distanceExpr
		})
		.from(communitySummary)
		.where(
			and(
				eq(communitySummary.userId, userId),
				eq(communitySummary.level, 1),
				isNotNull(communitySummary.summaryEmbedding)
			)
		)
		.orderBy(distanceExpr)
		.limit(limit);
	return rows;
}

export async function retrieveEvidence(params: {
	userId: string;
	query: string;
	topK?: number;
	queryEmbedding?: number[];
}): Promise<RetrievalResult[]> {
	const timer = createPhaseTimer();
	const limit = Math.max(1, Math.min(params.topK ?? 12, 100));

	timer.mark('embed');
	const queryEmbedding =
		params.queryEmbedding ?? (await createThoughtEmbedding(params.userId, params.query));
	const vectorLiteral = toVectorLiteral(queryEmbedding);
	const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`;

	timer.mark('vector');
	timer.mark('lexical');
	timer.mark('entity');

	const db = getDb();
	const vectorQuery = db
		.select({
			id: thought.id,
			distance: vectorDistance
		})
		.from(thought)
		.where(and(eq(thought.userId, params.userId), isNotNull(thought.embedding)))
		.orderBy(vectorDistance)
		.limit(THOUGHT_ANN_LIMIT);

	const lexicalQuery = lexicalSearch({
		userId: params.userId,
		query: params.query,
		limit: THOUGHT_ANN_LIMIT
	});

	const entityQuery = matchCanonicalEntitiesByEmbedding({
		userId: params.userId,
		embedding: queryEmbedding,
		limit: ENTITY_ANN_LIMIT
	});

	const communityQuery = fetchCommunityAnn(params.userId, queryEmbedding, COMMUNITY_ANN_LIMIT);

	const temporalQuery = isTemporalQuery(params.query)
		? filterTemporalEvents({
				userId: params.userId,
				query: params.query,
				queryEmbedding,
				limit: 15
			})
		: Promise.resolve([] as TemporalSearchHit[]);

	const [vectorRows, lexicalRows, entityMatches, communities, temporalHits] = await Promise.all([
		vectorQuery,
		lexicalQuery,
		entityQuery,
		communityQuery,
		temporalQuery
	]);

	const candidates = new Map<string, ScoredCandidate>();

	const addCandidate = (id: string, source: CandidateSource, patch?: Partial<ScoredCandidate>) => {
		const existing = candidates.get(id) ?? { id, sources: new Set<CandidateSource>() };
		existing.sources.add(source);
		if (patch?.vectorDistance !== undefined) existing.vectorDistance = patch.vectorDistance;
		if (patch?.communityDistance !== undefined)
			existing.communityDistance = Math.min(
				existing.communityDistance ?? Infinity,
				patch.communityDistance
			);
		if (patch?.entityDistance !== undefined)
			existing.entityDistance = Math.min(
				existing.entityDistance ?? Infinity,
				patch.entityDistance
			);
		if (patch?.bundleRank !== undefined) existing.bundleRank = patch.bundleRank;
		candidates.set(id, existing);
	};

	for (const row of vectorRows) {
		addCandidate(row.id, 'vector', { vectorDistance: row.distance });
	}
	for (const row of lexicalRows) {
		addCandidate(row.id, 'lexical');
	}
	for (const hit of temporalHits) {
		addCandidate(hit.thoughtId, 'temporal');
	}

	const ENTITY_MATCH_MAX_DISTANCE = 0.48;
	const matchedEntityIds = entityMatches
		.filter((m) => m.distance < ENTITY_MATCH_MAX_DISTANCE)
		.map((m) => m.id);

	for (const m of entityMatches) {
		if (m.distance >= ENTITY_MATCH_MAX_DISTANCE) continue;
		// entity distance stored per thought via expansion below
		void m;
	}

	timer.mark('graph');

	const communityIds = communities.map((c) => c.communityId);
	const communityDistanceById = new Map(communities.map((c) => [c.communityId, c.distance]));

	if (communityIds.length > 0) {
		const bundles = await db
			.select({
				communityId: communityBundle.communityId,
				topThoughtIds: communityBundle.topThoughtIds
			})
			.from(communityBundle)
			.where(
				and(
					eq(communityBundle.userId, params.userId),
					inArray(communityBundle.communityId, communityIds)
				)
			);

		for (const bundle of bundles) {
			const dist = communityDistanceById.get(bundle.communityId) ?? 1;
			bundle.topThoughtIds.forEach((thoughtId, rank) => {
				addCandidate(thoughtId, 'community_bundle', {
					communityDistance: dist,
					bundleRank: rank
				});
			});
		}
	}

	if (matchedEntityIds.length > 0) {
		const entityTops = await db
			.select({
				entityId: entityTopThoughts.entityId,
				thoughtIds: entityTopThoughts.thoughtIds
			})
			.from(entityTopThoughts)
			.where(
				and(
					eq(entityTopThoughts.userId, params.userId),
					inArray(entityTopThoughts.entityId, matchedEntityIds)
				)
			);

		const entityDistanceById = new Map(entityMatches.map((m) => [m.id, m.distance]));

		for (const row of entityTops) {
			const dist = entityDistanceById.get(row.entityId) ?? 1;
			for (const thoughtId of row.thoughtIds.slice(0, 5)) {
				addCandidate(thoughtId, 'entity_top', { entityDistance: dist });
			}
		}
	}

	const vectorSeedIds = vectorRows.slice(0, 10).map((r) => r.id);
	if (vectorSeedIds.length > 0) {
		const neighbors = await db
			.select({
				thoughtId: thoughtNeighbor.thoughtId,
				neighborId: thoughtNeighbor.neighborId,
				weight: thoughtNeighbor.weight
			})
			.from(thoughtNeighbor)
			.where(
				and(
					eq(thoughtNeighbor.userId, params.userId),
					inArray(thoughtNeighbor.thoughtId, vectorSeedIds)
				)
			)
			.limit(vectorSeedIds.length * NEIGHBOR_PER_SEED * 2);

		const neighborCountBySeed = new Map<string, number>();
		for (const n of neighbors) {
			const count = neighborCountBySeed.get(n.thoughtId) ?? 0;
			if (count >= NEIGHBOR_PER_SEED) continue;
			neighborCountBySeed.set(n.thoughtId, count + 1);
			addCandidate(n.neighborId, 'neighbor');
		}
	}

	if (isSchedulingConflictQuery(params.query)) {
		const conflicts = await findTemporalSchedulingConflicts({
			userId: params.userId,
			query: params.query
		});
		for (const thoughtId of conflicts.flatMap((c) => c.thoughtIds)) {
			addCandidate(thoughtId, 'temporal');
		}
	}

	const candidateList = [...candidates.values()].slice(0, MERGE_CANDIDATE_CAP);
	const candidateIds = candidateList.map((c) => c.id);
	if (candidateIds.length === 0) {
		logRetrievalPhaseTiming({
			userId: params.userId,
			query: params.query,
			mode: 'full',
			topK: limit,
			timing: timer.finish(),
			tag: '[retrieval.retrieveEvidence]'
		});
		return [];
	}

	timer.mark('hydrate');
	const rows = await db
		.select({
			id: thought.id,
			normalizedText: thought.normalizedText,
			normalizedTextEncrypted: thought.normalizedTextEncrypted,
			rerankSnippet: thought.rerankSnippet,
			category: thought.category,
			memoryType: thought.memoryType,
			metadata: thought.metadata,
			metadataEncrypted: thought.metadataEncrypted,
			createdAt: thought.createdAt,
			salienceScore: thought.salienceScore,
			entityCentralityMax: thought.entityCentralityMax,
			specificityScore: thought.specificityScore,
			recencyBucket: thought.recencyBucket,
			bundleRank: thought.bundleRank,
			primaryCommunityIds: thought.primaryCommunityIds
		})
		.from(thought)
		.where(and(eq(thought.userId, params.userId), inArray(thought.id, candidateIds)));

	const rowById = new Map(rows.map((r) => [r.id, r]));

	timer.mark('fuse');
	const seenCommunityIds = new Map<string, number>();
	const scored = candidateList
		.map((c) => {
			const row = rowById.get(c.id);
			if (!row) return null;

			const thoughtSim =
				c.vectorDistance !== undefined
					? cosineSimilarityFromDistance(c.vectorDistance)
					: c.sources.has('lexical')
						? 0.35
						: 0.2;
			const communitySim =
				c.communityDistance !== undefined
					? cosineSimilarityFromDistance(c.communityDistance)
					: 0;
			const entitySim =
				c.entityDistance !== undefined ? cosineSimilarityFromDistance(c.entityDistance) : 0;

			for (const cid of row.primaryCommunityIds ?? []) {
				seenCommunityIds.set(cid, (seenCommunityIds.get(cid) ?? 0) + 1);
			}

			const score =
				SCORE_WEIGHTS.thoughtSim * thoughtSim +
				SCORE_WEIGHTS.communitySim * communitySim +
				SCORE_WEIGHTS.entitySim * entitySim +
				SCORE_WEIGHTS.centrality * (row.entityCentralityMax ?? 0) +
				SCORE_WEIGHTS.specificity * (row.specificityScore ?? 0) +
				SCORE_WEIGHTS.salience * Math.min((row.salienceScore ?? 1) / SALIENCE_MAX, 1) +
				SCORE_WEIGHTS.recency * (row.recencyBucket ?? 0) -
				redundancyPenalty(c, seenCommunityIds);

			return {
				candidate: c,
				row,
				score,
				vectorScore: thoughtSim,
				graphScore: entitySim + (row.entityCentralityMax ?? 0) * 0.5
			};
		})
		.filter((e): e is NonNullable<typeof e> => e !== null)
		.sort((a, b) => b.score - a.score)
		.slice(0, RERANK_POOL);

	timer.mark('decrypt');
	const decrypted = await Promise.all(
		scored.map(async ({ row, score, vectorScore, graphScore, candidate }) => {
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

			const provenance =
				candidate.sources.has('community_bundle')
					? 'community_bundle'
					: candidate.sources.has('entity_top')
						? 'entity_expansion'
						: candidate.sources.has('neighbor')
							? 'thought_neighbor'
							: candidate.sources.has('temporal')
								? 'temporal'
								: undefined;

			return {
				id: row.id,
				normalizedText,
				category: row.category,
				memoryType: row.memoryType,
				score,
				vectorScore,
				graphScore,
				metadata: {
					...(JSON.parse(metadataJson) as Record<string, unknown>),
					...(provenance ? { graphProvenance: provenance } : {})
				},
				createdAt: row.createdAt,
				rerankSnippet: row.rerankSnippet ?? normalizedText.slice(0, 300)
			};
		})
	);

	const rerankInput: Array<RerankCandidate & { createdAt: Date; category: string; memoryType: string | null; metadata: Record<string, unknown>; vectorScore: number; graphScore: number }> =
		decrypted.map((d) => ({
			id: d.id,
			normalizedText: d.rerankSnippet,
			score: d.score,
			createdAt: d.createdAt,
			category: d.category,
			memoryType: d.memoryType,
			metadata: d.metadata,
			vectorScore: d.vectorScore,
			graphScore: d.graphScore
		}));

	const reranked = shouldSkipRerank(rerankInput)
		? rerankInput
		: await rerankCandidates(params.userId, params.query, rerankInput, undefined, limit);
	const final = reranked.slice(0, limit).map((r) => ({
		id: r.id,
		normalizedText:
			decrypted.find((d) => d.id === r.id)?.normalizedText ?? r.normalizedText,
		category: r.category as string,
		memoryType: r.memoryType as string | null,
		score: r.score,
		vectorScore: r.vectorScore as number,
		graphScore: r.graphScore as number,
		metadata: r.metadata as Record<string, unknown>,
		createdAt: r.createdAt as Date
	}));

	void bumpAccessAsync(
		params.userId,
		final.map((r) => r.id)
	);

	logRetrievalPhaseTiming({
		userId: params.userId,
		query: params.query,
		mode: 'full',
		topK: limit,
		timing: timer.finish(),
		tag: '[retrieval.retrieveEvidence]'
	});

	return final;
}
