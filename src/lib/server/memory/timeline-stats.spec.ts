import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeTimelineStatsForUser } from './timeline-stats';

const { getDbMock, listTemporalEventsForUserMock, getUserPreferredTimezoneMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	listTemporalEventsForUserMock: vi.fn(),
	getUserPreferredTimezoneMock: vi.fn(async () => 'UTC')
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/memory/temporal-event-list', () => ({
	listTemporalEventsForUser: listTemporalEventsForUserMock
}));

vi.mock('$lib/server/memory/user-timezone', () => ({
	getUserPreferredTimezone: getUserPreferredTimezoneMock
}));

function makeAwaitableChain(rows: unknown[]) {
	const chain = {
		from: vi.fn(() => chain),
		where: vi.fn(() => chain),
		limit: vi.fn(async () => rows),
		then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
			return Promise.resolve(rows).then(onFulfilled, onRejected);
		}
	};
	return chain;
}

describe('computeTimelineStatsForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('includes prior-day overdueCount from open overdue items', async () => {
		const now = Date.now();
		const priorDayOverdue = {
			id: '1',
			itemType: 'event',
			lifecycleStatus: 'open',
			thoughtStatus: 'open',
			timezone: 'UTC',
			endAt: new Date(now - 60_000).toISOString(),
			startAt: new Date(now - 26 * 60 * 60 * 1000).toISOString()
		};
		const openLoop = {
			id: '2',
			itemType: 'open_loop',
			lifecycleStatus: 'open',
			thoughtStatus: 'open',
			startAt: null,
			endAt: null
		};

		getDbMock.mockReturnValue({
			select: vi
				.fn()
				.mockReturnValueOnce(makeAwaitableChain([]))
				.mockReturnValueOnce(makeAwaitableChain([]))
		});

		listTemporalEventsForUserMock
			.mockResolvedValueOnce({
				items: [priorDayOverdue, openLoop]
			})
			.mockResolvedValueOnce({ items: [] });

		const stats = await computeTimelineStatsForUser('u1');
		expect(stats.overdueCount).toBe(1);
	});
});
