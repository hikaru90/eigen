import { afterEach, describe, expect, it, vi } from 'vitest';

const { getOrCreateUserScheduledTaskMock, hasActiveJobForUserMock } = vi.hoisted(() => ({
	getOrCreateUserScheduledTaskMock: vi.fn(),
	hasActiveJobForUserMock: vi.fn()
}));

vi.mock('$lib/server/job-queue', () => ({
	OVERNIGHT_CONSOLIDATION_JOB: 'overnight_consolidation',
	formatScheduleLabel: (hour: number, minute: number, tz: string) =>
		`Every day at ${hour}:${String(minute).padStart(2, '0')} (${tz})`,
	getOrCreateUserScheduledTask: getOrCreateUserScheduledTaskMock,
	setUserScheduledTaskPaused: vi.fn()
}));

vi.mock('$lib/server/job-queue/enqueue', () => ({
	hasActiveJobForUser: hasActiveJobForUserMock
}));

vi.mock('$lib/server/consolidation/heartbeat-run-ledger', () => ({
	loadActiveHeartbeatRun: vi.fn(async () => null),
	loadLastUserHeartbeatRun: vi.fn(async () => null),
	recoverOrphanedHeartbeatRun: vi.fn(async () => undefined),
	heartbeatProgressPct: vi.fn(() => 0),
	isHeartbeatRunActive: vi.fn(() => false)
}));

describe('listScheduledTasks', () => {
	afterEach(() => {
		vi.resetModules();
	});

	it('returns overnight task from Postgres schedule row', async () => {
		getOrCreateUserScheduledTaskMock.mockResolvedValue({
			userId: 'user-1',
			taskType: 'overnight_consolidation',
			runHour: 2,
			runMinute: 0,
			timezone: 'UTC',
			paused: false
		});
		hasActiveJobForUserMock.mockResolvedValue(false);

		const { listScheduledTasks } = await import('./service');
		const tasks = await listScheduledTasks('user-1');

		expect(tasks).toHaveLength(1);
		expect(tasks[0].title).toBe('Overnight memory heartbeat');
		expect(tasks[0].active).toBe(true);
		expect(tasks[0].configured).toBe(true);
		expect(tasks[0].scheduleLabel).toContain('2:00');
	});
});
