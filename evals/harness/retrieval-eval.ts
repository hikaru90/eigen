/**
 * Retrieval ablation harness.
 *
 * Sweeps `searchThoughts` weights from vector-only to graph-only and reports
 * Recall@5, Recall@10, NDCG@10, and MRR — overall and per query category — so
 * we can see empirically where vector vs graph contribution wins.
 *
 * Run with: `npm run eval:retrieval` (after `npm run eval:seed`).
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { thought } from '$lib/server/db/brain.schema';
import { searchThoughts } from '$lib/server/retrieval/service';
import { graphOnlySearchByQuery } from '$lib/server/graph/falkor';
import { lexicalSearch } from '$lib/server/retrieval/lexical';
import { reciprocalRankFusion } from '$lib/server/retrieval/fusion';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { getDb } from '$lib/server/db';
import type { AppDatabase } from '$lib/server/db';
import { logEval, runEval, startEvalHeartbeat, withEvalDb } from './eval-context';
import { loadQueries, type EvalQuery, type QueryCategory } from './dataset';
import {
	buildRelevanceMap,
	computeQueryMetrics,
	meanMetrics,
	type QueryMetrics
} from './metrics';
import { writeReport } from './report';
import { EVAL_RETRIEVAL_USER_ID } from './eval-config';

const WEIGHT_STEP = 0.1;

type WeightPoint = { vector: number; graph: number };

function buildWeightSweep(): WeightPoint[] {
	const points: WeightPoint[] = [];
	for (let i = 0; i <= 10; i += 1) {
		const vector = +(1 - i * WEIGHT_STEP).toFixed(2);
		const graph = +(i * WEIGHT_STEP).toFixed(2);
		points.push({ vector, graph });
	}
	return points;
}

async function loadEvalIdMap(db: AppDatabase): Promise<Map<string, string>> {
	const rows = await db
		.select({ id: thought.id, metadata: thought.metadata })
		.from(thought)
		.where(eq(thought.userId, EVAL_RETRIEVAL_USER_ID));
	const map = new Map<string, string>();
	for (const row of rows) {
		const meta = (row.metadata as Record<string, unknown>) ?? {};
		const evalId = typeof meta.evalId === 'string' ? meta.evalId : null;
		if (evalId) map.set(row.id, evalId);
	}
	return map;
}

async function rankForQuery(
	query: EvalQuery,
	weights: WeightPoint,
	uuidToEvalId: Map<string, string>
): Promise<string[]> {
	const results = await searchThoughts({
		userId: EVAL_RETRIEVAL_USER_ID,
		query: query.text,
		topK: 10,
		weights
	});
	const ranked: string[] = [];
	for (const r of results) {
		const evalId = uuidToEvalId.get(r.id);
		if (evalId) ranked.push(evalId);
	}
	return ranked;
}

async function rankForQueryGraphOnly(
	query: EvalQuery,
	uuidToEvalId: Map<string, string>
): Promise<string[]> {
	const results = await graphOnlySearchByQuery({
		userId: EVAL_RETRIEVAL_USER_ID,
		query: query.text,
		limit: 10
	});
	const ranked: string[] = [];
	for (const r of results) {
		const evalId = uuidToEvalId.get(r.id);
		if (evalId) ranked.push(evalId);
	}
	return ranked;
}

type PerQueryRecord = {
	queryId: string;
	category: QueryCategory;
	ranked: string[];
	metrics: QueryMetrics;
};

type WeightResult = {
	weights: WeightPoint;
	overall: QueryMetrics;
	byCategory: Record<QueryCategory, QueryMetrics>;
	perQuery: PerQueryRecord[];
};

type GraphOnlyResult = {
	overall: QueryMetrics;
	byCategory: Record<QueryCategory, QueryMetrics>;
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
	byCategory: Record<QueryCategory, QueryMetrics>;
	perQuery: PerQueryRecord[];
};

const SINGLE_TEST_PRESETS: PresetArm[] = [
	{ label: '1/0/0', vector: 1, lexical: 0, graph: 0 },
	{ label: '0/1/0', vector: 0, lexical: 1, graph: 0 },
	{ label: '0/0/1', vector: 0, lexical: 0, graph: 1 }
];

function toVectorLiteral(vector: number[]): string {
	return `[${vector.join(',')}]`;
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
		const queryEmbedding = await createThoughtEmbedding(EVAL_RETRIEVAL_USER_ID, query.text);
		const vectorLiteral = toVectorLiteral(queryEmbedding);
		const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`;
		const rows = await getDb()
			.select({ id: thought.id })
			.from(thought)
			.where(and(eq(thought.userId, EVAL_RETRIEVAL_USER_ID), isNotNull(thought.embedding)))
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
		const rows = await lexicalSearch({
			userId: EVAL_RETRIEVAL_USER_ID,
			query: query.text,
			limit
		});
		for (const row of rows) {
			const evalId = uuidToEvalId.get(row.id);
			if (!evalId || seen.has(evalId)) continue;
			seen.add(evalId);
			rankedEvalIds.push(evalId);
		}
		return rankedEvalIds;
	}

	if (preset.vector === 1 && preset.lexical === 1) {
		const queryEmbedding = await createThoughtEmbedding(EVAL_RETRIEVAL_USER_ID, query.text);
		const vectorLiteral = toVectorLiteral(queryEmbedding);
		const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`;
		const vectorRows = await getDb()
			.select({ id: thought.id })
			.from(thought)
			.where(and(eq(thought.userId, EVAL_RETRIEVAL_USER_ID), isNotNull(thought.embedding)))
			.orderBy(vectorDistance)
			.limit(candidateLimit);
		const lexicalRows = await lexicalSearch({
			userId: EVAL_RETRIEVAL_USER_ID,
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

function aggregateByCategory(records: PerQueryRecord[]): Record<QueryCategory, QueryMetrics> {
	const buckets: Record<QueryCategory, QueryMetrics[]> = {
		semantic_paraphrase: [],
		entity_relation: [],
		hybrid: []
	};
	for (const r of records) {
		buckets[r.category].push(r.metrics);
	}
	return {
		semantic_paraphrase: meanMetrics(buckets.semantic_paraphrase),
		entity_relation: meanMetrics(buckets.entity_relation),
		hybrid: meanMetrics(buckets.hybrid)
	};
}

function fmt(n: number): string {
	return n.toFixed(3);
}

type HeadlineLabel = 'full_semantic' | 'hybrid' | 'full_graph';

type HeadlineRow = {
	label: HeadlineLabel;
	weights: WeightPoint | null;
	overall: QueryMetrics;
	byCategory: Record<QueryCategory, QueryMetrics>;
};

/**
 * The 3-way headline comparison the user-facing summary leads with:
 *
 *   - full_semantic: sweep at (vector=1, graph=0). With the current
 *     `searchThoughts` fusion, this is RRF over vector + lexical with no
 *     graph contribution (the "pure semantic" channel).
 *   - hybrid: best overall NDCG@10 weight point from the sweep — the
 *     data-driven verdict on what the blended retriever can do at its peak.
 *   - full_graph: the standalone `graphOnly` arm (`graphOnlySearchByQuery`),
 *     i.e. token-match on `lexical_text` with neighbor expansion only.
 *     Distinct from sweep at (0,1) because it doesn't use semantic seeds.
 */
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

