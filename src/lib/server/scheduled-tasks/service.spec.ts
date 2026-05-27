import { afterEach, describe, expect, it, vi } from 'vitest';

const { postgresMock } = vi.hoisted(() => ({
	postgresMock: vi.fn()
}));

vi.mock('postgres', () => ({
	default: postgresMock
}));

describe('listScheduledTasks', () => {
	const prevAdmin = process.env.DATABASE_ADMIN_URL;
	const prevSchedule = process.env.CONSOLIDATION_CRON_SCHEDULE;
	const prevTz = process.env.CONSOLIDATION_CRON_TZ;

	afterEach(() => {
		if (prevAdmin === undefined) delete process.env.DATABASE_ADMIN_URL;
		else process.env.DATABASE_ADMIN_URL = prevAdmin;
		if (prevSchedule === undefined) delete process.env.CONSOLIDATION_CRON_SCHEDULE;
		else process.env.CONSOLIDATION_CRON_SCHEDULE = prevSchedule;
		if (prevTz === undefined) delete process.env.CONSOLIDATION_CRON_TZ;
		else process.env.CONSOLIDATION_CRON_TZ = prevTz;
		vi.resetModules();
	});

	it('returns overnight task with friendly labels when pg_cron job exists', async () => {
		process.env.DATABASE_ADMIN_URL = 'postgres://localhost/test';
		process.env.CONSOLIDATION_CRON_SCHEDULE = '0 2 * * *';
		process.env.CONSOLIDATION_CRON_TZ = 'UTC';

		const end = vi.fn();
		const sql = Object.assign(
			vi.fn(async (strings: TemplateStringsArray) => {
				const q = strings.join('');
				if (q.includes('cron.job')) {
					return [{ jobid: 1, jobname: 'eigen-sleep-consolidation', schedule: '0 2 * * *', active: true }];
				}
				return [];
			}),
			{ end }
		);
		postgresMock.mockReturnValue(sql);

		const { listScheduledTasks } = await import('./service');
		const tasks = await listScheduledTasks('user-1');

		expect(tasks).toHaveLength(1);
		expect(tasks[0].title).toBe('Overnight memory heartbeat');
		expect(tasks[0].active).toBe(true);
		expect(tasks[0].scheduleLabel).toContain('2:00 AM');
	});
});
