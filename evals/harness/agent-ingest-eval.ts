/**
 * Agent ingest eval harness.
 *
 * End-to-end test of the full memory pipeline from an agent's perspective:
 *
 *   Phase 0 — Setup     : create a fresh isolated eval user (unique per run)
 *   Phase 1 — Ingest    : call captureThought() for each of 10 thoughts, record
 *                         pipeline phase completion and timing
 *   Phase 2 — Retrieval : probe memory with 7 queries, measure Recall@1/3/5,
 *                         NDCG@5, MRR (by category and overall)
 *   Phase 3 — Answer    : run 3 synthesis QA cases through composeAnswer +
 *                         LLM-as-judge (faithfulness / relevance / usefulness)
 *   Phase 4 — Fidelity  : judge whether each stored normalizedText faithfully
 *                         represents the original rawText submitted by the agent
 *   Cleanup             : delete auth.user (cascades to all brain schema tables)
 *   Report              : write evals/reports/agent-{timestamp}.json
 *
 * Run with: `npm run eval:agent`
 *
 * Each run is fully isolated — no shared state with the retrieval or answer
 * eval users, and no data left behind after the run completes or fails.
 */
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import { captureThought } from '$lib/server/capture/service';
import { searchThoughts } from '$lib/server/retrieval/service';
import { composeAnswer } from '$lib/server/qa/compose-answer';
import { logEval, runEval, startEvalHeartbeat, withEvalDb } from './eval-context';
import { newEvalAgentUserId, EVAL_JUDGE_USER_ID } from './eval-config';
import { loadAgentThoughts, loadAgentProbes } from './dataset';
import type { AgentThought, AgentRetrievalProbe, AgentQaProbe, AgentProbeCategory } from './dataset';
import {
	buildRelevanceMap,
	recallAtK,
	ndcgAtK,
	reciprocalRank
} from './metrics';
import { judgeAnswer } from './judge';
import { judgeCaptureFidelity, type FidelityVerdict } from './capture-fidelity';
import { writeReport } from './report';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IngestRecord = {
	evalId: string;
	thoughtId: string;
	rawText: string;
	normalizedText: string;
	categoryAssigned: string;
	phasesCompleted: string[];
	durationMs: number;
};

type AgentProbeMetrics = {
	recallAt1: number;
	recallAt3: number;
	recallAt5: number;
	ndcgAt5: number;
	mrr: number;
};

type RetrievalProbeRecord = {
	probeId: string;
	category: AgentProbeCategory;
	query: string;
	ranked: string[];
	metrics: AgentProbeMetrics;
};

type AnswerCaseRecord = {
	caseId: string;
	question: string;
	answer: string;
	citations: string[];
	faithfulness: number;
	relevance: number;
	usefulness: number;
	passed: boolean;
};

type FidelityRecord = {
	evalId: string;
} & FidelityVerdict;

// ---------------------------------------------------------------------------
// Phase 0 — Setup
// ---------------------------------------------------------------------------

async function createEvalUser(db: AppDatabase, userId: string): Promise<void> {
	await db.insert(user).values({
		id: userId,
		name: 'Eval Agent Runner',
		email: `${userId}@local.eval`,
		emailVerified: true,
		onboardingCompleted: true
	});
	logEval(`created eval user ${userId}`);
}

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

// ---------------------------------------------------------------------------
// Phase 1 — Ingest
// ---------------------------------------------------------------------------

