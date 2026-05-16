/**
 * Phase: answer-qa
 *
 * Runs the synthesis QA probes against the live-ingested corpus:
 *   - Small focused set (qa-probes.yaml): 3 cases for the quick run
 *   - Full set (qa-cases.yaml): 48 cases across 10 capability dimensions
 *
 * Both run composeAnswer() + LLM-as-judge (4-axis rubric).
 * Uses EVAL_CORPUS_USER_ID so answers are grounded in the real pipeline output.
 */
import { eq } from 'drizzle-orm';
import { user } from '$lib/server/db/auth.schema';
import { composeAnswer } from '$lib/server/qa/compose-answer';
import type { AppDatabase } from '$lib/server/db';
import { logEval, withEvalDb } from '../eval-context';
import { EVAL_CORPUS_USER_ID } from '../seed-corpus';
import { EVAL_JUDGE_USER_ID } from '../eval-config';
import { loadAnswerCases, loadQaProbes, type AnswerCase, type QaProbe } from '../dataset';
import { judgeAnswer, type JudgeVerdict } from '../judge';
import { getPassThreshold } from '../judge-rubric';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnswerCaseResult = {
	caseId: string;
	question: string;
	expectedFacts: string[];
	dimension?: string;
	passThreshold: number;
	answer: string;
	citations: string[];
	retrievedIds: string[];
	verdict: JudgeVerdict;
	passed: boolean;
};

export type AnswerQaResult = {
	// Synthesis probes (small focused set)
	probes: {
		passed: number;
		total: number;
		passRate: number;
		cases: AnswerCaseResult[];
	};
	// Full QA eval (48 dimension-tagged cases)
	full: {
		passed: number;
		total: number;
		passRate: number;
		rubric: string;
		axisWeights: { accuracy: number; calibration: number; completeness: number; tone: number };
		summary: {
			weightedScore: { mean: number; median: number };
			accuracy: { mean: number; median: number };
			calibration: { mean: number; median: number };
			completeness: { mean: number; median: number };
			tone: { mean: number; median: number };
		};
		records: AnswerCaseResult[];
	};
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
	logEval(`created judge user ${EVAL_JUDGE_USER_ID}`);
}

function meanOf(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function medianOf(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function evaluateCase(
	caseId: string,
	question: string,
	expectedFacts: string[],
	dimension?: string
): Promise<AnswerCaseResult> {
	const composed = await composeAnswer({ userId: EVAL_CORPUS_USER_ID, question });
	const verdict = await judgeAnswer({
		question,
		answer: composed.answer,
		citations: composed.citations,
		thoughts: composed.retrieved.map((r) => ({
			id: r.id,
			normalizedText: r.normalizedText,
			createdAt: r.createdAt
		})),
		dimension
	});
	const threshold = getPassThreshold(dimension);
	return {
		caseId,
		question,
		expectedFacts,
		dimension,
		passThreshold: threshold,
		answer: composed.answer,
		citations: composed.citations,
		retrievedIds: composed.retrieved.map((r) => r.id),
		verdict,
		passed: verdict.weightedScore >= threshold
	};
}

function buildSummary(records: AnswerCaseResult[]) {
	return {
		weightedScore: {
			mean: meanOf(records.map((r) => r.verdict.weightedScore)),
			median: medianOf(records.map((r) => r.verdict.weightedScore))
		},
		accuracy: {
			mean: meanOf(records.map((r) => r.verdict.accuracy.score)),
			median: medianOf(records.map((r) => r.verdict.accuracy.score))
		},
		calibration: {
			mean: meanOf(records.map((r) => r.verdict.calibration.score)),
			median: medianOf(records.map((r) => r.verdict.calibration.score))
		},
		completeness: {
			mean: meanOf(records.map((r) => r.verdict.completeness.score)),
			median: medianOf(records.map((r) => r.verdict.completeness.score))
		},
		tone: {
			mean: meanOf(records.map((r) => r.verdict.tone.score)),
			median: medianOf(records.map((r) => r.verdict.tone.score))
		}
	};
}

// ── Main phase function ───────────────────────────────────────────────────────

export async function runAnswerQa(): Promise<AnswerQaResult> {
	logEval('answer-qa phase start');

	const qaProbes = loadQaProbes().qa;
	const answerCases = loadAnswerCases().cases;

	logEval(`probes=${qaProbes.length} answer_cases=${answerCases.length}`);

	return await withEvalDb(EVAL_JUDGE_USER_ID, async (db) => {
		await ensureJudgeUser(db);

		// ── Synthesis probes ────────────────────────────────────────────────────
		logEval(`running ${qaProbes.length} synthesis probes (parallel)`);

		const probeResults = await Promise.all(
			qaProbes.map(async (probe: QaProbe) => {
				const result = await evaluateCase(probe.id, probe.question, probe.expectedFacts);
				logEval(
					`probe: ${probe.id} score=${result.verdict.weightedScore.toFixed(2)} ` +
						`${result.passed ? 'pass' : 'FAIL'}`
				);
				return result;
			})
		);

		const probePassed = probeResults.filter((r) => r.passed).length;

		// ── Full QA eval ────────────────────────────────────────────────────────
		logEval(`running ${answerCases.length} answer eval cases (sequential)`);

		const fullRecords: AnswerCaseResult[] = [];
		for (const c of answerCases) {
			const result = await evaluateCase(c.id, c.question, c.expectedFacts, c.dimension);
			logEval(
				`answer: ${c.id} [${c.dimension ?? 'default'}] score=${result.verdict.weightedScore.toFixed(2)} ` +
					`threshold=${result.passThreshold.toFixed(2)} ${result.passed ? 'pass' : 'FAIL'}`
			);
			fullRecords.push(result);
		}

		const fullPassed = fullRecords.filter((r) => r.passed).length;

		logEval(
			`answer-qa phase complete: probes=${probePassed}/${probeResults.length} ` +
				`full=${fullPassed}/${fullRecords.length}`
		);

		return {
			probes: {
				passed: probePassed,
				total: probeResults.length,
				passRate: probeResults.length > 0 ? probePassed / probeResults.length : 0,
				cases: probeResults
			},
			full: {
				passed: fullPassed,
				total: fullRecords.length,
				passRate: fullRecords.length > 0 ? fullPassed / fullRecords.length : 0,
				rubric: 'golden-baseline-4axis-v1',
				axisWeights: { accuracy: 0.4, calibration: 0.25, completeness: 0.2, tone: 0.15 },
				summary: buildSummary(fullRecords),
				records: fullRecords
			}
		};
	});
}
