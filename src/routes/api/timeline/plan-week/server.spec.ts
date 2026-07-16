import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { planWeekForUserMock } = vi.hoisted(() => ({
	planWeekForUserMock: vi.fn()
}));

vi.mock('$lib/server/memory/plan-week', () => ({
	planWeekForUser: planWeekForUserMock
}));

function event(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user } } as Parameters<typeof POST>[0];
}

describe('POST /api/timeline/plan-week', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(POST(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns the generated week plan', async () => {
		planWeekForUserMock.mockResolvedValue({ items: [{ id: 'ev-1' }] });
		const res = await POST(event());
		expect(planWeekForUserMock).toHaveBeenCalledWith('u1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [{ id: 'ev-1' }] });
	});
});
