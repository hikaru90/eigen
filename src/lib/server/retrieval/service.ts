import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import { thought, thoughtRelation } from '$lib/server/db/schema';
import { rankCandidates } from '$lib/server/retrieval';

type RetrievalResult = {
	id: string;
	normalizedText: string;
	category: string;
	score: number;
	vectorScore: number;
	graphScore: number;
	metadata: Record<string, unknown>;
};

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

export async function searchThoughts(params: {
	userId: string;
	query: string;
	topK?: number;
}): Promise<RetrievalResult[]> {
	const topK = params.topK ?? 20;
	const limit = Math.max(1, Math.min(topK, 100));

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

	if (vectorRows.length === 0) return [];

	const seedIds = vectorRows.map((row) => row.id);
	const relationRows = await getDb()
		.select({
			sourceThoughtId: thoughtRelation.sourceThoughtId,
			targetThoughtId: thoughtRelation.targetThoughtId
		})
		.from(thoughtRelation)
		.where(
			and(
				eq(thoughtRelation.userId, params.userId),
				or(
					inArray(thoughtRelation.sourceThoughtId, seedIds),
					inArray(thoughtRelation.targetThoughtId, seedIds)
				)
			)
		);

	const graphCounts = new Map<string, number>();
	for (const row of relationRows) {
		const sourceIsSeed = seedIds.includes(row.sourceThoughtId);
		const targetIsSeed = seedIds.includes(row.targetThoughtId);
		if (sourceIsSeed) {
			graphCounts.set(row.targetThoughtId, (graphCounts.get(row.targetThoughtId) ?? 0) + 1);
		}
		if (targetIsSeed) {
			graphCounts.set(row.sourceThoughtId, (graphCounts.get(row.sourceThoughtId) ?? 0) + 1);
		}
	}

	const connectedIds = [...graphCounts.keys()].filter((id) => !seedIds.includes(id));
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
		const vectorScore = clamp01(1 - (row.distance ?? 1));
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

	for (const row of connectedRows) {
		if (scoredById.has(row.id)) continue;
		const graphScore = clamp01((graphCounts.get(row.id) ?? 0) / maxGraphCount);
		scoredById.set(row.id, {
			id: row.id,
			normalizedText: row.normalizedText,
			category: row.category,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			vectorScore: 0,
			graphScore
		});
	}

	const ranked = rankCandidates(
		[...scoredById.values()].map((item) => ({
			id: item.id,
			vectorScore: item.vectorScore,
			graphScore: item.graphScore
		})),
		'default'
	).slice(0, limit);

	return ranked.map((r) => {
		const full = scoredById.get(r.id)!;
		return {
			id: full.id,
			normalizedText: full.normalizedText,
			category: full.category,
			metadata: full.metadata,
			vectorScore: full.vectorScore,
			graphScore: full.graphScore,
			score: 0.7 * full.vectorScore + 0.3 * full.graphScore
		};
	});
}
