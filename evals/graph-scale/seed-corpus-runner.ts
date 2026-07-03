import { inArray } from 'drizzle-orm';
import { queueCapture, claimNextPendingThought, countPendingEnrichRows, recoverStaleEnrichProcessingRows } from '$lib/server/capture/queue-capture';
import { enrichQueuedThought, processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought';
import { ensureHarnessCredentialAccount } from '$lib/server/e2e/harness-auth';
import { thought } from '$lib/server/db/schema';
import { deleteEvalUserRow, insertEvalUserRow } from '$lib/eval/store';
import { withEvalDb } from '../harness/eval-context';
import { mapWithConcurrency } from '../harness/concurrency';
import {
	waitForThoughtEnrichmentComplete,
	type ThoughtEnrichmentTarget
} from '../harness/wait-enrichment';
import { collectGraphScaleMetrics } from './graph-metrics';
import {
	collectGraphScaleIngestResult,
	formatGraphScaleIngestLogLine,
	type GraphScaleIngestSnapshot
} from './ingest-result';
import { buildCorpusTexts, graphScaleCorpusUserId } from './seed-corpus';

export type GraphScaleIngestResultEvent = GraphScaleIngestSnapshot & {
	n: number;
	index: number;
	total: number;
	error?: string;
};

export type SeedCorpusResult = {
	userId: string;
	thoughtIds: string[];
	wallMs: number;
};

export async function resetGraphScaleCorpusUser(userId: string): Promise<void> {
	try {
		await deleteEvalUserRow(userId);
	} catch {
		// first run — user may not exist
	}
	await insertEvalUserRow(userId, `Graph scale corpus ${userId}`);
}

/** Ingest N thoughts with full enrich into a fresh harness tenant. */
export async function seedGraphScaleCorpus(input: {
	runId: string;
	n: number;
	billingUserId: string;
	seedConcurrency: number;
	onSeedQueued?: (queued: number, total: number) => void;
	onSeedEnrich?: (enriched: number, total: number) => void;
	onIngestResult?: (result: GraphScaleIngestResultEvent) => void;
	onLiveMetrics?: (metrics: Awaited<ReturnType<typeof collectGraphScaleMetrics>>) => void;
	onEnrichPhase?: (phase: string) => void;
}): Promise<SeedCorpusResult> {
	const userId = graphScaleCorpusUserId(input.runId, input.n);
	const texts = buildCorpusTexts(input.n);
	const billing = { billingUserId: input.billingUserId };
	const startedAt = Date.now();

	await resetGraphScaleCorpusUser(userId);
	await ensureHarnessCredentialAccount(userId);

	await withEvalDb(
		userId,
		(db) => recoverStaleEnrichProcessingRows(userId, 60_000),
		billing
	);

	const maybePublishMetrics = async (force: boolean, enriched: number, total: number) => {
		if (!input.onLiveMetrics) return;
		const sampleEvery = total <= 20 ? 1 : 5;
		if (!force && enriched > 0 && enriched % sampleEvery !== 0 && enriched !== total) return;
		const metrics = await withEvalDb(
			userId,
			(db) => collectGraphScaleMetrics(userId, db),
			billing
		);
		input.onLiveMetrics(metrics);
	};

	const progressInterval = texts.length <= 20 ? 1 : Math.max(1, Math.floor(texts.length / 20));

	const thoughtIds = await withEvalDb(
		userId,
		async () => {
			const indexed = await mapWithConcurrency(texts, input.seedConcurrency, async (rawText, index) => {
				const queued = await queueCapture(userId, rawText, {
					source: 'eval',
					skipWorker: true
				});
				const done = index + 1;
				if (done === texts.length || done % progressInterval === 0) {
					input.onSeedQueued?.(done, texts.length);
				}
				return { index, thoughtId: queued.thoughtId };
			});
			indexed.sort((a, b) => a.index - b.index);
			return indexed.map((row) => row.thoughtId);
		},
		billing
	);

	await maybePublishMetrics(true, 0, texts.length);

	input.onSeedEnrich?.(0, texts.length);
	const thoughtIndexById = new Map(thoughtIds.map((id, index) => [id, index + 1]));

	const reportIngestResult = async (
		thoughtId: string,
		snapshot: GraphScaleIngestSnapshot,
		error?: string
	) => {
		input.onIngestResult?.({
			n: input.n,
			index: thoughtIndexById.get(thoughtId) ?? 0,
			total: texts.length,
			...snapshot,
			...(error ? { error } : {})
		});
	};

	await processCaptureEnrichQueue(userId, {
		claim: (uid) => withEvalDb(uid, () => claimNextPendingThought(uid), billing),
		enrich: async (uid, thoughtId) => {
			input.onEnrichPhase?.(`enrich started · ${thoughtId}`);
			try {
				await withEvalDb(uid, () => enrichQueuedThought(uid, thoughtId), billing);
				const snapshot = await withEvalDb(
					uid,
					(db) => collectGraphScaleIngestResult({ db, userId: uid, thoughtId }),
					billing
				);
				await reportIngestResult(thoughtId, snapshot);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await reportIngestResult(thoughtId, {
					thoughtId,
					enriched: false,
					entityCount: 0,
					hasEmbedding: false,
					ok: false
				}, message);
				throw err;
			}
		},
		countPending: (uid) => withEvalDb(uid, () => countPendingEnrichRows(uid), billing),
		onProcessed: async (enriched, total) => {
			input.onSeedEnrich?.(enriched, total ?? texts.length);
			await maybePublishMetrics(
				enriched === 0 || enriched === (total ?? texts.length),
				enriched,
				total ?? texts.length
			);
		}
	});

	const targets: ThoughtEnrichmentTarget[] = await withEvalDb(
		userId,
		async (db) => {
			const rows = await db
				.select({ id: thought.id, normalizedText: thought.normalizedText })
				.from(thought)
				.where(inArray(thought.id, thoughtIds));
			return rows.map((r) => ({ id: r.id, normalizedText: r.normalizedText }));
		},
		billing
	);

	await withEvalDb(
		userId,
		async (db) => {
			await waitForThoughtEnrichmentComplete({
				db,
				userId,
				targets,
				withEvalDbOptions: billing
			});
		},
		billing
	);

	return { userId, thoughtIds, wallMs: Date.now() - startedAt };
}
