/**
 * Phase: retrieval-ablation
 *
 * Sweeps searchThoughts weights from vector-only to graph-only and reports
 * Recall@5/10, NDCG@10, and MRR — overall and per query category — so we
 * can see empirically where vector vs graph contribution wins.
 *
 * Operates entirely against the already-seeded corpus (EVAL_CORPUS_USER_ID).
 * In analysis-only mode this is the cheapest phase to run.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { thought } from '$lib/server/db/brain.schema';
import { searchThoughts } from '$lib/server/retrieval/service';
import { graphOnlySearchByQuery } from '$lib/server/graph/falkor';
import { lexicalSearch } from '$lib/server/retrieval/lexical';
import { reciprocalRankFusion } from '$lib/server/retrieval/fusion';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import { logEval, withEvalDb } from '../eval-context';
import { EVAL_CORPUS_USER_ID } from '../seed-corpus';
import { loadQueries, type EvalQuery, type QueryCategory, type SeedManifest } from '../dataset';
import { buildRelevanceMap, computeQueryMetrics, meanMetrics, type QueryMetrics } from '../metrics';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WeightPoint = { vector: number; graph: number };

type PerQueryRecord = {
	queryId: string;
	category: QueryCategory;
	ranked: string[];
	metrics: QueryMetrics;
};

type WeightResult = {
	weights: WeightPoint;
	overall: QueryMetrics;
	byCategory: Record<string, QueryMetrics>;
	perQuery: PerQueryRecord[];
};

type GraphOnlyResult = {
	overall: QueryMetrics;
	byCategory: Record<string, QueryMetrics>;
	perQuery: PerQueryRecord[];
};

type PresetArm = {
	label: '1/0/0' | '0/1/0' | '0/0/1';
	vector: number;
	lexical: number;
	graph: number;
};

type PresetResult = {
	preset: PresetArm;
	overall: QueryMetrics;
	byCategory: Record<string, QueryMetrics>;
	perQuery: PerQueryRecord[];
};

export type HeadlineLabel = 'full_semantic' | 'hybrid' | 'full_graph';

export type HeadlineRow = {
	label: HeadlineLabel;
	weights: WeightPoint | null;
	overall: QueryMetrics;
	byCategory: Record<string, QueryMetrics>;
};

export type CategoryBest = {
	category: QueryCategory;
	weights: WeightPoint;
	ndcgAt10: number;
};

export type RetrievalAblationResult = {
	queryCount: number;
	headlineComparison: HeadlineRow[];
	bestByCategory: CategoryBest[];
	weightSweep: Array<{
		weights: WeightPoint;
		overall: QueryMetrics;
		byCategory: Record<string, QueryMetrics>;
		perQuery: PerQueryRecord[];
	}>;
	graphOnly: GraphOnlyResult;
	singlePresetResults: PresetResult[];
};

// ── Internals ─────────────────────────────────────────────────────────────────

const WEIGHT_STEP = 0.1;
const SINGLE_TEST_PRESETS: PresetArm[] = [
	{ label: '1/0/0', vector: 1, lexical: 0, graph: 0 },
	{ label: '0/1/0', vector: 0, lexical: 1, graph: 0 },
	{ label: '0/0/1', vector: 0, lexical: 0, graph: 1 }
];

function buildWeightSweep(): WeightPoint[] {
	const points: WeightPoint[] = [];
	for (let i = 0; i <= 10; i += 1) {
		const vector = +(1 - i * WEIGHT_STEP).toFixed(2);
		const graph = +(i * WEIGHT_STEP).toFixed(2);
		points.push({ vector, graph });
	}
	return points;
}

async function loadUuidToEvalId(manifest: SeedManifest): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	for (const [evalId, uuid] of Object.entries(manifest)) {
		map.set(uuid, evalId);
	}
	return map;
}

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
}

async function rankForQuery(
	query: EvalQuery,
	weights: WeightPoint,
	uuidToEvalId: Map<string, string>
): Promise<string[]> {
	const results = await searchThoughts({
		userId: EVAL_CORPUS_USER_ID,
		query: query.text,
		topK: 10,
		weights
	});
	return results.map((r) => uuidToEvalId.get(r.id)).filter(Boolean) as string[];
}

async function rankForQueryGraphOnly(
	query: EvalQuery,
	uuidToEvalId: Map<string, string>
): Promise<string[]> {
	const results = await graphOnlySearchByQuery({
		userId: EVAL_CORPUS_USER_ID,
		query: query.text,
		limit: 10
	});
	return results.map((r) => uuidToEvalId.get(r.id)).filter(Boolean) as string[];
}

async function rankForQueryPreset(
	query: EvalQuery,
	preset: PresetArm,
	uuidToEvalId: Map<string, string>
): Promise<string[]> {
	if (preset.graph === 1 && preset.vector === 0 && preset.lexical === 0) {
		return rankForQueryGraphOnly(query, uuidToEvalId);
	}

	const limit = 10;
	const candidateLimit = Math.max(limit * 2, 20);
	const rankedEvalIds: string[] = [];
	const seen = new Set<string>();

	if (preset.vector === 1 && preset.lexical === 0) {
		const queryEmbedding = await createThoughtEmbedding(EVAL_CORPUS_USER_ID, query.text);
		const vectorLiteral = toVectorLiteral(queryEmbedding);
		const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`;
		const rows = await getDb()
			.select({ id: thought.id })
			.from(thought)
			.where(and(eq(thought.userId, EVAL_CORPUS_USER_ID), isNotNull(thought.embedding)))
			.orderBy(vectorDistance)
			.limit(limit);
		for (const row of rows) {
			const evalId = uuidToEvalId.get(row.id);
			if (!evalId || seen.has(evalId)) continue;
			seen.add(evalId);
			rankedEvalIds.push(evalId);
		}
		return rankedEvalIds;
	}

	if (preset.vector === 0 && preset.lexical === 1) {
		const rows = await lexicalSearch({ userId: EVAL_CORPUS_USER_ID, query: query.text, limit });
		for (const row of rows) {
			const evalId = uuidToEvalId.get(row.id);
			if (!evalId || seen.has(evalId)) continue;
			seen.add(evalId);
			rankedEvalIds.push(evalId);
		}
		return rankedEvalIds;
	}

	if (preset.vector === 1 && preset.lexical === 1) {
		const queryEmbedding = await createThoughtEmbedding(EVAL_CORPUS_USER_ID, query.text);
		const vectorLiteral = toVectorLiteral(queryEmbedding);
		const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`;
		const vectorRows = await getDb()
			.select({ id: thought.id })
			.from(thought)
			.where(and(eq(thought.userId, EVAL_CORPUS_USER_ID), isNotNull(thought.embedding)))
			.orderBy(vectorDistance)
			.limit(candidateLimit);
		const lexicalRows = await lexicalSearch({
			userId: EVAL_CORPUS_USER_ID,
			query: query.text,
			limit: candidateLimit
		});
		const fused = reciprocalRankFusion([
			vectorRows.map((row, index) => ({ id: row.id, rank: index + 1 })),
			lexicalRows.map((row, index) => ({ id: row.id, rank: index + 1 }))
		]);
		const rankedUuids = [...fused.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([id]) => id)
			.slice(0, candidateLimit);
		for (const id of rankedUuids) {
			const evalId = uuidToEvalId.get(id);
			if (!evalId || seen.has(evalId)) continue;
			seen.add(evalId);
			rankedEvalIds.push(evalId);
			if (rankedEvalIds.length >= limit) break;
		}
		return rankedEvalIds;
	}

	return [];
}

function aggregateByCategory(records: PerQueryRecord[]): Record<string, QueryMetrics> {
	const buckets: Record<string, QueryMetrics[]> = {};
	for (const r of records) {
		if (!buckets[r.category]) buckets[r.category] = [];
		buckets[r.category].push(r.metrics);
	}
	const result: Record<string, QueryMetrics> = {};
	for (const [cat, items] of Object.entries(buckets)) {
		result[cat] = meanMetrics(items);
	}
	return result;
}

function buildHeadlineComparison(
	sweep: WeightResult[],
	graphOnly: GraphOnlyResult
): HeadlineRow[] {
	const fullSemantic = sweep.find((r) => r.weights.vector === 1 && r.weights.graph === 0);
	if (!fullSemantic) {
		throw new Error('[eval] headline comparison requires the sweep to include weights (1.0, 0.0)');
	}
	const hybrid = [...sweep].sort((a, b) => b.overall.ndcgAt10 - a.overall.ndcgAt10)[0];
	return [
		{
			label: 'full_semantic',
			weights: fullSemantic.weights,
			overall: fullSemantic.overall,
			byCategory: fullSemantic.byCategory
		},
		{
			label: 'hybrid',
			weights: hybrid.weights,
			overall: hybrid.overall,
			byCategory: hybrid.byCategory
		},
		{
			label: 'full_graph',
			weights: null,
			overall: graphOnly.overall,
			byCategory: graphOnly.byCategory
		}
	];
}

function bestPerCategory(results: WeightResult[]): CategoryBest[] {
	const categories = [...new Set(results.flatMap((r) => Object.keys(r.byCategory)))] as QueryCategory[];
	return categories.map((category) => {
		const ranked = [...results].sort(
			(a, b) => (b.byCategory[category]?.ndcgAt10 ?? 0) - (a.byCategory[category]?.ndcgAt10 ?? 0)
		);
		const top = ranked[0];
		return {
			category,
			weights: top.weights,
			ndcgAt10: top.byCategory[category]?.ndcgAt10 ?? 0
		};
	});
}

// ── Main phase function ───────────────────────────────────────────────────────

export async function runRetrievalAblation(
	manifest: SeedManifest,
	opts: { skipFullSweep?: boolean } = {}
): Promise<RetrievalAblationResult> {
	logEval('retrieval-ablation phase start');

	const queries = loadQueries().queries;
	const sweep = buildWeightSweep();
	const uuidToEvalId = await loadUuidToEvalId(manifest);

	if (uuidToEvalId.size === 0) {
		throw new Error(
			'[eval] retrieval-ablation: manifest is empty. Run in full mode to seed the corpus first.'
		);
	}

	logEval(
		`queries=${queries.length} weight_points=${sweep.length} corpus_size=${uuidToEvalId.size}`
	);

	const result = await withEvalDb(EVAL_CORPUS_USER_ID, async (_db) => {
		const allResults: WeightResult[] = [];

		if (!opts.skipFullSweep) {
			for (let wi = 0; wi < sweep.length; wi += 1) {
				const weights = sweep[wi];
				logEval(
					`weight ${wi + 1}/${sweep.length} (vector=${weights.vector.toFixed(1)} graph=${weights.graph.toFixed(1)})`
				);
				const perQuery: PerQueryRecord[] = [];
				for (let qi = 0; qi < queries.length; qi += 1) {
					const q = queries[qi];
					const ranked = await rankForQuery(q, weights, uuidToEvalId);
					const relevance = buildRelevanceMap(q.relevant);
					perQuery.push({
						queryId: q.id,
						category: q.category,
						ranked,
						metrics: computeQueryMetrics(ranked, relevance)
					});
				}
				allResults.push({
					weights,
					overall: meanMetrics(perQuery.map((p) => p.metrics)),
					byCategory: aggregateByCategory(perQuery),
					perQuery
				});
				logEval(`weight ${wi + 1}/${sweep.length} complete`);
			}
		}

		// Graph-only arm
		const graphOnlyPerQuery: PerQueryRecord[] = [];
		if (!opts.skipFullSweep) {
			logEval('graph-only arm start');
			for (const q of queries) {
				const ranked = await rankForQueryGraphOnly(q, uuidToEvalId);
				const relevance = buildRelevanceMap(q.relevant);
				graphOnlyPerQuery.push({
					queryId: q.id,
					category: q.category,
					ranked,
					metrics: computeQueryMetrics(ranked, relevance)
				});
			}
			logEval('graph-only arm complete');
		}

		// Single preset tests (always run — cheap)
		const presetResults: PresetResult[] = [];
		for (const preset of SINGLE_TEST_PRESETS) {
			logEval(`single preset ${preset.label} start`);
			const perQuery: PerQueryRecord[] = [];
			for (const q of queries) {
				const ranked = await rankForQueryPreset(q, preset, uuidToEvalId);
				const relevance = buildRelevanceMap(q.relevant);
				perQuery.push({
					queryId: q.id,
					category: q.category,
					ranked,
					metrics: computeQueryMetrics(ranked, relevance)
				});
			}
			presetResults.push({
				preset,
				overall: meanMetrics(perQuery.map((p) => p.metrics)),
				byCategory: aggregateByCategory(perQuery),
				perQuery
			});
			logEval(`single preset ${preset.label} complete`);
		}

		const graphOnly: GraphOnlyResult = {
			overall: meanMetrics(graphOnlyPerQuery.map((p) => p.metrics)),
			byCategory: aggregateByCategory(graphOnlyPerQuery),
			perQuery: graphOnlyPerQuery
		};

		return { allResults, graphOnly, presetResults };
	});

	const headlineComparison =
		result.allResults.length > 0
			? buildHeadlineComparison(result.allResults, result.graphOnly)
			: [];
	const bestByCategory =
		result.allResults.length > 0 ? bestPerCategory(result.allResults) : [];

	if (headlineComparison.length > 0) {
		const hybrid = headlineComparison.find((r) => r.label === 'hybrid');
		const semantic = headlineComparison.find((r) => r.label === 'full_semantic');
		logEval(
			`headline: hybrid NDCG@10=${hybrid?.overall.ndcgAt10.toFixed(3)} | ` +
				`semantic NDCG@10=${semantic?.overall.ndcgAt10.toFixed(3)}`
		);
	}

	logEval('retrieval-ablation phase complete');

	return {
		queryCount: queries.length,
		headlineComparison,
		bestByCategory,
		weightSweep: result.allResults,
		graphOnly: result.graphOnly,
		singlePresetResults: result.presetResults
	};
}
