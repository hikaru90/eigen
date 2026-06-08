import { describe, expect, it, vi } from 'vitest';

const { listTemporalEventsForUserMock, getUserPreferredTimezoneMock, getDbMock } = vi.hoisted(
	() => ({
		listTemporalEventsForUserMock: vi.fn(),
		getUserPreferredTimezoneMock: vi.fn(),
		getDbMock: vi.fn()
	})
);

vi.mock('$lib/server/memory/temporal-event-list', () => ({
	listTemporalEventsForUser: listTemporalEventsForUserMock
}));

vi.mock('$lib/server/memory/user-timezone', () => ({
	getUserPreferredTimezone: getUserPreferredTimezoneMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

import { planWeekForUser } from './plan-week';

describe('planWeekForUser', () => {
	it('returns suggestions without auto-applying', async () => {
		getUserPreferredTimezoneMock.mockResolvedValue('UTC');
		getDbMock.mockReturnValue({
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => [{ dailyWorkMinutes: 480 }]
					})
				})
			})
		});
		listTemporalEventsForUserMock.mockResolvedValue({
			items: [
				{
					id: 'e1',
					itemType: 'event',
					semanticSummary: 'Write spec',
					startAt: null,
					endAt: null,
					durationMinutes: 60,
					kind: 'deadline',
					lifecycleStatus: 'open',
					thoughtStatus: 'open'
				}
			]
		});

		const result = await planWeekForUser('u1');
		expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
		expect(result.summary).toContain('automatically');
	});
});
