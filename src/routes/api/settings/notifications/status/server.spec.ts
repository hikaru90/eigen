import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { loadNotificationStatusForUserMock } = vi.hoisted(() => ({
	loadNotificationStatusForUserMock: vi.fn()
}));

vi.mock('$lib/server/settings/notification-status', () => ({
	loadNotificationStatusForUser: loadNotificationStatusForUserMock
}));

function event(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user } } as Parameters<typeof GET>[0];
}

describe('GET /api/settings/notifications/status', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(GET(event(null))).rejects.toMatchObject({ status: 401 });
	});

	it('returns notification status for the user', async () => {
		loadNotificationStatusForUserMock.mockResolvedValue({ pushEnabled: true });
		const res = await GET(event());
		expect(loadNotificationStatusForUserMock).toHaveBeenCalledWith('u1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, pushEnabled: true });
	});
});
