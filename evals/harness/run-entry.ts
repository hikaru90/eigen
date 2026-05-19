/**
 * DB-backed eval runner: one entry at a time through real capture / retrieval / answer paths.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { user } from '$lib/server/db/auth.schema';
import { captureThought, editStoredThought } from '$lib/server/capture/service';
import { composeAnswer } from '$lib/server/qa/compose-answer';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/brain.schema';
import type { EvalEntry } from '$lib/server/db/brain.schema';
import {
	appendEvalEvent,
	deleteEvalUserRow,
	getEvalRunRow,
	getThoughtMap,
	insertEvalUserRow,
	listEvalEntries,
	updateEvalEntry,
	updateEvalRunStatus,
	upsertThoughtMap
} from '$lib/eval/store';
import { logEval, withEvalDb } from './eval-context';
import { EVAL_JUDGE_USER_ID } from './eval-config';
import { judgeCaptureFidelity } from './capture-fidelity';
import { judgeAnswerAcceptance } from './judge-acceptance';
import { runRetrievalSweepForQuery } from './retrieval-sweep';
import type { EvalRetrievalQuery, QaChecks } from './qa-types';
import { captureEvalGraphSnapshot } from './graph-snapshot';
import { runStructuralChecks } from './qa-checks';
import { assertThoughtEntitiesResolved } from './wait-enrichment';
import { resolveEntryTimeoutMs, withEvalEntryTimeout } from './entry-timeout';
import { generateRunSynthesis, type EntrySummary } from './synthesis';
import type { EvalSynthesis } from '$lib/eval/types';

async function ensureJudgeUser(): Promise<void> {
	const db = getDb();
	const existing = await db.select().from(user).where(eq(user.id, EVAL_JUDGE_USER_ID));
	if (existing.length > 0) return;
	await insertEvalUserRow(EVAL_JUDGE_USER_ID, 'Eval Runner (Judge)');
}

async function runCaptureEntry(input: {
	operatorUserId: string;
	runId: string;
	entry: EvalEntry;
	evalUserId: string;
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
	const rawText = String(input.entry.inputJson.rawText ?? '');
	if (!rawText.trim()) {
		throw new Error('capture entry missing rawText');
	}
	const fixtureRef = input.entry.fixtureRef ?? 'unknown';

	const stored = await withEvalDb(input.evalUserId, () =>
		captureThought(input.evalUserId, rawText, {
			onProgress: async (ev) => {
				const phases = ev.parallel ? ev.phases.join(',') : ev.phase;
				await appendEvalEvent({
					operatorUserId: input.operatorUserId,
					runId: input.runId,
					entryId: input.entry.id,
					message: `capture progress: ${phases}`
				});
			}
		})
	);

	await withEvalDb(input.evalUserId, async (db) => {
		const [enrichRow] = await db
			.select({ enrichedAt: thought.enrichedAt })
			.from(thought)
			.where(and(eq(thought.userId, input.evalUserId), eq(thought.id, stored.id)));
		if (!enrichRow?.enrichedAt) {
			logEval(
				`capture enrich incomplete for ${stored.id} (enriched_at unset — ` +
					'check dev logs for [enrich] step failed)'
			);
		}
	});

	await withEvalDb(input.evalUserId, async (db) => {
		await assertThoughtEntitiesResolved(db, input.evalUserId, [stored.id]);
	});

	const fidelity = await judgeCaptureFidelity({
		rawText: stored.rawText,
		normalizedText: stored.normalizedText,
		category: stored.category
	});

	await upsertThoughtMap(input.operatorUserId, input.runId, fixtureRef, stored.id);

	return {
		passed: fidelity.faithful,
		result: {
			thoughtId: stored.id,
			rawText: stored.rawText,
			category: stored.category,
			normalizedText: stored.normalizedText,
			fidelityScore: fidelity.score,
			fidelityFaithful: fidelity.faithful,
			fidelityRationale: fidelity.rationale,
			explanation: fidelity.rationale
		}
	};
}

async function runCheckEntry(input: {
	operatorUserId: string;
	runId: string;
	entry: EvalEntry;
	evalUserId: string;
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
	const checks = input.entry.inputJson.checks as QaChecks | undefined;
	if (!checks) {
		throw new Error('check entry missing checks config');
	}

	const fixtureToUuid = await getThoughtMap(input.operatorUserId, input.runId);
	const scopedMap = new Map<string, string>();
	const fixtureIds = Array.isArray(input.entry.inputJson.fixtureIds)
		? (input.entry.inputJson.fixtureIds as string[])
		: [];
	for (const fixtureId of fixtureIds) {
		const uuid = fixtureToUuid.get(fixtureId);
		if (uuid) scopedMap.set(fixtureId, uuid);
	}

	const result = await withEvalDb(input.evalUserId, (db) =>
		runStructuralChecks({
			db,
			userId: input.evalUserId,
			fixtureToUuid: scopedMap,
			checks
		})
	);

	let graphSnapshot: Awaited<ReturnType<typeof captureEvalGraphSnapshot>> | undefined;
	try {
		graphSnapshot = await captureEvalGraphSnapshot({
			evalUserId: input.evalUserId,
			fixtureToUuid
		});
		await appendEvalEvent({
			operatorUserId: input.operatorUserId,
			runId: input.runId,
			entryId: input.entry.id,
			message: `graph snapshot: ${graphSnapshot.nodes.length} nodes, ${graphSnapshot.edges.length} edges`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await appendEvalEvent({
			operatorUserId: input.operatorUserId,
			runId: input.runId,
			entryId: input.entry.id,
			level: 'warn',
			message: `graph snapshot failed: ${message}`
		});
	}

	const passed = result.failedCount === 0;
	return {
		passed,
		result: {
			qaId: input.entry.inputJson.qaId,
			...result,
			...(graphSnapshot ? { graphSnapshot } : {}),
			explanation:
				passed
					? `All ${result.passedCount} structural assertions passed`
					: `${result.failedCount} of ${result.assertions.length} assertions failed`
		}
	};
}

async function runRetrievalEntry(input: {
	operatorUserId: string;
	runId: string;
	entry: EvalEntry;
	evalUserId: string;
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
	const queryText = String(input.entry.inputJson.query ?? '');
	const relevant = input.entry.expectedJson.relevant as EvalRetrievalQuery['relevant'] | undefined;
	if (!queryText || !relevant) {
		throw new Error('retrieval entry missing query or expected relevant grades');
	}

	const fixtureToUuid = await getThoughtMap(input.operatorUserId, input.runId);
	/** Grade only thoughts ingested in this run; ignore corpus labels for uncaptured fixtures. */
	const scopedRelevant = relevant.filter((r) => fixtureToUuid.has(r.id));
	const skippedLabels = relevant.filter((r) => !fixtureToUuid.has(r.id));
	if (scopedRelevant.length === 0) {
		throw new Error(
			'retrieval: no relevance labels match captured thoughts in this run — add captures or pick another query'
		);
	}
	if (skippedLabels.length > 0) {
		await appendEvalEvent({
			operatorUserId: input.operatorUserId,
			runId: input.runId,
			entryId: input.entry.id,
			message:
				`grading against ${scopedRelevant.length} captured fixture(s); ` +
				`skipped uncaptured labels: ${skippedLabels.map((s) => s.id).join(', ')}`
		});
	}

	const query: EvalRetrievalQuery = {
		id: input.entry.fixtureRef ?? 'custom',
		category: (input.entry.inputJson.category as EvalRetrievalQuery['category']) ?? 'hybrid',
		text: queryText,
		relevant: scopedRelevant
	};

	const minNdcgAt10 =
		typeof input.entry.expectedJson.minNdcgAt10 === 'number'
			? input.entry.expectedJson.minNdcgAt10
			: 0.5;
	const needleFixtureId =
		typeof input.entry.expectedJson.needleFixtureId === 'string'
			? input.entry.expectedJson.needleFixtureId
			: undefined;
	const needleTopK =
		typeof input.entry.expectedJson.needleTopK === 'number'
			? input.entry.expectedJson.needleTopK
			: 5;

	const sweep = await runRetrievalSweepForQuery({
		evalUserId: input.evalUserId,
		query,
		fixtureToUuid,
		minNdcgAt10,
		onProgress: (msg) =>
			void appendEvalEvent({
				operatorUserId: input.operatorUserId,
				runId: input.runId,
				entryId: input.entry.id,
				message: msg
			})
	});

	const bestSweepRow = sweep.weightSweep.find(
		(w) =>
			w.weights.vector === sweep.bestWeights.vector && w.weights.graph === sweep.bestWeights.graph
	);

	const topRanked = bestSweepRow?.ranked ?? [];
	let passed = sweep.passed;
	const extraChecks: string[] = [];

	if (needleFixtureId) {
		const needleInTopK = topRanked.slice(0, needleTopK).includes(needleFixtureId);
		if (!needleInTopK) passed = false;
		extraChecks.push(
			needleInTopK
				? `needle ${needleFixtureId} in top-${needleTopK}`
				: `needle ${needleFixtureId} NOT in top-${needleTopK} (ranked: ${topRanked.slice(0, needleTopK).join(', ')})`
		);
	}

	const requireSalienceBump = input.entry.expectedJson.requireSalienceBump === true;
	const minAccessCount =
		typeof input.entry.expectedJson.minAccessCount === 'number'
			? input.entry.expectedJson.minAccessCount
			: undefined;
	if (requireSalienceBump || minAccessCount != null) {
		const rankedUuids = topRanked
			.map((fid) => fixtureToUuid.get(fid))
			.filter((id): id is string => Boolean(id));
		if (rankedUuids.length > 0) {
			const rows = await withEvalDb(input.evalUserId, (db) =>
				db
					.select({ id: thought.id, accessCount: thought.accessCount })
					.from(thought)
					.where(
						and(eq(thought.userId, input.evalUserId), inArray(thought.id, rankedUuids))
					)
			);
			const minSeen = rows.length > 0 ? Math.min(...rows.map((r) => r.accessCount)) : 0;
			if (requireSalienceBump && minSeen < 1) {
				passed = false;
				extraChecks.push(`access_count bump missing (min=${minSeen})`);
			} else if (minAccessCount != null && minSeen < minAccessCount) {
				passed = false;
				extraChecks.push(`access_count min ${minAccessCount} not met (min=${minSeen})`);
			} else {
				extraChecks.push(`access_count ok (min=${minSeen})`);
			}
		}
	}

	return {
		passed,
		result: {
			...sweep,
			query: queryText,
			topRanked,
			scopedRelevant,
			skippedLabels: skippedLabels.map((s) => s.id),
			needleCheck: needleFixtureId
				? { fixtureId: needleFixtureId, topK: needleTopK, inTopK: topRanked.slice(0, needleTopK).includes(needleFixtureId) }
				: undefined,
			extraChecks,
			explanation: [
				`Best NDCG@10=${sweep.bestNdcgAt10.toFixed(3)} (threshold=${minNdcgAt10})`,
				...extraChecks
			].join('; ')
		}
	};
}