type CategoryBest = {
	category: QueryCategory;
	weights: WeightPoint;
	ndcgAt10: number;
};

function bestPerCategory(results: WeightResult[]): CategoryBest[] {
	const categories: QueryCategory[] = ['semantic_paraphrase', 'entity_relation', 'hybrid'];
	return categories.map((category) => {
		const ranked = [...results].sort(
			(a, b) => b.byCategory[category].ndcgAt10 - a.byCategory[category].ndcgAt10
		);
		const top = ranked[0];
		return {
			category,
			weights: top.weights,
			ndcgAt10: top.byCategory[category].ndcgAt10
		};
	});
}

function formatWeights(w: WeightPoint | null): string {
	if (!w) return 'token+expand';
	return `${w.vector.toFixed(1)}/${w.graph.toFixed(1)}`;
}

function printHeadlineComparison(rows: HeadlineRow[]): void {
	const header = [
		'arm',
		'weights',
		'NDCG@10',
		'Recall@10',
		'MRR',
		'sem',
		'entity',
		'hybrid'
	];
	const widths = [14, 13, 8, 10, 7, 7, 7, 7];
	console.log('\n=== Headline retrieval comparison (NDCG@10 / Recall@10 / MRR + per-category NDCG@10) ===');
	console.log(header.map((h, i) => h.padEnd(widths[i])).join('  '));
	console.log(widths.map((w) => '-'.repeat(w)).join('  '));
	for (const row of rows) {
		const cells = [
			row.label.padEnd(widths[0]),
			formatWeights(row.weights).padEnd(widths[1]),
			fmt(row.overall.ndcgAt10).padEnd(widths[2]),
			fmt(row.overall.recallAt10).padEnd(widths[3]),
			fmt(row.overall.mrr).padEnd(widths[4]),
			fmt(row.byCategory.semantic_paraphrase.ndcgAt10).padEnd(widths[5]),
			fmt(row.byCategory.entity_relation.ndcgAt10).padEnd(widths[6]),
			fmt(row.byCategory.hybrid.ndcgAt10).padEnd(widths[7])
		];
		console.log(cells.join('  '));
	}
}

