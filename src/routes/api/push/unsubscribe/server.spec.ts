import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { deletePushSubscriptionByEndpointMock } = vi.hoisted(() => ({
	deletePushSubscriptionByEndpointMock: vi.fn()
}));

vi.mock('$lib/server/push/subscription', () => ({
	deletePushSubscriptionByEndpoint: deletePushSubscriptionByEndpointMock
}));

describe('POST /api/push/unsubscribe', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(
			POST({
				locals: { user: null },
				request: new Request('http://localhost/api/push/unsubscribe', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ endpoint: 'https://push.example/x' })
				})
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('removes subscription by endpoint for authenticated user', async () => {
		deletePushSubscriptionByEndpointMock.mockResolvedValue(true);

		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: new Request('http://localhost/api/push/unsubscribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ endpoint: 'https://push.example/x' })
			})
		} as never);

		expect(deletePushSubscriptionByEndpointMock).toHaveBeenCalledWith('https://push.example/x');
		expect(await res.json()).toEqual({ ok: true, removed: true });
	});
});
