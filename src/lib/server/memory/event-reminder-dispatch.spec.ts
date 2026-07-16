import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDueEventReminders } from './event-reminder-dispatch';

const {
	listDueMock,
	withDbUserMock,
	getDbMock,
	prefsMock,
	sendPushMock
} = vi.hoisted(() => ({
	listDueMock: vi.fn(),
	withDbUserMock: vi.fn(),
	getDbMock: vi.fn(),
	prefsMock: vi.fn(),
	sendPushMock: vi.fn()
}));

vi.mock('$lib/server/memory/notification-dispatch-admin', () => ({
	listDueEventReminders: listDueMock
}));

vi.mock('$lib/server/db', () => ({
	withDbUser: withDbUserMock,
	getDb: getDbMock
}));

vi.mock('$lib/server/memory/user-timezone', () => ({
	getUserEventNotificationPrefs: prefsMock
}));

vi.mock('$lib/server/push/send', () => ({
	sendPushToUser: sendPushMock
}));

function dueRow(overrides: Record<string, unknown> = {}) {
	const fireAt = new Date('2026-01-01T10:00:00.000Z');
	return {
		scheduleId: 's1',
		userId: 'u1',
		temporalEventId: 'te1',
		fireAt,
		leadMinutes: 30,
		kind: 'appointment',
		semanticSummary: 'Dentist',
		startAt: new Date('2026-01-01T10:30:00.000Z'),
		lifecycleStatus: 'open',
		...overrides
	};
}

describe('dispatchDueEventReminders', () => {
	const updateWhere = vi.fn(async () => undefined);
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const selectLimit = vi.fn(async () => [{ id: 'sub1' }]);
	const selectWhere = vi.fn(() => ({ limit: selectLimit }));
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const select = vi.fn(() => ({ from: selectFrom }));

	beforeEach(() => {
		vi.clearAllMocks();
		withDbUserMock.mockImplementation(async (_id: string, fn: () => Promise<void>) => {
			await fn();
		});
		getDbMock.mockReturnValue({ select, update });
		prefsMock.mockResolvedValue({ eventNotificationsEnabled: true });
		sendPushMock.mockResolvedValue({ sent: 1 });
		selectLimit.mockResolvedValue([{ id: 'sub1' }]);
		listDueMock.mockResolvedValue([]);
	});

	it('returns empty counts when nothing is due', async () => {
		await expect(dispatchDueEventReminders(new Date('2026-01-01T10:05:00.000Z'))).resolves.toEqual({
			processed: 0,
			sent: 0,
			skipped: 0,
			failed: 0
		});
	});

	it('skips non-open or already-started events', async () => {
		listDueMock.mockResolvedValue([
			dueRow({ lifecycleStatus: 'done' }),
			dueRow({ scheduleId: 's2', startAt: new Date('2026-01-01T09:00:00.000Z') })
		]);
		const result = await dispatchDueEventReminders(new Date('2026-01-01T10:05:00.000Z'));
		expect(result.skipped).toBe(2);
		expect(update).toHaveBeenCalled();
	});

	it('skips when catch-up window exceeded', async () => {
		listDueMock.mockResolvedValue([
			dueRow({ fireAt: new Date('2025-12-01T10:00:00.000Z') })
		]);
		const result = await dispatchDueEventReminders(new Date('2026-01-01T10:05:00.000Z'));
		expect(result.skipped).toBe(1);
	});

	it('skips when notifications disabled or no push devices', async () => {
		prefsMock.mockResolvedValue({ eventNotificationsEnabled: false });
		listDueMock.mockResolvedValue([dueRow()]);
		let result = await dispatchDueEventReminders(new Date('2026-01-01T10:05:00.000Z'));
		expect(result.skipped).toBe(1);

		prefsMock.mockResolvedValue({ eventNotificationsEnabled: true });
		selectLimit.mockResolvedValue([]);
		listDueMock.mockResolvedValue([dueRow({ scheduleId: 's2' })]);
		result = await dispatchDueEventReminders(new Date('2026-01-01T10:05:00.000Z'));
		expect(result.skipped).toBe(1);
	});

	it('sends push and marks schedule sent', async () => {
		listDueMock.mockResolvedValue([dueRow()]);
		const result = await dispatchDueEventReminders(new Date('2026-01-01T10:05:00.000Z'));
		expect(result.sent).toBe(1);
		expect(sendPushMock).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({
				title: 'Appointment',
				body: 'In 30 min · Dentist'
			})
		);
	});

	it('marks failed when push throws', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		sendPushMock.mockRejectedValue(new Error('push down'));
		listDueMock.mockResolvedValue([dueRow()]);
		const result = await dispatchDueEventReminders(new Date('2026-01-01T10:05:00.000Z'));
		expect(result.failed).toBe(1);
		errSpy.mockRestore();
	});
});
