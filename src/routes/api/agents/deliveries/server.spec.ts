import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { listWebhookDeliveriesMock } = vi.hoisted(() => ({
	listWebhookDeliveriesMock: vi.fn()
}));

vi.mock('$lib/server/agents/service', () => ({
	listWebhookDeliveries: listWebhookDeliveriesMock
}));

function event(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user } } as Parameters<typeof GET>[0];
}

describe('GET /api/agents/deliveries', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await GET(event(null));
		expect(res.status).toBe(401);
	});

	it('lists webhook deliveries for the user', async () => {
		listWebhookDeliveriesMock.mockResolvedValue([{ id: 'd1' }]);
		const res = await GET(event());
		expect(listWebhookDeliveriesMock).toHaveBeenCalledWith('u1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ deliveries: [{ id: 'd1' }] });
	});
});
