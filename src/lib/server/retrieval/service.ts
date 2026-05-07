import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { lexicalSearch } from '$lib/server/retrieval/lexical';
import { reciprocalRankFusion } from '$lib/server/retrieval/fusion';
import { expandNeighborsByIds } from '$lib/server/graph/falkor';

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

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

export async function searchThoughts(params: {
	userId: string;
	query: string;
	topK?: number;
	weights?: RetrievalWeights;
}): Promise<RetrievalResult[]> {
	const topK = params.topK ?? 20;
	const limit = Math.max(1, Math.min(topK, 100));
	const weights: RetrievalWeights = params.weights ?? CONTEXT_WEIGHTS.default;

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
		.limit(Math.max(limit * 2, 20));

	const lexicalRows = await lexicalSearch({
		userId: params.userId,
		query: params.query,
		limit: Math.max(limit * 2, 20)
	});

	if (vectorRows.length === 0 && lexicalRows.length === 0) return [];

	const fusedSemantic = reciprocalRankFusion([
		vectorRows.map((row, index) => ({ id: row.id, rank: index + 1 })),
		lexicalRows.map((row, index) => ({ id: row.id, rank: index + 1 }))
	]);
	const maxSemantic = Math.max(1e-9, ...fusedSemantic.values());

	const semanticSeedIds = [...fusedSemantic.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, Math.max(limit * 2, 20))
		.map(([id]) => id);

	const graphNeighbors = await expandNeighborsByIds({
		userId: params.userId,
		seedIds: semanticSeedIds,
		limit: Math.max(limit * 2, 20)
	});

	const graphCounts = new Map<string, number>();
	for (const neighbor of graphNeighbors) {
		graphCounts.set(neighbor.id, neighbor.hits);
	}

	const connectedIds = [...graphCounts.keys()].filter((id) => !semanticSeedIds.includes(id));
	const connectedRows =
		connectedIds.length === 0
			? []
			: await getDb()
					.select({
						id: thought.id,
						normalizedText: thought.normalizedText,
						category: thought.category,
						metadata: thought.metadata
					})
					.from(thought)
					.where(and(eq(thought.userId, params.userId), inArray(thought.id, connectedIds)));

	const maxGraphCount = Math.max(1, ...graphCounts.values());
	const scoredById = new Map<
		string,
		{
			id: string;
			normalizedText: string;
			category: string;
			metadata: Record<string, unknown>;
			vectorScore: number;
			graphScore: number;
		}
	>();

	for (const row of vectorRows) {
		const vectorScore = clamp01((fusedSemantic.get(row.id) ?? 0) / maxSemantic);
		const graphScore = clamp01((graphCounts.get(row.id) ?? 0) / maxGraphCount);
		scoredById.set(row.id, {
			id: row.id,
			normalizedText: row.normalizedText,
			category: row.category,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			vectorScore,
			graphScore
		});
	}

	for (const row of lexicalRows) {
		if (scoredById.has(row.id)) continue;
		const vectorScore = clamp01((fusedSemantic.get(row.id) ?? 0) / maxSemantic);
		const graphScore = clamp01((graphCounts.get(row.id) ?? 0) / maxGraphCount);
		scoredById.set(row.id, {
			id: row.id,
			normalizedText: row.normalizedText,
			category: row.category,
			metadata: row.metadata,
			vectorScore,
			graphScore
		});
	}

	for (const row of connectedRows) {
		if (scoredById.has(row.id)) continue;
		const graphScore = clamp01((graphCounts.get(row.id) ?? 0) / maxGraphCount);
		const vectorScore = clamp01((fusedSemantic.get(row.id) ?? 0) / maxSemantic);
		scoredById.set(row.id, {
			id: row.id,
			normalizedText: row.normalizedText,
			category: row.category,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			vectorScore,
			graphScore
		});
	}

	const ranked = [...scoredById.values()]
		.map((item) => ({
			id: item.id,
			vectorScore: item.vectorScore,
			graphScore: item.graphScore,
			score: weights.vector * item.vectorScore + weights.graph * item.graphScore
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	return ranked.map((r) => {
		const full = scoredById.get(r.id)!;
		return {
			id: full.id,
			normalizedText: full.normalizedText,
			category: full.category,
			metadata: full.metadata,
			vectorScore: full.vectorScore,
			graphScore: full.graphScore,
			score: r.score
		};
	});
}
