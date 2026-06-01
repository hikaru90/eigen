import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	graphSyncJob,
	temporalEvent,
	type GraphSyncJobOperation
} from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { extractTemporalMentions } from '$lib/server/memory/temporal-extraction';
import { resolveTemporalBounds } from '$lib/server/memory/temporal-normalize';
import { processPendingGraphSyncJobs } from '$lib/server/graph/graph-sync-worker';

const DEFAULT_TIMEZONE = 'UTC';

/**
 * Extract temporal facts from a thought, persist to Postgres, enqueue AGE graph sync jobs.
 * Postgres is the ledger; graph sync runs post-commit via the outbox worker.
 */
export async function syncTemporalEventsFromThought(input: {
	userId: string;
	thoughtId: string;
	normalizedText: string;
	thoughtEmbedding?: number[];
	capturedAt?: Date;
	timezone?: string;
}): Promise<void> {
	const db = getDb();
	const capturedAt = input.capturedAt ?? new Date();
	const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;

	const mentions = await extractTemporalMentions({
		userId: input.userId,
		normalizedText: input.normalizedText,
		capturedAt,
		timezone
	});

	// Replace prior temporal rows: enqueue AGE graph deletes, then remove Postgres ledger rows.
	const existing = await db
		.select({ id: temporalEvent.id, graphNodeId: temporalEvent.graphNodeId })
		.from(temporalEvent)
		.where(eq(temporalEvent.thoughtId, input.thoughtId));

	if (existing.length > 0) {
		await db.transaction(async (tx) => {
			for (const row of existing) {
				if (row.graphNodeId) {
					await tx.insert(graphSyncJob).values({
						userId: input.userId,
						temporalEventId: row.id,
						operation: 'delete_temporal_event',
						payload: { temporalEventId: row.id }
					});
				}
			}
			await tx.delete(temporalEvent).where(eq(temporalEvent.thoughtId, input.thoughtId));
		});
		void processPendingGraphSyncJobs({ userId: input.userId }).catch((err) => {
			console.error('[temporal-graph-sync] delete graph sync failed', {
				thoughtId: input.thoughtId,
				message: err instanceof Error ? err.message : String(err)
			});
		});
	}

	if (mentions.length === 0) return;

	const embedding =
		input.thoughtEmbedding ?? (await createThoughtEmbedding(input.userId, input.normalizedText));

	const insertedJobIds: string[] = [];

	await db.transaction(async (tx) => {
		for (const mention of mentions) {
			const bounds = resolveTemporalBounds(mention);
			const lexicalText = computeLexicalText(
				`${mention.semanticSummary} ${mention.surface} ${mention.kind}`
			);

			const [row] = await tx
				.insert(temporalEvent)
				.values({
					userId: input.userId,
					thoughtId: input.thoughtId,
					kind: mention.kind,
					activePeriod: bounds.activePeriodLiteral,
					timePrecision: mention.timePrecision,
					timezone: mention.timezone,
					isAllDay: mention.isAllDay,
					recurrenceRule: mention.recurrenceRule ?? null,
					confidence: mention.confidence,
					semanticSummary: mention.semanticSummary,
					embedding,
					lexicalText,
					sourceTextSpan: mention.surface,
					parseMetadata: {
						startAt: mention.startAt,
						endAt: mention.endAt ?? null,
						capturedAt: capturedAt.toISOString()
					},
					startAt: bounds.start,
					endAt: bounds.end,
					graphSyncStatus: 'pending'
				})
				.returning({ id: temporalEvent.id });

			const payload = {
				temporalEventId: row.id,
				thoughtId: input.thoughtId,
				kind: mention.kind,
				semanticSummary: mention.semanticSummary,
				startAt: bounds.start.toISOString(),
				endAt: bounds.end.toISOString()
			};

			const [job] = await tx
				.insert(graphSyncJob)
				.values({
					userId: input.userId,
					temporalEventId: row.id,
					operation: 'upsert_temporal_event' satisfies GraphSyncJobOperation,
					payload
				})
				.returning({ id: graphSyncJob.id });

			insertedJobIds.push(job.id);
		}
	});

	// Immediate post-commit sync attempt (non-blocking for enrich overall).
	void processPendingGraphSyncJobs({
		userId: input.userId,
		jobIds: insertedJobIds
	}).catch((err) => {
		console.error('[temporal-graph-sync] post-commit graph sync failed', {
			thoughtId: input.thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
	});
}
