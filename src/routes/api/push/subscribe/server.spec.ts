import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { parsePushSubscriptionBodyMock, upsertPushSubscriptionMock } = vi.hoisted(() => ({
	parsePushSubscriptionBodyMock: vi.fn(),
	upsertPushSubscriptionMock: vi.fn()
}));

vi.mock('$lib/server/push/subscription', () => ({
	parsePushSubscriptionBody: parsePushSubscriptionBodyMock,
	upsertPushSubscription: upsertPushSubscriptionMock
}));

describe('POST /api/push/subscribe', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(
			POST({
				locals: { user: null },
				request: new Request('http://localhost/api/push/subscribe', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } })
				})
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('persists subscription for authenticated user', async () => {
		parsePushSubscriptionBodyMock.mockReturnValue({
			endpoint: 'https://push.example/x',
			keys: { p256dh: 'p', auth: 'a' }
		});
		upsertPushSubscriptionMock.mockResolvedValue({ id: 'sub-1' });

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: new Request('http://localhost/api/push/subscribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
				body: JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } })
			})
		} as never);

		expect(upsertPushSubscriptionMock).toHaveBeenCalledWith(
			'u1',
			{ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
			'vitest'
		);
		expect(await res.json()).toEqual({ ok: true, id: 'sub-1' });
	});
});
