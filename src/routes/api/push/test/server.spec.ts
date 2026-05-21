import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { sendPushToUserMock } = vi.hoisted(() => ({
	sendPushToUserMock: vi.fn()
}));

vi.mock('$lib/server/push/send', () => ({
	sendPushToUser: sendPushToUserMock
}));

describe('POST /api/push/test', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(
			POST({
				locals: { user: null },
				request: new Request('http://localhost/api/push/test', { method: 'POST' })
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('sends test notification for current user only', async () => {
		sendPushToUserMock.mockResolvedValue({ sent: 1, failed: 0, removed: 0, errors: [] });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: new Request('http://localhost/api/push/test', { method: 'POST' })
		} as never);
		expect(sendPushToUserMock).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ title: 'Eigen test', tag: 'eigen-test' })
		);
		expect(await res.json()).toMatchObject({ ok: true, sent: 1 });
	});
});
