import { createAdminSql } from '$lib/server/job-queue/admin-db';

export type DailySummaryCandidateRow = {
	userId: string;
	dailySummaryMinutesLocal: number;
	lastDailySummaryLocalDate: string | null;
};

export type DueEventReminderRow = {
	scheduleId: string;
	userId: string;
	temporalEventId: string;
	fireAt: Date;
	leadMinutes: number;
	kind: string;
	semanticSummary: string;
	startAt: Date | null;
	lifecycleStatus: string;
};

export async function listDailySummaryCandidates(): Promise<DailySummaryCandidateRow[]> {
	const sql = createAdminSql(1);
	try {
		const rows = await sql<
			Array<{
				user_id: string;
				daily_summary_minutes_local: number;
				last_daily_summary_local_date: string | null;
			}>
		>`
			SELECT
				user_id,
				daily_summary_minutes_local,
				last_daily_summary_local_date
			FROM user_preference
			WHERE daily_summary_enabled = true
		`;
		return rows.map((row) => ({
			userId: row.user_id,
			dailySummaryMinutesLocal: row.daily_summary_minutes_local,
			lastDailySummaryLocalDate: row.last_daily_summary_local_date
		}));
	} finally {
		await sql.end();
	}
}

export async function listDueEventReminders(now: Date): Promise<DueEventReminderRow[]> {
	const sql = createAdminSql(1);
	try {
		const rows = await sql<
			Array<{
				schedule_id: string;
				user_id: string;
				temporal_event_id: string;
				fire_at: Date;
				lead_minutes: number;
				kind: string;
				semantic_summary: string;
				start_at: Date | null;
				lifecycle_status: string;
			}>
		>`
			SELECT
				ers.id AS schedule_id,
				ers.user_id,
				ers.temporal_event_id,
				ers.fire_at,
				ers.lead_minutes,
				te.kind,
				te.semantic_summary,
				te.start_at,
				te.lifecycle_status
			FROM event_reminder_schedule ers
			INNER JOIN temporal_event te ON te.id = ers.temporal_event_id
			WHERE ers.status = 'pending'
				AND ers.fire_at <= ${now}
			ORDER BY ers.fire_at ASC
			LIMIT 200
		`;
		return rows.map((row) => ({
			scheduleId: row.schedule_id,
			userId: row.user_id,
			temporalEventId: row.temporal_event_id,
			fireAt: row.fire_at,
			leadMinutes: row.lead_minutes,
			kind: row.kind,
			semanticSummary: row.semantic_summary,
			startAt: row.start_at,
			lifecycleStatus: row.lifecycle_status
		}));
	} finally {
		await sql.end();
	}
}