async function runIngestPhase(
	userId: string,
	thoughts: AgentThought[]
): Promise<{ ingestRecords: IngestRecord[]; idMap: Map<string, string> }> {
	logEval(`ingest phase start: ${thoughts.length} thoughts`);
	const ingestRecords: IngestRecord[] = [];
	const idMap = new Map<string, string>(); // evalId → DB uuid

	for (let i = 0; i < thoughts.length; i++) {
		const item = thoughts[i];
		const phasesCompleted: string[] = [];
		const t0 = Date.now();

		const stored = await captureThought(userId, item.rawText, {
			onProgress: (phase) => phasesCompleted.push(phase)
		});

		const durationMs = Date.now() - t0;
		idMap.set(item.id, stored.id);

		ingestRecords.push({
			evalId: item.id,
			thoughtId: stored.id,
			rawText: item.rawText,
			normalizedText: stored.normalizedText,
			categoryAssigned: stored.category,
			phasesCompleted,
			durationMs
		});

		logEval(
			`ingest ${i + 1}/${thoughts.length}: ${item.id} → ${stored.id} (${durationMs}ms, category=${stored.category}, phases=${phasesCompleted.length})`
		);
	}

	const totalMs = ingestRecords.reduce((acc, r) => acc + r.durationMs, 0);
	logEval(`ingest phase complete: total=${totalMs}ms mean=${Math.round(totalMs / thoughts.length)}ms`);
	return { ingestRecords, idMap };
}

// ---------------------------------------------------------------------------
// Phase 2 — Retrieval quality
// ---------------------------------------------------------------------------

function computeProbeMetrics(ranked: string[], probe: AgentRetrievalProbe): AgentProbeMetrics {
	const relevance = buildRelevanceMap(probe.relevant);
	return {
		recallAt1: recallAtK(ranked, relevance, 1),
		recallAt3: recallAtK(ranked, relevance, 3),
		recallAt5: recallAtK(ranked, relevance, 5),
		ndcgAt5: ndcgAtK(ranked, relevance, 5),
		mrr: reciprocalRank(ranked, relevance)
	};
}

function meanProbeMetrics(items: AgentProbeMetrics[]): AgentProbeMetrics {
	if (items.length === 0) {
		return { recallAt1: 0, recallAt3: 0, recallAt5: 0, ndcgAt5: 0, mrr: 0 };
	}
	const sum = items.reduce(
		(acc, m) => ({
			recallAt1: acc.recallAt1 + m.recallAt1,
			recallAt3: acc.recallAt3 + m.recallAt3,
			recallAt5: acc.recallAt5 + m.recallAt5,
			ndcgAt5: acc.ndcgAt5 + m.ndcgAt5,
			mrr: acc.mrr + m.mrr
		}),
		{ recallAt1: 0, recallAt3: 0, recallAt5: 0, ndcgAt5: 0, mrr: 0 }
	);
	const n = items.length;
	return {
		recallAt1: sum.recallAt1 / n,
		recallAt3: sum.recallAt3 / n,
		recallAt5: sum.recallAt5 / n,
		ndcgAt5: sum.ndcgAt5 / n,
		mrr: sum.mrr / n
	};
}

async function runRetrievalPhase(
	userId: string,
	probes: AgentRetrievalProbe[],
	uuidToEvalId: Map<string, string>
): Promise<RetrievalProbeRecord[]> {
	logEval(`retrieval phase start: ${probes.length} probes`);
	const records: RetrievalProbeRecord[] = [];

	for (let i = 0; i < probes.length; i++) {
		const probe = probes[i];
		const results = await searchThoughts({
			userId,
			query: probe.text,
			topK: 7
		});
		const ranked: string[] = [];
		for (const r of results) {
			const evalId = uuidToEvalId.get(r.id);
			if (evalId) ranked.push(evalId);
		}
		const metrics = computeProbeMetrics(ranked, probe);
		records.push({ probeId: probe.id, category: probe.category, query: probe.text, ranked, metrics });
		logEval(
			`retrieval ${i + 1}/${probes.length}: ${probe.id} [${probe.category}] ` +
				`R@1=${metrics.recallAt1.toFixed(2)} R@3=${metrics.recallAt3.toFixed(2)} ` +
				`NDCG@5=${metrics.ndcgAt5.toFixed(3)} MRR=${metrics.mrr.toFixed(3)}`
		);
	}

	return records;
}

