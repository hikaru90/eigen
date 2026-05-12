/**
 * Answer-quality eval harness.
 *
 * For each QA case in `evals/datasets/answer/qa-cases.yaml`:
 *   1. composeAnswer over the seeded retrieval corpus
 *   2. LLM-as-judge scoring (faithfulness, relevance, usefulness)
 *   3. record per-case verdict + aggregate
 *
 * Run with: `npm run eval:answer` (after `npm run eval:seed`).
 */
import { eq } from 'drizzle-orm';
import { user } from '$lib/server/db/auth.schema';
import { composeAnswer, type ComposedAnswer } from '$lib/server/qa/compose-answer';
import type { AppDatabase } from '$lib/server/db';
import { logEval, runEval, startEvalHeartbeat, withEvalDb } from './eval-context';
import { loadAnswerCases, type AnswerCase } from './dataset';
import { judgeAnswer, type JudgeVerdict } from './judge';
import { writeReport } from './report';
import { EVAL_JUDGE_USER_ID, EVAL_RETRIEVAL_USER_ID } from './eval-config';

const PASS_THRESHOLD = 3;

async function ensureJudgeUser(db: AppDatabase): Promise<void> {
	const existing = await db.select().from(user).where(eq(user.id, EVAL_JUDGE_USER_ID));
	if (existing.length > 0) return;
	await db.insert(user).values({
		id: EVAL_JUDGE_USER_ID,
		name: 'Eval Runner (Judge)',
		email: 'eval-judge@local.eval',
		emailVerified: true,
		onboardingCompleted: true
	});
	logEval(`created user row ${EVAL_JUDGE_USER_ID}`);
}

type CaseRecord = {
	caseId: string;
	question: string;
	expectedFacts: string[];
	answer: string;
	citations: string[];
	retrievedIds: string[];
	verdict: JudgeVerdict;
	passed: boolean;
};

function caseHasPassed(verdict: JudgeVerdict): boolean {
	return (
		verdict.faithfulness.score >= PASS_THRESHOLD &&
		verdict.relevance.score >= PASS_THRESHOLD &&
		verdict.usefulness.score >= PASS_THRESHOLD
	);
}

function meanScore(records: CaseRecord[], pick: (v: JudgeVerdict) => number): number {
	if (records.length === 0) return 0;
	const sum = records.reduce((acc, r) => acc + pick(r.verdict), 0);
	return sum / records.length;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
	return sorted[mid];
}

function fmt(n: number): string {
	return n.toFixed(2);
}

function printSummary(records: CaseRecord[]): void {
	const passed = records.filter((r) => r.passed).length;
	const meanFaith = meanScore(records, (v) => v.faithfulness.score);
	const meanRel = meanScore(records, (v) => v.relevance.score);
	const meanUse = meanScore(records, (v) => v.usefulness.score);
	const medFaith = median(records.map((r) => r.verdict.faithfulness.score));
	const medRel = median(records.map((r) => r.verdict.relevance.score));
	const medUse = median(records.map((r) => r.verdict.usefulness.score));

	console.log('\n=== Answer eval (1..5 per criterion) ===');
	console.log(`cases=${records.length}  passed=${passed}  failed=${records.length - passed}  pass_rate=${fmt(passed / records.length)}`);
	console.log(`faithfulness  mean=${fmt(meanFaith)}  median=${fmt(medFaith)}`);
	console.log(`relevance     mean=${fmt(meanRel)}   median=${fmt(medRel)}`);
	console.log(`usefulness    mean=${fmt(meanUse)}   median=${fmt(medUse)}`);

	const failures = records.filter((r) => !r.passed);
	if (failures.length > 0) {
		console.log('\nFailures:');
		for (const r of failures) {
			console.log(
				`  - ${r.caseId}: faith=${r.verdict.faithfulness.score} rel=${r.verdict.relevance.score} use=${r.verdict.usefulness.score} | ${r.question.slice(0, 70)}`
			);
		}
	}
}

async function evaluateCase(c: AnswerCase): Promise<CaseRecord> {
	const composed: ComposedAnswer = await composeAnswer({
		userId: EVAL_RETRIEVAL_USER_ID,
		question: c.question
	});
	const verdict = await judgeAnswer({
		question: c.question,
		answer: composed.answer,
		citations: composed.citations,
		thoughts: composed.retrieved.map((r) => ({ id: r.id, normalizedText: r.normalizedText }))
	});
	return {
		caseId: c.id,
		question: c.question,
		expectedFacts: c.expectedFacts,
		answer: composed.answer,
		citations: composed.citations,
		retrievedIds: composed.retrieved.map((r) => r.id),
		verdict,
		passed: caseHasPassed(verdict)
	};
}

async function main(): Promise<void> {
	const stopHeartbeat = startEvalHeartbeat('eval:answer');
	try {
		const cases = loadAnswerCases().cases;
		logEval(`running ${cases.length} answer cases`);

		const records = await withEvalDb(EVAL_JUDGE_USER_ID, async (db) => {
			await ensureJudgeUser(db);
			const out: CaseRecord[] = [];
			for (const c of cases) {
				try {
					const rec = await evaluateCase(c);
					out.push(rec);
					const v = rec.verdict;
					logEval(
						`${rec.caseId} faith=${v.faithfulness.score} rel=${v.relevance.score} use=${v.usefulness.score} ${rec.passed ? 'pass' : 'FAIL'}`
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logEval(`${c.id} ERROR: ${message}`);
					throw err;
				}
			}
			return out;
		});

		printSummary(records);

		const { reportPath, latestPath } = writeReport('answer', {
			generatedAt: new Date().toISOString(),
			retrievalUserId: EVAL_RETRIEVAL_USER_ID,
			judgeUserId: EVAL_JUDGE_USER_ID,
			passThreshold: PASS_THRESHOLD,
			caseCount: records.length,
			passed: records.filter((r) => r.passed).length,
			summary: {
				faithfulness: {
					mean: meanScore(records, (v) => v.faithfulness.score),
					median: median(records.map((r) => r.verdict.faithfulness.score))
				},
				relevance: {
					mean: meanScore(records, (v) => v.relevance.score),
					median: median(records.map((r) => r.verdict.relevance.score))
				},
				usefulness: {
					mean: meanScore(records, (v) => v.usefulness.score),
					median: median(records.map((r) => r.verdict.usefulness.score))
				}
			},
			records
		});
		logEval(`wrote report:\n  ${reportPath}\n  ${latestPath}`);
	} finally {
		stopHeartbeat();
	}
}

void runEval(main);
