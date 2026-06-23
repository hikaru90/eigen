import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { userJobQueue, type UserJobQueue, type UserJobType } from '$lib/server/db/schema';

type RawUserJobQueueRow = {
	id: string;
	user_id: string;
	job_type: string;
	status: string;
	payload: Record<string, unknown> | null;
	run_after: Date;
	dedupe_key: string | null;
	attempt_count: number;
	max_attempts: number;
	last_error: string | null;
	heartbeat_run_id: string | null;
	created_at: Date;
	updated_at: Date;
	started_at: Date | null;
	finished_at: Date | null;
};

function mapJobRow(row: RawUserJobQueueRow): UserJobQueue {
	return {
		id: row.id,
		userId: row.user_id,
		jobType: row.job_type as UserJobQueue['jobType'],
		status: row.status as UserJobQueue['status'],
		payload: row.payload ?? {},
		runAfter: row.run_after,
		dedupeKey: row.dedupe_key,
		attemptCount: row.attempt_count,
		maxAttempts: row.max_attempts,
		lastError: row.last_error,
		heartbeatRunId: row.heartbeat_run_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at
	};
}
import { JOB_QUEUE_BATCH_LIMIT, OVERNIGHT_CONSOLIDATION_JOB, WEBHOOK_DELIVERY_JOB } from './constants';
import { createAdminSql } from './admin-db';
import { processOvernightConsolidationJob } from './process-overnight';
import {
	WebhookDeliveryError,
	processWebhookDeliveryJob,
	markWebhookDeliveryFailed,
	disableConnectedAgent,
	loadWebhookDeliveryAgentId
} from '$lib/server/agents/deliver';

type ClaimedJob = UserJobQueue;

async function claimDueJobs(input: {
	limit: number;
	userId?: string;
}): Promise<ClaimedJob[]> {
	const sql = createAdminSql(1);
	try {
		return sql.begin(async (tx) => {
			const rawRows = input.userId
				? await tx<RawUserJobQueueRow[]>`
					SELECT *
					FROM user_job_queue
					WHERE status = 'pending'
						AND run_after <= now()
						AND user_id = ${input.userId}
					ORDER BY run_after
					LIMIT ${input.limit}
					FOR UPDATE SKIP LOCKED
				`
				: await tx<RawUserJobQueueRow[]>`
					SELECT *
					FROM user_job_queue
					WHERE status = 'pending'
						AND run_after <= now()
					ORDER BY run_after
					LIMIT ${input.limit}
					FOR UPDATE SKIP LOCKED
				`;

			const rows = rawRows.map(mapJobRow);

			for (const row of rows) {
				await tx`
					UPDATE user_job_queue
					SET status = 'running',
						started_at = now(),
						attempt_count = attempt_count + 1,
						updated_at = now()
					WHERE id = ${row.id}
				`;
			}

			return rows.map((row) => ({
				...row,
				status: 'running' as const,
				attemptCount: row.attemptCount + 1
			}));
		});
	} finally {
		await sql.end();
	}
}

async function finishJob(
	jobId: string,
	status: 'completed' | 'failed' | 'cancelled',
	lastError?: string | null
): Promise<void> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { userJobQueue } });
		await db
			.update(userJobQueue)
			.set({
				status,
				lastError: lastError ?? null,
				finishedAt: new Date()
			})
			.where(eq(userJobQueue.id, jobId));
	} finally {
		await sql.end();
	}
}

async function requeueJob(job: ClaimedJob, lastError: string): Promise<void> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { userJobQueue } });
		const terminal = job.attemptCount >= job.maxAttempts;
		const backoffMs = Math.min(300_000, 1000 * 2 ** Math.max(0, job.attemptCount - 1));
		const runAfter = terminal ? job.runAfter : new Date(Date.now() + backoffMs);
		await db
			.update(userJobQueue)
			.set({
				status: terminal ? 'failed' : 'pending',
				lastError,
				runAfter,
				finishedAt: terminal ? new Date() : null,
				startedAt: terminal ? job.startedAt : null
			})
			.where(eq(userJobQueue.id, job.id));
	} finally {
		await sql.end();
	}
}

async function dispatchJob(job: ClaimedJob): Promise<void> {
	switch (job.jobType as UserJobType) {
		case OVERNIGHT_CONSOLIDATION_JOB:
			await processOvernightConsolidationJob(job);
			return;
		case WEBHOOK_DELIVERY_JOB:
			await processWebhookDeliveryJob(job);
			return;
		default:
			throw new Error(`Unknown job type: ${job.jobType}`);
	}
}

export type DrainUserJobQueueResult = {
	claimed: number;
	completed: number;
	failed: number;
};

export async function drainUserJobQueue(input?: {
	userId?: string;
	limit?: number;
}): Promise<DrainUserJobQueueResult> {
	const limit = input?.limit ?? JOB_QUEUE_BATCH_LIMIT;
	const jobs = await claimDueJobs({ limit, userId: input?.userId });

	let completed = 0;
	let failed = 0;

	for (const job of jobs) {
		try {
			await dispatchJob(job);
			await finishJob(job.id, 'completed');
			completed += 1;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[job-queue] job failed', {
				jobId: job.id,
				userId: job.userId,
				jobType: job.jobType,
				message
			});

			if (job.jobType === WEBHOOK_DELIVERY_JOB) {
				const deliveryId =
					typeof job.payload.deliveryId === 'string' ? job.payload.deliveryId : '';
				const terminal = job.attemptCount >= job.maxAttempts;
				if (deliveryId) {
					await markWebhookDeliveryFailed({
						deliveryId,
						attemptCount: job.attemptCount,
						httpStatus: err instanceof WebhookDeliveryError ? err.options?.httpStatus : undefined,
						lastError: message,
						terminal
					});
				}
				if (err instanceof WebhookDeliveryError && err.options?.permanent && deliveryId) {
					const ctx = await loadWebhookDeliveryAgentId(deliveryId);
					if (ctx) {
						await disableConnectedAgent(ctx.agentId);
					}
				}
			}

			await requeueJob(job, message);
			if (job.attemptCount >= job.maxAttempts) {
				failed += 1;
			}
		}
	}

	return { claimed: jobs.length, completed, failed };
}