async function runEditEntry(input: {
	operatorUserId: string;
	runId: string;
	entry: EvalEntry;
	evalUserId: string;
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
	const fixtureId = String(input.entry.inputJson.fixtureId ?? '');
	const newRawText = String(input.entry.inputJson.newRawText ?? '');
	if (!fixtureId.trim() || !newRawText.trim()) {
		throw new Error('edit entry missing fixtureId or newRawText');
	}

	const fixtureToUuid = await getThoughtMap(input.operatorUserId, input.runId);
	const thoughtId = fixtureToUuid.get(fixtureId);
	if (!thoughtId) {
		throw new Error(`edit: no captured thought for fixture ${fixtureId}`);
	}

	const editResult = await withEvalDb(input.evalUserId, () =>
		editStoredThought(input.evalUserId, thoughtId, newRawText, {
			onProgress: async (ev) => {
				const phases = ev.parallel ? ev.phases.join(',') : ev.phase;
				await appendEvalEvent({
					operatorUserId: input.operatorUserId,
					runId: input.runId,
					entryId: input.entry.id,
					message: `edit progress: ${phases}`
				});
			}
		})
	);
	if (!editResult.ok) {
		throw new Error(`edit failed: ${editResult.reason}`);
	}
	const stored = editResult.thought;

	await withEvalDb(input.evalUserId, async (db) => {
		await assertThoughtEntitiesResolved(db, input.evalUserId, [thoughtId]);
	});

	const normalized = stored.normalizedText.toLowerCase();
	const anchor = newRawText
		.trim()
		.split(/\s+/)
		.find((w) => w.replace(/[^a-z0-9]/gi, '').length > 4)
		?.replace(/[^a-z0-9]/gi, '')
		.toLowerCase();
	const passed = anchor ? normalized.includes(anchor) : normalized.length > 0;

	return {
		passed,
		result: {
			fixtureId,
			thoughtId: stored.id,
			newRawText,
			normalizedText: stored.normalizedText,
			explanation: passed
				? 'Stored text reflects edit request'
				: 'Stored text may not fully reflect edit request'
		}
	};
}

async function runAnswerEntry(input: {
	operatorUserId: string;
	runId: string;
	entry: EvalEntry;
	evalUserId: string;
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
	const question = String(input.entry.inputJson.question ?? '');
	const acceptance = String(input.entry.expectedJson.acceptance ?? '');
	const retrievalQuery =
		typeof input.entry.inputJson.retrievalQuery === 'string'
			? input.entry.inputJson.retrievalQuery.trim()
			: '';
	if (!question || !acceptance) {
		throw new Error('answer entry missing question or acceptance criteria');
	}

	const composed = await withEvalDb(input.evalUserId, () =>
		composeAnswer({
			userId: input.evalUserId,
			question,
			...(retrievalQuery ? { retrievalQuery } : {})
		})
	);

	const verdict = await judgeAnswerAcceptance({
		question,
		answer: composed.answer,
		acceptance,
		citations: composed.citations
	});

	return {
		passed: verdict.passed,
		result: {
			question,
			acceptance,
			answer: composed.answer,
			citations: composed.citations,
			retrieved: composed.retrieved.map((r) => ({
				id: r.id,
				normalizedText: r.normalizedText,
				category: r.category
			})),
			verdictScore: verdict.score,
			verdictPassed: verdict.passed,
			explanation: verdict.explanation
		}
	};
}

async function runOneEntry(input: {
	operatorUserId: string;
	runId: string;
	entry: EvalEntry;
	evalUserId: string;
}): Promise<void> {
	const startedAt = new Date();
	await updateEvalEntry(input.operatorUserId, input.entry.id, {
		status: 'running',
		startedAt
	});
	await appendEvalEvent({
		operatorUserId: input.operatorUserId,
		runId: input.runId,
		entryId: input.entry.id,
		message: `entry start: ${input.entry.kind} ${input.entry.fixtureRef ?? ''}`
	});

	const entryLabel = `${input.entry.kind} ${input.entry.fixtureRef ?? ''}`.trim();
	const timeoutMs = resolveEntryTimeoutMs(input.entry.kind);

	try {
		let outcome: { passed: boolean; result: Record<string, unknown> };
		outcome = await withEvalEntryTimeout(timeoutMs, entryLabel, async () => {
			if (input.entry.kind === 'capture') {
				return runCaptureEntry(input);
			}
			if (input.entry.kind === 'check') {
				return runCheckEntry(input);
			}
			if (input.entry.kind === 'retrieval') {
				return runRetrievalEntry(input);
			}
			if (input.entry.kind === 'edit') {
				return runEditEntry(input);
			}
			if (input.entry.kind === 'answer') {
				return runAnswerEntry(input);
			}
			throw new Error(`unknown entry kind: ${input.entry.kind}`);
		});

		const durationMs = Date.now() - startedAt.getTime();
		await updateEvalEntry(input.operatorUserId, input.entry.id, {
			status: 'completed',
			passed: outcome.passed,
			resultJson: outcome.result,
			durationMs,
			finishedAt: new Date()
		});
		await appendEvalEvent({
			operatorUserId: input.operatorUserId,
			runId: input.runId,
			entryId: input.entry.id,
			message: `entry done: passed=${outcome.passed} (${durationMs}ms)`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await updateEvalEntry(input.operatorUserId, input.entry.id, {
			status: 'failed',
			passed: false,
			error: message,
			finishedAt: new Date(),
			durationMs: Date.now() - startedAt.getTime()
		});
		await appendEvalEvent({
			operatorUserId: input.operatorUserId,
			runId: input.runId,
			entryId: input.entry.id,
			level: 'error',
			message
		});
	}
}

function entrySummaries(entries: EvalEntry[]): EntrySummary[] {
	return entries.map((e) => {
		const result = e.resultJson as Record<string, unknown> | null;
		let summary = `${e.kind} ${e.fixtureRef ?? ''}: ${e.status}`;
		if (e.passed === true) summary += ' PASS';
		if (e.passed === false) summary += ' FAIL';
		if (result?.explanation) summary += ` — ${String(result.explanation)}`;
		if (result?.bestNdcgAt10 != null) summary += ` ndcg=${Number(result.bestNdcgAt10).toFixed(3)}`;
		return {
			kind: e.kind,
			fixtureRef: e.fixtureRef,
			passed: e.passed,
			summary
		};
	});
}

export async function executeEvalRun(input: {
	operatorUserId: string;
	runId: string;
	keepEvalUser?: boolean;
	scenarioGoal?: string;
}): Promise<EvalSynthesis | null> {
	const run = await getEvalRunRow(input.operatorUserId, input.runId);
	if (!run) throw new Error(`eval run not found: ${input.runId}`);

	await ensureJudgeUser();
	await insertEvalUserRow(run.evalUserId, `Eval run ${run.label}`);


	await updateEvalRunStatus(input.operatorUserId, input.runId, {
		status: 'running',
		startedAt: new Date(),
		error: null
	});
	await appendEvalEvent({
		operatorUserId: input.operatorUserId,
		runId: input.runId,
		message: `run start: evalUserId=${run.evalUserId}`
	});

	let synthesis: EvalSynthesis | null = null;
	let runError: string | null = null;

	try {
		const entries = await listEvalEntries(input.operatorUserId, input.runId);
		const total = entries.length;
		for (const entry of entries) {
			if (entry.status === 'completed' || entry.status === 'failed') continue;
			await appendEvalEvent({
				operatorUserId: input.operatorUserId,
				runId: input.runId,
				entryId: entry.id,
				message: `step ${entry.ordinal + 1}/${total}: ${entry.kind} ${entry.fixtureRef ?? ''}`
			});
			await runOneEntry({
				operatorUserId: input.operatorUserId,
				runId: input.runId,
				entry,
				evalUserId: run.evalUserId
			});
		}

		const finalEntries = await listEvalEntries(input.operatorUserId, input.runId);
		synthesis = await generateRunSynthesis({
			runLabel: run.label,
			scenarioGoal: input.scenarioGoal,
			entries: entrySummaries(finalEntries)
		});
		await updateEvalRunStatus(input.operatorUserId, input.runId, {
			synthesisJson: synthesis
		});
	} catch (err) {
		runError = err instanceof Error ? err.message : String(err);
		await appendEvalEvent({
			operatorUserId: input.operatorUserId,
			runId: input.runId,
			level: 'error',
			message: runError
		});
	} finally {
		if (!input.keepEvalUser) {
			try {
				await deleteEvalUserRow(run.evalUserId);
				await appendEvalEvent({
					operatorUserId: input.operatorUserId,
					runId: input.runId,
					message: 'cleaned up eval user'
				});
			} catch (cleanupErr) {
				const msg =
					cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
				logEval(`cleanup warning: ${msg}`);
			}
		}

		const finalEntries = await listEvalEntries(input.operatorUserId, input.runId);
		const anyFailed = finalEntries.some((e) => e.status === 'failed' || e.passed === false);

		await updateEvalRunStatus(input.operatorUserId, input.runId, {
			status: runError || anyFailed ? 'failed' : 'completed',
			finishedAt: new Date(),
			error: runError
		});
	}

	return synthesis;
}
