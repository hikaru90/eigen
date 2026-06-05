import { describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));

import { GET } from './+server';

function mockEvent(user: { id: string } | null) {
	return {
		locals: { user }
	} as Parameters<typeof GET>[0];
}

describe('GET /api/temporal-events', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(GET(mockEvent(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns temporal events for the user', async () => {
		const start = new Date('2026-05-20T00:00:00.000Z');
		const end = new Date('2026-05-21T00:00:00.000Z');
		const created = new Date('2026-05-19T11:15:08.867Z');

		const limit = vi.fn().mockResolvedValue([
			{
				id: 'ev-1',
				kind: 'appointment',
				semanticSummary: 'Inline skating next Wednesday',
				sourceTextSpan: 'nächsten mittwoch',
				timePrecision: 'day',
				timezone: 'UTC',
				isAllDay: true,
				confidence: 0.9,
				startAt: start,
				endAt: end,
				activePeriod: '[2026-05-20,2026-05-21)',
				graphSyncStatus: 'synced',
				graphSyncError: null,
				thoughtId: 't-1',
				thoughtText: 'ich will nächsten mittwoch inline-skaten gehen',
				thoughtTextEncrypted: null,
				thoughtCategory: 'task',
				thoughtMetadata: { status: 'open' },
				thoughtMetadataEncrypted: null,
				createdAt: created
			}
		]);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const innerJoin = vi.fn(() => ({ where }));
		const from = vi.fn(() => ({ innerJoin }));
		const select = vi.fn(() => ({ from }));

		getDbMock.mockReturnValue({ select });

		const res = await GET(mockEvent({ id: 'u1' }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{
				id: string;
				thoughtText: string;
				thoughtCategory: string;
				thoughtStatus: string;
			}>;
		};
		expect(body.items).toHaveLength(1);
		expect(body.items[0]?.id).toBe('ev-1');
		expect(body.items[0]?.thoughtText).toContain('inline-skaten');
		expect(body.items[0]?.thoughtCategory).toBe('task');
		expect(body.items[0]?.thoughtStatus).toBe('open');
	});
});