function printSummary(
	results: WeightResult[],
	graphOnly: GraphOnlyResult,
	singlePresetResults: PresetResult[]
): void {
	printHeadlineComparison(buildHeadlineComparison(results, graphOnly));

	const header = [
		'weight (vec/graph)',
		'sem_paraphrase NDCG@10',
		'entity_relation NDCG@10',
		'hybrid NDCG@10',
		'overall NDCG@10',
		'overall Recall@10',
		'overall MRR'
	];
	console.log('\n=== Retrieval ablation (NDCG@10 unless noted) ===');
	console.log(header.join('  |  '));
	console.log(header.map((h) => '-'.repeat(h.length)).join('--+--'));
	for (const r of results) {
		const cells = [
			`${r.weights.vector.toFixed(1)} / ${r.weights.graph.toFixed(1)}`.padEnd(header[0].length),
			fmt(r.byCategory.semantic_paraphrase.ndcgAt10).padEnd(header[1].length),
			fmt(r.byCategory.entity_relation.ndcgAt10).padEnd(header[2].length),
			fmt(r.byCategory.hybrid.ndcgAt10).padEnd(header[3].length),
			fmt(r.overall.ndcgAt10).padEnd(header[4].length),
			fmt(r.overall.recallAt10).padEnd(header[5].length),
			fmt(r.overall.mrr).padEnd(header[6].length)
		];
		console.log(cells.join('  |  '));
	}
	const best = [...results].sort((a, b) => b.overall.ndcgAt10 - a.overall.ndcgAt10)[0];
	console.log(
		`\nBest overall NDCG@10 = ${fmt(best.overall.ndcgAt10)} at weights (${best.weights.vector.toFixed(
			1
		)} vector / ${best.weights.graph.toFixed(1)} graph).`
	);
	console.log('\n=== Best weights per category (NDCG@10) ===');
	for (const entry of bestPerCategory(results)) {
		console.log(
			`${entry.category.padEnd(20)}  best NDCG@10=${fmt(entry.ndcgAt10)} at weights (${entry.weights.vector.toFixed(1)} vector / ${entry.weights.graph.toFixed(1)} graph)`
		);
	}
	console.log('\n=== Graph-only arm ===');
	console.log(
		`graph-only NDCG@10=${fmt(graphOnly.overall.ndcgAt10)} Recall@10=${fmt(graphOnly.overall.recallAt10)} MRR=${fmt(graphOnly.overall.mrr)}`
	);
	console.log('\n=== Single preset tests (vector/lexical/graph) ===');
	for (const result of singlePresetResults) {
		console.log(
			`${result.preset.label} NDCG@10=${fmt(result.overall.ndcgAt10)} Recall@10=${fmt(result.overall.recallAt10)} MRR=${fmt(result.overall.mrr)}`
		);
	}
}

function printSinglePresetSummary(singlePresetResults: PresetResult[]): void {
	console.log('\n=== Single preset tests only (vector/lexical/graph) ===');
	for (const result of singlePresetResults) {
		console.log(
			`${result.preset.label} NDCG@10=${fmt(result.overall.ndcgAt10)} Recall@10=${fmt(result.overall.recallAt10)} MRR=${fmt(result.overall.mrr)}`
		);
	}
}

