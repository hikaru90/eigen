/**
 * Per-query retrieval weight sweep (11 points) for a single eval entry.
 */
import { searchThoughts } from '$lib/server/retrieval/service';
import { graphOnlySearchByQuery } from '$lib/server/graph/age';
import { withEvalDb } from './eval-context';
import type { EvalRetrievalQuery, GradedRelevance } from './qa-types';
import { buildRelevanceMap, computeQueryMetrics, type QueryMetrics } from './metrics';

export type WeightPoint = { vector: number; graph: number };

export type PerQuerySweepResult = {
	queryId: string;
	category: string;
	weightSweep: Array<{
		weights: WeightPoint;
		metrics: QueryMetrics;
		ranked: string[];
	}>;
	graphOnly: { metrics: QueryMetrics; ranked: string[] };
	headlineComparison: Array<{
		label: 'full_semantic' | 'hybrid' | 'full_graph';
		weights: WeightPoint | null;
		ndcgAt10: number;
	}>;
	bestNdcgAt10: number;
	bestWeights: WeightPoint;
	passed: boolean;
};

const WEIGHT_STEP = 0.1;
const RETRIEVAL_PASS_NDCG = 0.5;

export function buildWeightSweep(): WeightPoint[] {
	const points: WeightPoint[] = [];
	for (let i = 0; i <= 10; i += 1) {
		const vector = +(1 - i * WEIGHT_STEP).toFixed(2);
		const graph = +(i * WEIGHT_STEP).toFixed(2);
		points.push({ vector, graph });
	}
	return points;
}

function fixtureRelevance(
	relevant: GradedRelevance[],
	fixtureToUuid: Map<string, string>
): Map<string, number> {
	const byFixture = new Map(relevant.map((r) => [r.id, r.grade]));
	const uuidRelevant: Array<{ id: string; grade: 0 | 1 | 2 | 3 }> = [];
	for (const [fixtureId, grade] of byFixture) {
		const uuid = fixtureToUuid.get(fixtureId);
		if (uuid) uuidRelevant.push({ id: uuid, grade });
	}
	return buildRelevanceMap(uuidRelevant);
}

export async function runRetrievalSweepForQuery(input: {
	evalUserId: string;
	/** Operator (or other payer) for platform credits when eval tenant has no wallet. */
	billingUserId?: string;
	query: EvalRetrievalQuery;
	fixtureToUuid: Map<string, string>;
	minNdcgAt10?: number;
	onProgress?: (message: string) => void;
}): Promise<PerQuerySweepResult> {
	const { evalUserId, query, fixtureToUuid } = input;
	const uuidToFixture = new Map<string, string>();
	for (const [fixtureId, uuid] of fixtureToUuid) {
		uuidToFixture.set(uuid, fixtureId);
	}

	const relevance = fixtureRelevance(query.relevant, fixtureToUuid);
	const sweep = buildWeightSweep();
	const weightSweep: PerQuerySweepResult['weightSweep'] = [];
	let graphOnly: PerQuerySweepResult['graphOnly'] = {
		metrics: { recallAt5: 0, recallAt10: 0, ndcgAt10: 0, mrr: 0 },
		ranked: []
	};

	const billingOpts = input.billingUserId?.trim()
		? { billingUserId: input.billingUserId.trim() }
		: undefined;
	await withEvalDb(evalUserId, async () => {
		for (let wi = 0; wi < sweep.length; wi += 1) {
			const weights = sweep[wi]!;
			input.onProgress?.(`retrieval sweep weight ${wi + 1}/${sweep.length}`);
			const rankedUuids = (
				await searchThoughts({
					userId: evalUserId,
					query: query.text,
					topK: 10,
					weights
				})
			).map((r) => r.id);
			const ranked = rankedUuids
				.map((id) => uuidToFixture.get(id))
				.filter(Boolean) as string[];
			weightSweep.push({
				weights,
				metrics: computeQueryMetrics(rankedUuids, relevance),
				ranked
			});
		}

		const graphRankedUuids = (
			await graphOnlySearchByQuery({ userId: evalUserId, query: query.text, limit: 10 })
		).map((r) => r.id);
		const graphRanked = graphRankedUuids
			.map((id) => uuidToFixture.get(id))
			.filter(Boolean) as string[];
		graphOnly = {
			metrics: computeQueryMetrics(graphRankedUuids, relevance),
			ranked: graphRanked
		};
	}, billingOpts);

	const fullSemantic = weightSweep.find((w) => w.weights.vector === 1 && w.weights.graph === 0);
	const hybrid = [...weightSweep].sort((a, b) => b.metrics.ndcgAt10 - a.metrics.ndcgAt10)[0]!;
	const headlineComparison: PerQuerySweepResult['headlineComparison'] = [
		{
			label: 'full_semantic',
			weights: fullSemantic?.weights ?? { vector: 1, graph: 0 },
			ndcgAt10: fullSemantic?.metrics.ndcgAt10 ?? 0
		},
		{
			label: 'hybrid',
			weights: hybrid.weights,
			ndcgAt10: hybrid.metrics.ndcgAt10
		},
		{
			label: 'full_graph',
			weights: null,
			ndcgAt10: graphOnly.metrics.ndcgAt10
		}
	];

	const bestNdcgAt10 = hybrid.metrics.ndcgAt10;
	const threshold = input.minNdcgAt10 ?? RETRIEVAL_PASS_NDCG;
	const passed = bestNdcgAt10 >= threshold;

	return {
		queryId: query.id,
		category: query.category,
		weightSweep,
		graphOnly,
		headlineComparison,
		bestNdcgAt10,
		bestWeights: hybrid.weights,
		passed
	};
}
