import { env as kitEnv } from '$env/dynamic/private';
import { createAdminSql } from '$lib/server/job-queue/admin-db';
import { loadJobQueueSnapshot } from '$lib/server/job-queue/snapshot';
import { loadPushHealthSnapshot } from '$lib/server/push/health';

export type PgCronJobRow = {
	jobName: string;
	schedule: string;
	active: boolean;
};

export type PgNetHttpRow = {
	id: number;
	statusCode: number | null;
	errorMsg: string | null;
	createdAt: string;
};

export type NotificationOpsSnapshot = {
	pushSubscriptionCount: number;
	pendingEventRemindersDue: number;
	pendingEventRemindersFuture: number;
	dailySummaryEnabledUsers: number;
};

export type OpsHealthSnapshot = {
	at: string;
	env: {
		adminConsolidationKeyConfigured: boolean;
		databaseAdminUrlConfigured: boolean;
		consolidationInternalUrl: string | null;
	};
	push: ReturnType<typeof loadPushHealthSnapshot>;
	jobQueue: Awaited<ReturnType<typeof loadJobQueueSnapshot>>;
	notifications: NotificationOpsSnapshot;
	pgCronJobs: PgCronJobRow[];
	recentPgNetHttp: PgNetHttpRow[];
};

type CountRow = { count: string };

async function loadNotificationOpsSnapshot(): Promise<NotificationOpsSnapshot> {
	const sql = createAdminSql(1);
	try {
		const [pushSubsRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count FROM push_subscription
		`;
		const [dueRemindersRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count
			FROM event_reminder_schedule
			WHERE status = 'pending' AND fire_at <= now()
		`;
		const [futureRemindersRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count
			FROM event_reminder_schedule
			WHERE status = 'pending' AND fire_at > now()
		`;
		const [dailySummaryRow] = await sql<CountRow[]>`
			SELECT count(*)::text AS count
			FROM user_preference
			WHERE daily_summary_enabled = true
		`;

		return {
			pushSubscriptionCount: Number(pushSubsRow?.count ?? 0),
			pendingEventRemindersDue: Number(dueRemindersRow?.count ?? 0),
			pendingEventRemindersFuture: Number(futureRemindersRow?.count ?? 0),
			dailySummaryEnabledUsers: Number(dailySummaryRow?.count ?? 0)
		};
	} finally {
		await sql.end();
	}
}

async function loadPgCronJobs(): Promise<PgCronJobRow[]> {
	const sql = createAdminSql(1);
	try {
		const rows = await sql<
			Array<{ jobname: string; schedule: string; active: boolean }>
		>`
			SELECT jobname, schedule, active
			FROM cron.job
			WHERE jobname LIKE 'eigen-%'
			ORDER BY jobname
		`;
		return rows.map((row) => ({
			jobName: row.jobname,
			schedule: row.schedule,
			active: row.active
		}));
	} catch (err) {
		console.warn('[ops-health] cron.job query failed', {
			message: err instanceof Error ? err.message : String(err)
		});
		return [];
	} finally {
		await sql.end();
	}
}

async function loadRecentPgNetHttp(): Promise<PgNetHttpRow[]> {
	const sql = createAdminSql(1);
	try {
		const rows = await sql<
			Array<{
				id: number;
				status_code: number | null;
				error_msg: string | null;
				created: Date;
			}>
		>`
			SELECT id, status_code, error_msg, created
			FROM net._http_response
			ORDER BY created DESC
			LIMIT 10
		`;
		return rows.map((row) => ({
			id: row.id,
			statusCode: row.status_code,
			errorMsg: row.error_msg,
			createdAt: row.created.toISOString()
		}));
	} catch (err) {
		console.warn('[ops-health] net._http_response query failed', {
			message: err instanceof Error ? err.message : String(err)
		});
		return [];
	} finally {
		await sql.end();
	}
}

export async function loadOpsHealthSnapshot(): Promise<OpsHealthSnapshot> {
	const [jobQueue, notifications, pgCronJobs, recentPgNetHttp] = await Promise.all([
		loadJobQueueSnapshot(),
		loadNotificationOpsSnapshot(),
		loadPgCronJobs(),
		loadRecentPgNetHttp()
	]);

	return {
		at: new Date().toISOString(),
		env: {
			adminConsolidationKeyConfigured: Boolean(kitEnv.ADMIN_CONSOLIDATION_KEY?.trim()),
			databaseAdminUrlConfigured: Boolean(kitEnv.DATABASE_ADMIN_URL?.trim()),
			consolidationInternalUrl: kitEnv.CONSOLIDATION_INTERNAL_URL?.trim() || null
		},
		push: loadPushHealthSnapshot(),
		jobQueue,
		notifications,
		pgCronJobs,
		recentPgNetHttp
	};
}
