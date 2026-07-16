import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDueDailySummaries } from './daily-summary-dispatch';

const {
	listCandidatesMock,
	withDbUserMock,
	getDbMock,
	tzMock,
	evaluateMock,
	previewMock,
	sendPushMock,
	localDayKeyMock
} = vi.hoisted(() => ({
	listCandidatesMock: vi.fn(),
	withDbUserMock: vi.fn(),
	getDbMock: vi.fn(),
	tzMock: vi.fn(),
	evaluateMock: vi.fn(),
	previewMock: vi.fn(),
	sendPushMock: vi.fn(),
	localDayKeyMock: vi.fn(() => '2026-01-01')
}));

vi.mock('$lib/server/memory/notification-dispatch-admin', () => ({
	listDailySummaryCandidates: listCandidatesMock
}));

vi.mock('$lib/server/db', () => ({
	withDbUser: withDbUserMock,
	getDb: getDbMock
}));

vi.mock('$lib/server/memory/user-timezone', () => ({
	getUserPreferredTimezone: tzMock
}));

vi.mock('$lib/server/memory/daily-summary-visibility', () => ({
	evaluateDailySummaryDispatch: evaluateMock,
	buildDailySummaryPreviewForUser: previewMock
}));

vi.mock('$lib/server/memory/timeline-today-server', () => ({
	localDayKey: localDayKeyMock
}));

vi.mock('$lib/server/push/send', () => ({
	sendPushToUser: sendPushMock
}));

describe('dispatchDueDailySummaries', () => {
	const updateWhere = vi.fn(async () => undefined);
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));

	beforeEach(() => {
		vi.clearAllMocks();
		withDbUserMock.mockImplementation(async (_id: string, fn: () => Promise<void>) => {
			await fn();
		});
		tzMock.mockResolvedValue('UTC');
		localDayKeyMock.mockReturnValue('2026-01-01');
		previewMock.mockResolvedValue({
			title: 'Daily',
			body: 'Summary',
			url: '/memory/timeline'
		});
		sendPushMock.mockResolvedValue({ sent: 1 });
		evaluateMock.mockReturnValue({ wouldDispatch: true });

		let selectCall = 0;
		const select = vi.fn(() => {
			selectCall += 1;
			if (selectCall === 1) {
				const limit = vi.fn(async () => [
					{
						dailySummaryMinutesLocal: 480,
						lastDailySummaryLocalDate: null,
						lastDailySummaryDispatchError: null
					}
				]);
				const where = vi.fn(() => ({ limit }));
				const from = vi.fn(() => ({ where }));
				return { from };
			}
			const where = vi.fn(async () => [{ id: 'sub1' }]);
			const from = vi.fn(() => ({ where }));
			return { from };
		});
		getDbMock.mockReturnValue({ select, update });
		listCandidatesMock.mockResolvedValue([]);
	});

	it('returns zeros when no candidates', async () => {
		await expect(dispatchDueDailySummaries()).resolves.toEqual({
			processed: 0,
			sent: 0,
			skipped: 0,
			failed: 0
		});
	});

	it('skips when evaluation says not to dispatch', async () => {
		listCandidatesMock.mockResolvedValue([
			{
				userId: 'u1',
				dailySummaryMinutesLocal: 480,
				lastDailySummaryLocalDate: null,
				lastDailySummaryDispatchError: null
			}
		]);
		evaluateMock.mockReturnValue({ wouldDispatch: false });
		const result = await dispatchDueDailySummaries(new Date('2026-01-01T08:00:00.000Z'));
		expect(result).toEqual({ processed: 1, sent: 0, skipped: 1, failed: 0 });
	});

	it('sends push and updates preference on success', async () => {
		listCandidatesMock.mockResolvedValue([
			{
				userId: 'u1',
				dailySummaryMinutesLocal: 480,
				lastDailySummaryLocalDate: null,
				lastDailySummaryDispatchError: null
			}
		]);
		const result = await dispatchDueDailySummaries(new Date('2026-01-01T08:00:00.000Z'));
		expect(result.sent).toBe(1);
		expect(sendPushMock).toHaveBeenCalled();
		expect(update).toHaveBeenCalled();
	});

	it('marks failed when no device accepts push', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listCandidatesMock.mockResolvedValue([
			{
				userId: 'u1',
				dailySummaryMinutesLocal: 480,
				lastDailySummaryLocalDate: null,
				lastDailySummaryDispatchError: null
			}
		]);
		sendPushMock.mockResolvedValue({ sent: 0 });
		const result = await dispatchDueDailySummaries(new Date('2026-01-01T08:00:00.000Z'));
		expect(result.failed).toBe(1);
		errSpy.mockRestore();
	});
});
