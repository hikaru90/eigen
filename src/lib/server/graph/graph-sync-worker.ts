import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	entityResolutionLog,
	graphSyncJob,
	temporalEvent,
	type GraphSyncJobOperation
} from '$lib/server/db/schema';
import {
	deleteEventNodeFromGraph,
	upsertEventInvolvesEntityEdge,
	upsertEventNode,
	upsertThoughtOccurrenceEdge
} from '$lib/server/graph/falkor';
import { INGEST_MAX_RETRIES, runIngestWithRetries } from '$lib/server/ingest/retry';

const MAX_JOB_ATTEMPTS = 1 + INGEST_MAX_RETRIES;

async function executeUpsertTemporalEvent(input: {
	userId: string;
	temporalEventId: string;
	thoughtId: string;
	kind: string;
	semanticSummary: string;
	startAt: string;
	endAt: string;
}): Promise<void> {
	const entityRows = await getDb()
		.select({ canonicalEntityId: entityResolutionLog.canonicalEntityId })
		.from(entityResolutionLog)
		.where(
			and(
				eq(entityResolutionLog.userId, input.userId),
				eq(entityResolutionLog.thoughtId, input.thoughtId)
			)
		);

	const entityIds = [
		...new Set(
			entityRows
				.map((r) => r.canonicalEntityId)
				.filter((id): id is string => typeof id === 'string' && id.length > 0)
		)
	];

	await runIngestWithRetries(async () => {
		await upsertEventNode({
			id: input.temporalEventId,
			userId: input.userId,
			kind: input.kind,
			label: input.semanticSummary,
			startAt: input.startAt,
			endAt: input.endAt
		});

		await upsertThoughtOccurrenceEdge({
			userId: input.userId,
			thoughtId: input.thoughtId,
			eventId: input.temporalEventId
		});

		for (const entityId of entityIds) {
			await upsertEventInvolvesEntityEdge({
				userId: input.userId,
				eventId: input.temporalEventId,
				entityId
			});
		}
	});
}

async function executeDeleteTemporalEvent(input: {
	userId: string;
	temporalEventId: string;
}): Promise<void> {
	await runIngestWithRetries(async () => {
		await deleteEventNodeFromGraph({
			userId: input.userId,
			eventId: input.temporalEventId
		});
	});
}

async function processJob(job: {
	id: string;
	userId: string;
	temporalEventId: string | null;
	operation: GraphSyncJobOperation;
	payload: Record<string, unknown>;
	attemptCount: number;
}): Promise<void> {
	const db = getDb();

	await db
		.update(graphSyncJob)
		.set({ status: 'processing', attemptCount: job.attemptCount + 1 })
		.where(eq(graphSyncJob.id, job.id));

	try {
		if (job.operation === 'upsert_temporal_event') {
			const temporalEventId =
				typeof job.payload.temporalEventId === 'string'
					? job.payload.temporalEventId
					: job.temporalEventId;
			const thoughtId = typeof job.payload.thoughtId === 'string' ? job.payload.thoughtId : '';
			const kind = typeof job.payload.kind === 'string' ? job.payload.kind : 'inferred_event';
			const semanticSummary =
				typeof job.payload.semanticSummary === 'string' ? job.payload.semanticSummary : '';
			const startAt = typeof job.payload.startAt === 'string' ? job.payload.startAt : '';
			const endAt = typeof job.payload.endAt === 'string' ? job.payload.endAt : '';

			if (!temporalEventId || !thoughtId || !semanticSummary || !startAt || !endAt) {
				throw new Error('upsert_temporal_event job payload is incomplete');
			}

			await executeUpsertTemporalEvent({
				userId: job.userId,
				temporalEventId,
				thoughtId,
				kind,
				semanticSummary,
				startAt,
				endAt
			});

			await db
				.update(temporalEvent)
				.set({
					falkordbNodeId: temporalEventId,
					graphSyncStatus: 'synced',
					graphSyncError: null
				})
				.where(eq(temporalEvent.id, temporalEventId));
		} else if (job.operation === 'delete_temporal_event') {
			const temporalEventId =
				typeof job.payload.temporalEventId === 'string'
					? job.payload.temporalEventId
					: job.temporalEventId;
			if (!temporalEventId) {
				throw new Error('delete_temporal_event job missing temporalEventId');
			}
			await executeDeleteTemporalEvent({ userId: job.userId, temporalEventId });
		} else {
			throw new Error(`Unknown graph sync operation: ${job.operation}`);
		}

		await db
			.update(graphSyncJob)
			.set({ status: 'completed', completedAt: new Date(), lastError: null })
			.where(eq(graphSyncJob.id, job.id));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const terminal = job.attemptCount + 1 >= MAX_JOB_ATTEMPTS;

		await db
			.update(graphSyncJob)
			.set({
				status: terminal ? 'failed' : 'pending',
				lastError: message
			})
			.where(eq(graphSyncJob.id, job.id));

		if (job.temporalEventId && terminal) {
			await db
				.update(temporalEvent)
				.set({ graphSyncStatus: 'failed', graphSyncError: message })
				.where(eq(temporalEvent.id, job.temporalEventId));
		}

		if (!terminal) throw err;
	}
}

/**
 * Process pending graph sync jobs (outbox worker). Retries up to INGEST_MAX_RETRIES per job.
 */
export async function processPendingGraphSyncJobs(input: {
	userId: string;
	jobIds?: string[];
	limit?: number;
}): Promise<{ processed: number; failed: number }> {
	const db = getDb();
	const limit = input.limit ?? 20;

	const conditions = [
		eq(graphSyncJob.userId, input.userId),
		eq(graphSyncJob.status, 'pending'),
		sql`${graphSyncJob.attemptCount} < ${MAX_JOB_ATTEMPTS}`
	];

	if (input.jobIds && input.jobIds.length > 0) {
		conditions.push(inArray(graphSyncJob.id, input.jobIds));
	}

	const jobs = await db
		.select()
		.from(graphSyncJob)
		.where(and(...conditions))
		.orderBy(graphSyncJob.createdAt)
		.limit(limit);

	let processed = 0;
	let failed = 0;

	for (const job of jobs) {
		try {
			await processJob({
				id: job.id,
				userId: job.userId,
				temporalEventId: job.temporalEventId,
				operation: job.operation,
				payload: (job.payload as Record<string, unknown>) ?? {},
				attemptCount: job.attemptCount
			});
			processed += 1;
		} catch {
			failed += 1;
		}
	}

	return { processed, failed };
}
