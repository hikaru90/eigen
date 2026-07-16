import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDailySummaryCandidates, listDueEventReminders } from './notification-dispatch-admin';

const { createAdminSqlMock } = vi.hoisted(() => ({
	createAdminSqlMock: vi.fn()
}));

vi.mock('$lib/server/job-queue/admin-db', () => ({
	createAdminSql: createAdminSqlMock
}));

describe('notification-dispatch-admin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('maps daily summary preference rows', async () => {
		const end = vi.fn(async () => undefined);
		const sql = Object.assign(
			vi.fn(async () => [
				{
					user_id: 'u1',
					daily_summary_minutes_local: 480,
					last_daily_summary_local_date: '2026-01-01',
					last_daily_summary_dispatch_error: null
				}
			]),
			{ end }
		);
		createAdminSqlMock.mockReturnValue(sql);

		await expect(listDailySummaryCandidates()).resolves.toEqual([
			{
				userId: 'u1',
				dailySummaryMinutesLocal: 480,
				lastDailySummaryLocalDate: '2026-01-01',
				lastDailySummaryDispatchError: null
			}
		]);
		expect(end).toHaveBeenCalled();
	});

	it('maps due event reminder rows', async () => {
		const fireAt = new Date('2026-01-01T09:00:00.000Z');
		const end = vi.fn(async () => undefined);
		const sql = Object.assign(
			vi.fn(async () => [
				{
					schedule_id: 's1',
					user_id: 'u1',
					temporal_event_id: 'te1',
					fire_at: fireAt,
					lead_minutes: 30,
					kind: 'event',
					semantic_summary: 'Meet',
					start_at: fireAt,
					lifecycle_status: 'open'
				}
			]),
			{ end }
		);
		createAdminSqlMock.mockReturnValue(sql);

		await expect(listDueEventReminders(new Date('2026-01-01T10:00:00.000Z'))).resolves.toEqual([
			{
				scheduleId: 's1',
				userId: 'u1',
				temporalEventId: 'te1',
				fireAt,
				leadMinutes: 30,
				kind: 'event',
				semanticSummary: 'Meet',
				startAt: fireAt,
				lifecycleStatus: 'open'
			}
		]);
		expect(end).toHaveBeenCalled();
	});
});
