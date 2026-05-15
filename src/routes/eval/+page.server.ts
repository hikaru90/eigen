import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

type WeightEntry = {
	weights: { vector: number; graph: number };
	overall: { ndcgAt10: number; recallAt10: number; mrr: number };
	byCategory?: Record<string, { ndcgAt10: number; recallAt10: number; mrr: number }>;
};

type HeadlineEntry = {
	label: string;
	weights: { vector: number; graph: number };
	overall: { ndcgAt10: number; recallAt10: number; mrr: number };
	byCategory: Record<string, { ndcgAt10: number; recallAt10: number; mrr: number }>;
};

type RetrievalReport = {
	generatedAt?: string;
	queryCount?: number;
	weightSweep?: WeightEntry[];
	headlineComparison?: HeadlineEntry[];
	graphOnly?: {
		overall: { ndcgAt10: number; recallAt10: number; mrr: number };
		byCategory: Record<string, { ndcgAt10: number; recallAt10: number; mrr: number }>;
	};
};

type AnswerRecord = {
	caseId: string;
	question: string;
	answer: string;
	passed: boolean;
	verdict?: {
		faithfulness?: { score: number; rationale: string };
		relevance?: { score: number; rationale: string };
		usefulness?: { score: number; rationale: string };
	};
};

type AnswerReport = {
	generatedAt?: string;
	caseCount?: number;
	passed?: number;
	passThreshold?: number;
	summary?: {
		faithfulness?: { mean?: number; median?: number };
		relevance?: { mean?: number; median?: number };
		usefulness?: { mean?: number; median?: number };
	};
	records?: AnswerRecord[];
};

type AgentProbeMetrics = {
	recallAt1?: number;
	recallAt3?: number;
	recallAt5?: number;
	ndcgAt5?: number;
	mrr?: number;
};

type AgentReport = {
	generatedAt?: string;
	userId?: string;
	thoughtCount?: number;
	ingest?: {
		totalDurationMs?: number;
		perThought?: Array<{
			evalId: string;
			durationMs: number;
			categoryAssigned: string;
			phasesCompleted: string[];
		}>;
	};
	retrieval?: {
		probeCount?: number;
		overall?: AgentProbeMetrics;
		byCategory?: Record<string, AgentProbeMetrics>;
	};
	answer?: {
		passed?: number;
		total?: number;
		passRate?: number;
		summary?: {
			faithfulness?: { mean?: number };
			relevance?: { mean?: number };
			usefulness?: { mean?: number };
		};
		cases?: Array<{
			evalId: string;
			question: string;
			answer: string;
			passed: boolean;
			faithfulness?: number;
			relevance?: number;
			usefulness?: number;
		}>;
	};
	captureFidelity?: {
		rate?: number;
		passed?: number;
		total?: number;
		meanScore?: number;
		perThought?: Array<{
			evalId: string;
			faithful: boolean;
			score: number;
			rationale: string;
		}>;
	};
};

type EntityPerThought = {
	evalId: string;
	precision: number;
	recall: number;
	f1: number;
	extractedCount?: number;
	expectedCount?: number;
};

type EntityLayerReport = {
	layer: string;
	timestamp: string;
	thoughtCount?: number;
	summary?: {
		totalExpected?: number;
		totalExtracted?: number;
		truePositives?: number;
		precision?: number;
		recall?: number;
		f1?: number;
	};
	perThought?: EntityPerThought[];
	falsePositives?: Array<{ thoughtId: string; text: string; extracted: string; extractedType: string }>;
	falseNegatives?: Array<{ thoughtId: string; text: string; expected: string; expectedType: string }>;
};

type RelationLayerReport = {
	layer: string;
	timestamp: string;
	thoughtCount?: number;
	summary?: {
		totalExpected?: number;
		totalExtracted?: number;
		correct?: number;
		precision?: number;
		recall?: number;
		f1?: number;
	};
	falsePositives?: Array<{
		sourceId: string;
		sourceText: string;
		targetText: string;
		relationType: string;
	}>;
};

interface LayerReport {
	layer: string;
	timestamp: string;
	[key: string]: unknown;
}

interface ReportInfo {
	name: string;
	timestamp: string;
	data: LayerReport;
}

function readJsonIfExists<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadLayerReports(): ReportInfo[] {
	const reportsDir = resolve(process.cwd(), 'evals/reports');
	try {
		const files = readdirSync(reportsDir);
		const reports: ReportInfo[] = [];

		for (const file of files) {
			if (!file.startsWith('layer-') || !file.endsWith('.json')) continue;
			if (file.includes('latest')) continue;

			try {
				const content = readFileSync(resolve(reportsDir, file), 'utf-8');
				const data = JSON.parse(content) as LayerReport;
				reports.push({
					name: file.replace('.json', ''),
					timestamp: data.timestamp || statSync(resolve(reportsDir, file)).mtime.toISOString(),
					data
				});
			} catch {
				// Skip invalid files
			}
		}

		return reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	} catch {
		return [];
	}
}

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const retrievalPath = resolve(process.cwd(), 'evals/reports/retrieval-latest.json');
	const answerPath = resolve(process.cwd(), 'evals/reports/answer-latest.json');
	const agentPath = resolve(process.cwd(), 'evals/reports/agent-latest.json');
	const entityPath = resolve(process.cwd(), 'evals/reports/layer-entities-latest.json');
	const relationsPath = resolve(process.cwd(), 'evals/reports/layer-relations-latest.json');

	const retrieval = readJsonIfExists<RetrievalReport>(retrievalPath);
	const answer = readJsonIfExists<AnswerReport>(answerPath);
	const agent = readJsonIfExists<AgentReport>(agentPath);
	const entityLayer = readJsonIfExists<EntityLayerReport>(entityPath);
	const relationsLayer = readJsonIfExists<RelationLayerReport>(relationsPath);

	const bestRetrieval =
		retrieval?.weightSweep && retrieval.weightSweep.length > 0
			? [...retrieval.weightSweep].sort((a, b) => b.overall.ndcgAt10 - a.overall.ndcgAt10)[0]
			: null;

	const flatLayerReports = loadLayerReports();

	const reportsByLayer: { [layer: string]: ReportInfo[] } = {};
	for (const report of flatLayerReports) {
		const layer = report.data.layer || 'unknown';
		if (!reportsByLayer[layer]) reportsByLayer[layer] = [];
		reportsByLayer[layer].push(report);
	}

	return {
		user: event.locals.user,
		retrieval,
		answer,
		agent,
		bestRetrieval,
		entityLayer,
		relationsLayer,
		paths: { retrievalPath, answerPath, agentPath },
		reports: reportsByLayer
	};
};
