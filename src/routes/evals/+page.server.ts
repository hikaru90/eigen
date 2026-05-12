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

	const retrieval = readJsonIfExists<RetrievalReport>(retrievalPath);
	const answer = readJsonIfExists<AnswerReport>(answerPath);

	const bestRetrieval =
		retrieval?.weightSweep && retrieval.weightSweep.length > 0
			? [...retrieval.weightSweep].sort((a, b) => b.overall.ndcgAt10 - a.overall.ndcgAt10)[0]
			: null;

	return {
		user: event.locals.user,
		retrieval,
		answer,
		bestRetrieval,
		paths: { retrievalPath, answerPath }
	};
};
