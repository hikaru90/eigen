import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { computeTimelineStatsForUserMock } = vi.hoisted(() => ({
	computeTimelineStatsForUserMock: vi.fn()
}));

vi.mock('$lib/server/memory/timeline-stats', () => ({
	computeTimelineStatsForUser: computeTimelineStatsForUserMock
}));

function event(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user } } as Parameters<typeof GET>[0];
}

describe('GET /api/timeline/stats', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(GET(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns timeline stats for the user', async () => {
		computeTimelineStatsForUserMock.mockResolvedValue({ openTasks: 3, overdue: 1 });
		const res = await GET(event());
		expect(computeTimelineStatsForUserMock).toHaveBeenCalledWith('u1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ openTasks: 3, overdue: 1 });
	});
});
