/**
 * Retrieval ablation harness.
 *
 * Sweeps `searchThoughts` weights from vector-only to graph-only and reports
 * Recall@5, Recall@10, NDCG@10, and MRR — overall and per query category — so
 * we can see empirically where vector vs graph contribution wins.
 *
 * Run with: `npm run eval:retrieval` (after `npm run eval:seed`).
 */
import { eq } from 'drizzle-orm';
import { thought } from '$lib/server/db/brain.schema';
import { searchThoughts } from '$lib/server/retrieval/service';
import type { AppDatabase } from '$lib/server/db';
import { runEval, withEvalDb } from './eval-context';
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

function printSummary(results: WeightResult[]): void {
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
}

async function main(): Promise<void> {
	const queries = loadQueries().queries;
	const sweep = buildWeightSweep();

	const allResults: WeightResult[] = await withEvalDb(EVAL_RETRIEVAL_USER_ID, async (db) => {
		const uuidToEvalId = await loadEvalIdMap(db);
		if (uuidToEvalId.size === 0) {
			throw new Error(
				'[eval] no eval thoughts found in DB. Run `npm run eval:seed` before `npm run eval:retrieval`.'
			);
		}
		console.log(`[eval] queries=${queries.length} weights=${sweep.length} corpus_size=${uuidToEvalId.size}`);

		const results: WeightResult[] = [];
		for (const weights of sweep) {
			const perQuery: PerQueryRecord[] = [];
			for (const q of queries) {
				const ranked = await rankForQuery(q, weights, uuidToEvalId);
				const relevance = buildRelevanceMap(q.relevant);
				perQuery.push({
					queryId: q.id,
					category: q.category,
					ranked,
					metrics: computeQueryMetrics(ranked, relevance)
				});
			}
			results.push({
				weights,
				overall: meanMetrics(perQuery.map((p) => p.metrics)),
				byCategory: aggregateByCategory(perQuery),
				perQuery
			});
		}
		return results;
	});

	printSummary(allResults);

	const { reportPath, latestPath } = writeReport('retrieval', {
		generatedAt: new Date().toISOString(),
		userId: EVAL_RETRIEVAL_USER_ID,
		queryCount: queries.length,
		weightSweep: allResults.map((r) => ({
			weights: r.weights,
			overall: r.overall,
			byCategory: r.byCategory,
			perQuery: r.perQuery
		}))
	});
	console.log(`\n[eval] wrote report:\n  ${reportPath}\n  ${latestPath}`);
}

void runEval(main);