function aggregateRetrievalByCategoryAndOverall(records: RetrievalProbeRecord[]): {
	overall: AgentProbeMetrics;
	byCategory: Record<AgentProbeCategory, AgentProbeMetrics>;
} {
	const buckets: Record<AgentProbeCategory, AgentProbeMetrics[]> = {
		direct_recall: [],
		entity_relation: []
	};
	for (const r of records) {
		buckets[r.category].push(r.metrics);
	}
	return {
		overall: meanProbeMetrics(records.map((r) => r.metrics)),
		byCategory: {
			direct_recall: meanProbeMetrics(buckets.direct_recall),
			entity_relation: meanProbeMetrics(buckets.entity_relation)
		}
	};
}

// ---------------------------------------------------------------------------
// Phase 3 — Answer quality
// ---------------------------------------------------------------------------

async function runAnswerPhase(
	userId: string,
	qaCases: AgentQaProbe[]
): Promise<AnswerCaseRecord[]> {
	logEval(`answer phase start: ${qaCases.length} cases`);
	const records: AnswerCaseRecord[] = [];

	for (let i = 0; i < qaCases.length; i++) {
		const qa = qaCases[i];
		const composed = await composeAnswer({ userId, question: qa.question });
		const verdict = await judgeAnswer({
			question: qa.question,
			answer: composed.answer,
			citations: composed.citations,
			thoughts: composed.retrieved.map((r) => ({
				id: r.id,
				normalizedText: r.normalizedText
			}))
		});
		const passed =
			verdict.faithfulness.score >= 3 &&
			verdict.relevance.score >= 3 &&
			verdict.usefulness.score >= 3;
		records.push({
			caseId: qa.id,
			question: qa.question,
			answer: composed.answer,
			citations: composed.citations,
			faithfulness: verdict.faithfulness.score,
			relevance: verdict.relevance.score,
			usefulness: verdict.usefulness.score,
			passed
		});
		logEval(
			`answer ${i + 1}/${qaCases.length}: ${qa.id} ` +
				`faith=${verdict.faithfulness.score} rel=${verdict.relevance.score} use=${verdict.usefulness.score} ` +
				`${passed ? 'pass' : 'FAIL'}`
		);
	}

	return records;
}

// ---------------------------------------------------------------------------
// Phase 4 — Capture fidelity
// ---------------------------------------------------------------------------