async function main(): Promise<void> {
	const stopHeartbeat = startEvalHeartbeat('eval:retrieval');
	try {
		const singlePresetsOnly = process.argv.includes('--single-presets');
		const queries = loadQueries().queries;
		const sweep = buildWeightSweep();

		const {
			allResults,
			graphOnly,
			singlePresetResults
		}: {
			allResults: WeightResult[];
			graphOnly: GraphOnlyResult;
			singlePresetResults: PresetResult[];
		} = await withEvalDb(EVAL_RETRIEVAL_USER_ID, async (db) => {
			const uuidToEvalId = await loadEvalIdMap(db);
			if (uuidToEvalId.size === 0) {
				throw new Error(
					'[eval] no eval thoughts found in DB. Run `npm run eval:seed` before `npm run eval:retrieval`.'
				);
			}
			logEval(`queries=${queries.length} weights=${sweep.length} corpus_size=${uuidToEvalId.size}`);

			const results: WeightResult[] = [];
			if (!singlePresetsOnly) {
				for (let wi = 0; wi < sweep.length; wi += 1) {
					const weights = sweep[wi];
					logEval(
						`weight ${wi + 1}/${sweep.length} start (vector=${weights.vector.toFixed(1)} graph=${weights.graph.toFixed(1)})`
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
						if ((qi + 1) % 10 === 0 || qi + 1 === queries.length) {
							logEval(`weight ${wi + 1}/${sweep.length} query progress ${qi + 1}/${queries.length}`);
						}
					}
					results.push({
						weights,
						overall: meanMetrics(perQuery.map((p) => p.metrics)),
						byCategory: aggregateByCategory(perQuery),
						perQuery
					});
					logEval(`weight ${wi + 1}/${sweep.length} complete`);
				}
			}

			let graphOnlyPerQuery: PerQueryRecord[] = [];
			if (!singlePresetsOnly) {
				logEval('graph-only arm start');
				for (let qi = 0; qi < queries.length; qi += 1) {
					const q = queries[qi];
					const ranked = await rankForQueryGraphOnly(q, uuidToEvalId);
					const relevance = buildRelevanceMap(q.relevant);
					graphOnlyPerQuery.push({
						queryId: q.id,
						category: q.category,
						ranked,
						metrics: computeQueryMetrics(ranked, relevance)
					});
					if ((qi + 1) % 10 === 0 || qi + 1 === queries.length) {
						logEval(`graph-only query progress ${qi + 1}/${queries.length}`);
					}
				}
				logEval('graph-only arm complete');
			}

			const presetResults: PresetResult[] = [];
			for (const preset of SINGLE_TEST_PRESETS) {
				logEval(`single preset ${preset.label} start`);
				const perQuery: PerQueryRecord[] = [];
				for (let qi = 0; qi < queries.length; qi += 1) {
					const q = queries[qi];
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
			return {
				allResults: results,
				graphOnly: {
					overall: meanMetrics(graphOnlyPerQuery.map((p) => p.metrics)),
					byCategory: aggregateByCategory(graphOnlyPerQuery),
					perQuery: graphOnlyPerQuery
				},
				singlePresetResults: presetResults
			};
		});

		if (singlePresetsOnly) {
			printSinglePresetSummary(singlePresetResults);
		} else {
			printSummary(allResults, graphOnly, singlePresetResults);
		}

		const bestByCategory = singlePresetsOnly ? [] : bestPerCategory(allResults);
		const headlineComparison = singlePresetsOnly
			? []
			: buildHeadlineComparison(allResults, graphOnly);
		const { reportPath, latestPath } = writeReport('retrieval', {
			generatedAt: new Date().toISOString(),
			userId: EVAL_RETRIEVAL_USER_ID,
			queryCount: queries.length,
			graphOnly,
			singlePresetResults,
			bestByCategory,
			headlineComparison,
			weightSweep: allResults.map((r) => ({
				weights: r.weights,
				overall: r.overall,
				byCategory: r.byCategory,
				perQuery: r.perQuery
			}))
		});
		logEval(`wrote report:\n  ${reportPath}\n  ${latestPath}`);
	} finally {
		stopHeartbeat();
	}
}

void runEval(main);
