import { describe, expect, it, vi } from 'vitest';
import { PUT } from './+server';

const { parseNotificationSettingsBodyMock, saveNotificationSettingsMock } = vi.hoisted(() => ({
	parseNotificationSettingsBodyMock: vi.fn(),
	saveNotificationSettingsMock: vi.fn()
}));

vi.mock('$lib/server/settings/notification-settings', () => ({
	parseNotificationSettingsBody: parseNotificationSettingsBodyMock,
	saveNotificationSettings: saveNotificationSettingsMock
}));

function event(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
	return {
		locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
		request: new Request('http://localhost/api/settings/notifications', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(overrides.body ?? {})
		})
	} as Parameters<typeof PUT>[0];
}

describe('PUT /api/settings/notifications', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(PUT(event({ user: null }))).rejects.toMatchObject({ status: 401 });
	});

	it('returns 400 for invalid JSON body', async () => {
		await expect(
			PUT({
				locals: { user: { id: 'u1' } },
				request: new Request('http://localhost', {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: 'not-json'
				})
			} as Parameters<typeof PUT>[0])
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when body fails validation', async () => {
		parseNotificationSettingsBodyMock.mockImplementation(() => {
			throw new Error('invalid settings shape');
		});
		await expect(PUT(event({ body: { bogus: true } }))).rejects.toMatchObject({ status: 400 });
	});

	it('saves and returns notification settings', async () => {
		parseNotificationSettingsBodyMock.mockReturnValue({ digestEnabled: true });
		saveNotificationSettingsMock.mockResolvedValue({ digestEnabled: true, savedAt: 'now' });
		const res = await PUT(event({ body: { digestEnabled: true } }));
		expect(saveNotificationSettingsMock).toHaveBeenCalledWith('u1', { digestEnabled: true });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ digestEnabled: true, savedAt: 'now' });
	});

	it('returns 500 when save fails', async () => {
		parseNotificationSettingsBodyMock.mockReturnValue({ digestEnabled: true });
		saveNotificationSettingsMock.mockRejectedValue(new Error('db unavailable'));
		await expect(PUT(event({ body: { digestEnabled: true } }))).rejects.toMatchObject({
			status: 500
		});
	});
});
