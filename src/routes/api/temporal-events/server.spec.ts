import { describe, expect, it, vi } from 'vitest';

const { listTemporalEventsForUserMock } = vi.hoisted(() => ({
	listTemporalEventsForUserMock: vi.fn()
}));

vi.mock('$lib/server/memory/temporal-event-list', () => ({
	listTemporalEventsForUser: listTemporalEventsForUserMock
}));

import { GET } from './+server';

function mockEvent(user: { id: string } | null, search = '') {
	return {
		locals: { user },
		url: new URL(`http://localhost/api/temporal-events${search}`)
	} as Parameters<typeof GET>[0];
}

describe('GET /api/temporal-events', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(GET(mockEvent(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns temporal events for the user', async () => {
		listTemporalEventsForUserMock.mockResolvedValueOnce({
			items: [
				{
					id: 'ev-1',
					kind: 'appointment',
					semanticSummary: 'Inline skating next Wednesday',
					sourceTextSpan: 'nächsten mittwoch',
					timePrecision: 'day',
					timezone: 'UTC',
					isAllDay: true,
					confidence: 0.9,
					startAt: '2026-05-20T00:00:00.000Z',
					endAt: '2026-05-21T00:00:00.000Z',
					activePeriod: '[2026-05-20,2026-05-21)',
					graphSyncStatus: 'synced',
					graphSyncError: null,
					lifecycleStatus: 'open',
					snoozedUntil: null,
					itemType: 'event',
					recurrenceRule: null,
					durationMinutes: null,
					energyLevel: null,
					priorityQuadrant: null,
					contextTags: [],
					focusRank: null,
					parentEventId: null,
					memoryType: null,
					thoughtId: 't-1',
					thoughtText: 'ich will nächsten mittwoch inline-skaten gehen',
					thoughtCategory: 'task',
					thoughtStatus: 'open',
					createdAt: '2026-05-19T11:15:08.867Z'
				}
			],
			nextCursor: null
		});

		const res = await GET(mockEvent({ id: 'u1' }, '?range=relevant&status=open'));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{
				id: string;
				thoughtText: string;
				thoughtCategory: string;
				thoughtStatus: string;
				lifecycleStatus: string;
			}>;
		};
		expect(body.items).toHaveLength(1);
		expect(body.items[0]?.id).toBe('ev-1');
		expect(body.items[0]?.thoughtText).toContain('inline-skaten');
		expect(body.items[0]?.lifecycleStatus).toBe('open');
		expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', range: 'relevant', status: 'open' })
		);
	});
});
