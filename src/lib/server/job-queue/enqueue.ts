import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { user, userJobQueue, type UserJobType } from '$lib/server/db/schema';
import { createAdminSql } from './admin-db';

export type EnqueueUserJobInput = {
	userId: string;
	jobType: UserJobType;
	runAfter: Date;
	dedupeKey?: string | null;
	payload?: Record<string, unknown>;
	maxAttempts?: number;
};

export type EnqueueUserJobResult =
	| { enqueued: true; jobId: string }
	| { enqueued: false; reason: 'duplicate' };

export async function enqueueUserJob(input: EnqueueUserJobInput): Promise<EnqueueUserJobResult> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { userJobQueue } });

		if (input.dedupeKey) {
			const existing = await db
				.select({ id: userJobQueue.id })
				.from(userJobQueue)
				.where(
					and(
						eq(userJobQueue.userId, input.userId),
						eq(userJobQueue.dedupeKey, input.dedupeKey),
						inArray(userJobQueue.status, ['pending', 'running'])
					)
				)
				.limit(1);
			if (existing.length > 0) {
				return { enqueued: false, reason: 'duplicate' };
			}
		}

		const [row] = await db
			.insert(userJobQueue)
			.values({
				userId: input.userId,
				jobType: input.jobType,
				status: 'pending',
				runAfter: input.runAfter,
				dedupeKey: input.dedupeKey ?? null,
				payload: input.payload ?? {},
				maxAttempts: input.maxAttempts ?? 3
			})
			.returning({ id: userJobQueue.id });

		if (!row) {
			throw new Error('Failed to enqueue user job');
		}
		return { enqueued: true, jobId: row.id };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('user_job_queue_active_dedupe_uidx') || message.includes('duplicate key')) {
			return { enqueued: false, reason: 'duplicate' };
		}
		throw err;
	} finally {
		await sql.end();
	}
}

export async function listAllUserIds(): Promise<string[]> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { user } });
		const rows = await db.select({ id: user.id }).from(user);
		return rows.map((r) => r.id);
	} finally {
		await sql.end();
	}
}

export function hasActiveJobForUser(
	userId: string,
	jobType: UserJobType
): Promise<boolean> {
	const sql = createAdminSql(1);
	return (async () => {
		try {
			const db = drizzle(sql, { schema: { userJobQueue } });
			const rows = await db
				.select({ id: userJobQueue.id })
				.from(userJobQueue)
				.where(
					and(
						eq(userJobQueue.userId, userId),
						eq(userJobQueue.jobType, jobType),
						inArray(userJobQueue.status, ['pending', 'running'])
					)
				)
				.limit(1);
			return rows.length > 0;
		} finally {
			await sql.end();
		}
	})();
}
