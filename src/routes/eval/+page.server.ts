import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Report types ───────────────────────────────────────────────────────────────

type EntityMetrics = {
	totalExpected?: number;
	totalExtracted?: number;
	truePositives?: number;
	precision?: number;
	recall?: number;
	f1?: number;
};

type RelationMetrics = {
	totalExpected?: number;
	totalExtracted?: number;
	correct?: number;
	precision?: number;
	recall?: number;
	f1?: number;
};

type EmbeddingMetrics = {
	avgSimilarity?: number;
	minSimilarity?: number;
	maxSimilarity?: number;
};

type CommunityMetrics = {
	entityCount?: number;
	totalCommunities?: number;
	communitiesByLevel?: { L0: number; L1: number; L2: number; L3: number };
	avgCommunitySize?: number;
};

type GraphVizNode = {
	id: string;
	kind: 'Thought' | 'Entity';
	label: string;
	subtype: string;
};

type GraphVizEdge = {
	id: string;
	sourceId: string;
	targetId: string;
	relationType: string;
	kind: 'thought_link' | 'mention' | 'entity_relation';
};

type LayerChecksReport = {
	thoughtCount?: number;
	entities?: {
		summary?: EntityMetrics;
		falsePositives?: Array<{ thoughtId: string; text: string; extracted: string; extractedType: string }>;
		falseNegatives?: Array<{ thoughtId: string; text: string; expected: string; expectedType: string }>;
		perThought?: Array<{
			evalId: string;
			precision: number;
			recall: number;
			f1: number;
			extractedCount?: number;
			expectedCount?: number;
		}>;
	};
	relations?: {
		summary?: RelationMetrics;
		falsePositives?: Array<{ sourceId: string; sourceText: string; targetText: string; relationType: string }>;
	};
	embedding?: {
		metrics?: EmbeddingMetrics;
		similarityMatrix?: Record<string, Record<string, number>>;
		neighbors?: Record<string, Array<{ id: string; similarity: number }>>;
	};
	communities?: CommunityMetrics & {
		communities?: Array<{
			id: string;
			level: number;
			memberCount: number;
			members: Array<{ entityId: string; canonicalKey: string; entityType: string }>;
		}>;
	};
	graphSnapshot?: { nodes: GraphVizNode[]; edges: GraphVizEdge[] };
};

type WeightEntry = {
	weights: { vector: number; graph: number };
	overall: { ndcgAt10: number; recallAt10: number; mrr: number };
	byCategory?: Record<string, { ndcgAt10: number; recallAt10: number; mrr: number }>;
};

type HeadlineEntry = {
	label: string;
	weights: { vector: number; graph: number } | null;
	overall: { ndcgAt10: number; recallAt10: number; mrr: number };
	byCategory: Record<string, { ndcgAt10: number; recallAt10: number; mrr: number }>;
};

type RetrievalReport = {
	queryCount?: number;
	weightSweep?: WeightEntry[];
	headlineComparison?: HeadlineEntry[];
	bestByCategory?: Array<{
		category: string;
		weights: { vector: number; graph: number };
		ndcgAt10: number;
	}>;
	graphOnly?: {
		overall: { ndcgAt10: number; recallAt10: number; mrr: number };
	};
};

type AnswerCaseResult = {
	caseId: string;
	question: string;
	answer: string;
	passed: boolean;
	dimension?: string;
	passThreshold?: number;
	verdict?: {
		accuracy?: { score: number; rationale: string };
		calibration?: { score: number; rationale: string };
		completeness?: { score: number; rationale: string };
		tone?: { score: number; rationale: string };
		weightedScore?: number;
	};
};

type AnswerQaReport = {
	probes?: {
		passed?: number;
		total?: number;
		passRate?: number;
		cases?: AnswerCaseResult[];
	};
	full?: {
		passed?: number;
		total?: number;
		passRate?: number;
		rubric?: string;
		summary?: {
			weightedScore?: { mean?: number; median?: number };
			accuracy?: { mean?: number; median?: number };
			calibration?: { mean?: number; median?: number };
			completeness?: { mean?: number; median?: number };
			tone?: { mean?: number; median?: number };
		};
		records?: AnswerCaseResult[];
	};
};

type FidelityReport = {
	total?: number;
	passed?: number;
	rate?: number;
	meanScore?: number;
	perThought?: Array<{
		evalId: string;
		faithful: boolean;
		score: number;
		rationale: string;
	}>;
};

export type EvalReport = {
	generatedAt?: string;
	mode?: 'full' | 'analysis-only';
	corpusUserId?: string;
	manifestSize?: number;
	layerChecks?: LayerChecksReport;
	retrieval?: RetrievalReport;
	answerQa?: AnswerQaReport;
	fidelity?: FidelityReport | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function readJsonIfExists<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as T;
	} catch {
		return null;
	}
}

// ── Load ────────────────────────────────────────────────────────────────────────

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const evalPath = resolve(process.cwd(), 'evals/reports/eval-latest.json');
	const report = readJsonIfExists<EvalReport>(evalPath);

	const bestRetrieval =
		report?.retrieval?.weightSweep && report.retrieval.weightSweep.length > 0
			? [...report.retrieval.weightSweep].sort(
					(a, b) => b.overall.ndcgAt10 - a.overall.ndcgAt10
				)[0]
			: null;

	return {
		user: event.locals.user,
		report,
		bestRetrieval
	};
};
