import { eq } from 'drizzle-orm';
import { refreshFocusRanksForUser } from '$lib/server/memory/temporal-event-list';
import { getDb } from '$lib/server/db';
import {
	graphSyncJob,
	temporalEvent,
	type GraphSyncJobOperation
} from '$lib/server/db/schema';
import { createThoughtEmbedding } from '$lib/server/llm/embedding';
import { computeLexicalText } from '$lib/server/memory/lexical-text';
import { extractTemporalMentions } from '$lib/server/memory/temporal-extraction';
import {
	applyCaptureAnchoredMentions,
	resolveTemporalBounds,
	type ExtractedTemporalMention
} from '$lib/server/memory/temporal-normalize';
import { processPendingGraphSyncJobs } from '$lib/server/graph/graph-sync-worker';
import { syncReminderScheduleForEvent } from '$lib/server/memory/event-reminder-schedule';

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
	/** Pre-fetched LLM extraction (batch ingest). Skips extractTemporalMentions when set. */
	precomputedMentions?: ExtractedTemporalMention[];
}): Promise<void> {
	const db = getDb();
	const capturedAt = input.capturedAt ?? new Date();
	const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;

	const mentions = applyCaptureAnchoredMentions(
		input.precomputedMentions ??
			(await extractTemporalMentions({
				userId: input.userId,
				normalizedText: input.normalizedText,
				capturedAt,
				timezone
			})),
		capturedAt
	);

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
	const insertedBySurface = new Map<string, string>();

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
					durationMinutes: mention.durationMinutes ?? null,
					energyLevel: mention.energyLevel ?? null,
					priorityQuadrant: mention.priorityQuadrant ?? null,
					contextTags: mention.contextTags ?? null,
					confidence: mention.confidence,
					semanticSummary: mention.semanticSummary,
					embedding,
					lexicalText,
					sourceTextSpan: mention.surface,
					parseMetadata: {
						startAt: mention.startAt,
						endAt: mention.endAt ?? null,
						capturedAt: capturedAt.toISOString(),
						...(mention.contextTags ? { contextTags: mention.contextTags } : {})
					},
					startAt: bounds.start,
					endAt: bounds.end,
					graphSyncStatus: 'pending'
				})
				.returning({ id: temporalEvent.id });

			insertedBySurface.set(mention.surface, row.id);

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

			void syncReminderScheduleForEvent({
				userId: input.userId,
				temporalEventId: row.id,
				kind: mention.kind,
				startAt: bounds.start,
				lifecycleStatus: 'open'
			}).catch((err) => {
				console.error('[temporal-graph-sync] reminder schedule failed', {
					temporalEventId: row.id,
					message: err instanceof Error ? err.message : String(err)
				});
			});
		}

		for (const mention of mentions) {
			if (!mention.parentSurface) continue;
			const childId = insertedBySurface.get(mention.surface);
			const parentId = insertedBySurface.get(mention.parentSurface);
			if (!childId || !parentId) continue;
			await tx
				.update(temporalEvent)
				.set({ parentEventId: parentId })
				.where(eq(temporalEvent.id, childId));
		}
	});

	void refreshFocusRanksForUser(input.userId, timezone).catch((err) => {
		console.error('[temporal-graph-sync] focus rank refresh failed', {
			thoughtId: input.thoughtId,
			message: err instanceof Error ? err.message : String(err)
		});
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