async function runFidelityPhase(ingestRecords: IngestRecord[]): Promise<FidelityRecord[]> {
	logEval(`fidelity phase start: ${ingestRecords.length} thoughts`);
	const records: FidelityRecord[] = [];

	for (let i = 0; i < ingestRecords.length; i++) {
		const ingest = ingestRecords[i];
		const verdict = await judgeCaptureFidelity({
			rawText: ingest.rawText,
			normalizedText: ingest.normalizedText,
			category: ingest.categoryAssigned
		});
		records.push({ evalId: ingest.evalId, ...verdict });
		logEval(
			`fidelity ${i + 1}/${ingestRecords.length}: ${ingest.evalId} ` +
				`score=${verdict.score} faithful=${verdict.faithful}`
		);
	}

	return records;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupEvalUser(db: AppDatabase, userId: string): Promise<void> {
	// Deleting the auth.user row cascades to all brain schema tables via the
	// onDelete: 'cascade' FK constraints defined in brain.schema.ts. This is
	// the safest approach: no risk of missed tables or ordering issues.
	await db.delete(user).where(eq(user.id, userId));
	logEval(`cleanup complete: deleted user ${userId} (cascade removed all brain rows)`);
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
	return n.toFixed(3);
}

function pct(n: number): string {
	return (n * 100).toFixed(1) + '%';
}

function printSummary(
	ingestRecords: IngestRecord[],
	retrievalRecords: RetrievalProbeRecord[],
	answerRecords: AnswerCaseRecord[],
	fidelityRecords: FidelityRecord[]
): void {
	// Ingest
	const totalIngestMs = ingestRecords.reduce((a, r) => a + r.durationMs, 0);
	console.log(`\n=== Agent Ingest Eval ===`);
	console.log(`thoughts ingested: ${ingestRecords.length}  total_ms: ${totalIngestMs}  mean_ms: ${Math.round(totalIngestMs / ingestRecords.length)}`);
	for (const r of ingestRecords) {
		console.log(`  ${r.evalId}  category=${r.categoryAssigned}  phases=${r.phasesCompleted.length}  ${r.durationMs}ms`);
	}

	// Retrieval
	const { overall, byCategory } = aggregateRetrievalByCategoryAndOverall(retrievalRecords);
	console.log(`\n=== Retrieval Performance (Recall@1/3/5, NDCG@5, MRR) ===`);
	console.log(`Overall: R@1=${pct(overall.recallAt1)} NDCG@5=${fmt(overall.ndcgAt5)} MRR=${fmt(overall.mrr)}`);
	for (const [cat, metrics] of Object.entries(byCategory) as [AgentProbeCategory, AgentProbeMetrics][]) {
		console.log(`${cat.padEnd(16)}  R@1=${pct(metrics.recallAt1)} NDCG@5=${fmt(metrics.ndcgAt5)} MRR=${fmt(metrics.mrr)}`);
	}
	if (ingestRecords.length === 1) {
		console.log(`Only 1 thought in corpus → low recall (only 1 relevant item possible per query).`);
	}

	// Answer
	const passed = answerRecords.filter((r) => r.passed).length;
	const meanFaith = answerRecords.reduce((a, r) => a + r.faithfulness, 0) / answerRecords.length;
	const meanRel = answerRecords.reduce((a, r) => a + r.relevance, 0) / answerRecords.length;
	const meanUse = answerRecords.reduce((a, r) => a + r.usefulness, 0) / answerRecords.length;
	console.log(`\n=== Answer Quality (1-5 scale, pass≥3) ===`);
	console.log(`Faithfulness: ${meanFaith.toFixed(1)} mean`);
	console.log(`Relevance: ${meanRel.toFixed(1)} mean`);
	console.log(`Usefulness: ${meanUse.toFixed(1)} mean`);
	console.log(`${passed}/${answerRecords.length} passed`);
	if (passed < answerRecords.length) {
		const failures = answerRecords.filter((r) => !r.passed);
		for (const f of failures) {
			console.log(`  FAIL ${f.caseId}: faith=${f.faithfulness} rel=${f.relevance} use=${f.usefulness}`);
		}
	}

	// Fidelity
	const fidelityPassed = fidelityRecords.filter((r) => r.faithful).length;
	const meanScore = fidelityRecords.reduce((a, r) => a + r.score, 0) / fidelityRecords.length;
	console.log(`\n=== Capture Fidelity ===`);
	console.log(`${fidelityPassed}/${fidelityRecords.length} thoughts faithful (score=${meanScore.toFixed(0)}/5)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const stopHeartbeat = startEvalHeartbeat('eval:agent');
	const userId = newEvalAgentUserId();
	logEval(`eval run user: ${userId}`);

	try {
		const amountArg = process.argv.indexOf('--amount');
		const amount = amountArg !== -1 ? parseInt(process.argv[amountArg + 1], 10) : undefined;

		const { thoughts: allThoughts } = loadAgentThoughts();
		const thoughts = amount !== undefined ? allThoughts.slice(0, amount) : allThoughts;
		const { retrieval: retrievalProbes, qa: qaProbes } = loadAgentProbes();
		if (amount !== undefined) logEval(`--amount ${amount}: using ${thoughts.length}/${allThoughts.length} thoughts`);
		logEval(`dataset: thoughts=${thoughts.length} retrieval_probes=${retrievalProbes.length} qa_cases=${qaProbes.length}`);

		const {
			ingestRecords,
			retrievalRecords,
			answerRecords,
			fidelityRecords
		} = await withEvalDb(userId, async (db) => {
			let ingestRecords: IngestRecord[] = [];
			let retrievalRecords: RetrievalProbeRecord[] = [];
			let answerRecords: AnswerCaseRecord[] = [];
			let fidelityRecords: FidelityRecord[] = [];

			try {
				await createEvalUser(db, userId);
				await ensureJudgeUser(db);

				// Phase 1: Ingest
				const { ingestRecords: ir, idMap } = await runIngestPhase(userId, thoughts);
				ingestRecords = ir;

				// Build reverse map for retrieval ranking
				const uuidToEvalId = new Map<string, string>();
				for (const [evalId, uuid] of idMap.entries()) {
					uuidToEvalId.set(uuid, evalId);
				}

				// Phase 2: Retrieval
				retrievalRecords = await runRetrievalPhase(userId, retrievalProbes, uuidToEvalId);

				// Phase 3: Answer
				answerRecords = await runAnswerPhase(userId, qaProbes);

				// Phase 4: Capture fidelity
				fidelityRecords = await runFidelityPhase(ingestRecords);
			} finally {
				// Always clean up — even on partial failure.
				// Auth user cascade handles all brain schema rows.
				try {
					await cleanupEvalUser(db, userId);
				} catch (cleanupErr) {
					logEval(
						`cleanup warning: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
					);
				}
			}

			return { ingestRecords, retrievalRecords, answerRecords, fidelityRecords };
		});

		printSummary(ingestRecords, retrievalRecords, answerRecords, fidelityRecords);

		const { overall, byCategory } = aggregateRetrievalByCategoryAndOverall(retrievalRecords);
		const answerPassed = answerRecords.filter((r) => r.passed).length;
		const fidelityPassed = fidelityRecords.filter((r) => r.faithful).length;
		const meanFidelityScore =
			fidelityRecords.length > 0
				? fidelityRecords.reduce((a, r) => a + r.score, 0) / fidelityRecords.length
				: 0;

		const { reportPath, latestPath } = writeReport('agent', {
			generatedAt: new Date().toISOString(),
			userId,
			thoughtCount: thoughts.length,
			ingest: {
				totalDurationMs: ingestRecords.reduce((a, r) => a + r.durationMs, 0),
				perThought: ingestRecords.map((r) => ({
					evalId: r.evalId,
					thoughtId: r.thoughtId,
					durationMs: r.durationMs,
					categoryAssigned: r.categoryAssigned,
					phasesCompleted: r.phasesCompleted
				}))
			},
			retrieval: {
				probeCount: retrievalRecords.length,
				overall,
				byCategory,
				perProbe: retrievalRecords.map((r) => ({
					probeId: r.probeId,
					category: r.category,
					query: r.query,
					ranked: r.ranked,
					metrics: r.metrics
				}))
			},
			answer: {
				passed: answerPassed,
				total: answerRecords.length,
				passRate: answerRecords.length > 0 ? answerPassed / answerRecords.length : 0,
				summary: {
					faithfulness: {
						mean:
							answerRecords.length > 0
								? answerRecords.reduce((a, r) => a + r.faithfulness, 0) / answerRecords.length
								: 0
					},
					relevance: {
						mean:
							answerRecords.length > 0
								? answerRecords.reduce((a, r) => a + r.relevance, 0) / answerRecords.length
								: 0
					},
					usefulness: {
						mean:
							answerRecords.length > 0
								? answerRecords.reduce((a, r) => a + r.usefulness, 0) / answerRecords.length
								: 0
					}
				},
				perCase: answerRecords
			},
			captureFidelity: {
				rate: fidelityRecords.length > 0 ? fidelityPassed / fidelityRecords.length : 0,
				passed: fidelityPassed,
				total: fidelityRecords.length,
				meanScore: meanFidelityScore,
				perThought: fidelityRecords
			}
		});

		logEval(`wrote report:\n  ${reportPath}\n  ${latestPath}`);
	} finally {
		stopHeartbeat();
	}
}

void runEval(main);
