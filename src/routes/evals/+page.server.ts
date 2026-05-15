import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RetrievalReport = {
	generatedAt?: string;
	queryCount?: number;
	weightSweep?: Array<{
		weights: { vector: number; graph: number };
		overall: { ndcgAt10: number; recallAt10: number; mrr: number };
	}>;
};

type AnswerReport = {
	generatedAt?: string;
	caseCount?: number;
	passed?: number;
	summary?: {
		faithfulness?: { mean?: number; median?: number };
		relevance?: { mean?: number; median?: number };
		usefulness?: { mean?: number; median?: number };
	};
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
	};
	captureFidelity?: {
		rate?: number;
		passed?: number;
		total?: number;
		meanScore?: number;
	};
};

function readJsonIfExists<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const retrievalPath = resolve(process.cwd(), 'evals/reports/retrieval-latest.json');
	const answerPath = resolve(process.cwd(), 'evals/reports/answer-latest.json');
	const agentPath = resolve(process.cwd(), 'evals/reports/agent-latest.json');

	const retrieval = readJsonIfExists<RetrievalReport>(retrievalPath);
	const answer = readJsonIfExists<AnswerReport>(answerPath);
	const agent = readJsonIfExists<AgentReport>(agentPath);

	const bestRetrieval =
		retrieval?.weightSweep && retrieval.weightSweep.length > 0
			? [...retrieval.weightSweep].sort((a, b) => b.overall.ndcgAt10 - a.overall.ndcgAt10)[0]
			: null;

	return {
		user: event.locals.user,
		retrieval,
		answer,
		agent,
		bestRetrieval,
		paths: { retrievalPath, answerPath, agentPath }
	};
};
