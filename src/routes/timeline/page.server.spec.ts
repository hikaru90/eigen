import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/memory/user-timezone', () => ({
	getUserPreferredTimezone: vi.fn().mockResolvedValue('Europe/Berlin')
}));

describe('timeline page server', () => {
	it('redirects unauthenticated user', async () => {
		await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 });
	});

	it('returns timeline prefs for signed-in user', async () => {
		const limit = vi.fn().mockResolvedValue([
			{
				eventNotificationsEnabled: true,
				eventReminderLeadMinutes: 15,
				eventReminderKinds: ['appointment']
			}
		]);
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		const data = await load({
			locals: { user: { id: 'u1', email: 'a@b.c', name: 'Alex' } }
		} as never);

		expect(data).toBeTruthy();
		if (!data) return;
		expect(data.preferredTimezone).toBe('Europe/Berlin');
		expect(data.eventNotificationsEnabled).toBe(true);
		expect(data.eventReminderLeadMinutes).toBe(15);
		expect(data.eventReminderKinds).toEqual(['appointment']);
	});
});
