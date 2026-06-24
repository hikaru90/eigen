import { inArray } from 'drizzle-orm';
import { queueCapture } from '$lib/server/capture/queue-capture';
import { processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought';
import { thought } from '$lib/server/db/schema';
import { deleteEvalUserRow, insertEvalUserRow } from '$lib/eval/store';
import { logEval, withEvalDb } from '../harness/eval-context';
import { mapWithConcurrency } from '../harness/concurrency';
import {
	waitForThoughtEnrichmentComplete,
	type ThoughtEnrichmentTarget
} from '../harness/wait-enrichment';
import { buildCorpusTexts, graphScaleCorpusUserId } from './seed-corpus';

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
}): Promise<SeedCorpusResult> {
	const userId = graphScaleCorpusUserId(input.runId, input.n);
	const texts = buildCorpusTexts(input.n, input.runId);
	const billing = { billingUserId: input.billingUserId };
	const startedAt = Date.now();

	await resetGraphScaleCorpusUser(userId);
	logEval(`graph-scale: seeding ${input.n} thought(s) into ${userId}`);

	const thoughtIds = await withEvalDb(
		userId,
		async () => {
			const indexed = await mapWithConcurrency(texts, input.seedConcurrency, async (rawText, index) => {
				const queued = await queueCapture(userId, rawText, {
					source: 'eval',
					skipWorker: true
				});
				return { index, thoughtId: queued.thoughtId };
			});
			indexed.sort((a, b) => a.index - b.index);
			const ids = indexed.map((row) => row.thoughtId);
			await processCaptureEnrichQueue(userId);
			return ids;
		},
		billing
	);

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

	const wallMs = Date.now() - startedAt;
	logEval(`graph-scale: seeded ${thoughtIds.length} thought(s) in ${wallMs}ms`);
	return { userId, thoughtIds, wallMs };
}
