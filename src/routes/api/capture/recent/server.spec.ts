import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { loadRecentCaptureThoughtsMock } = vi.hoisted(() => ({
	loadRecentCaptureThoughtsMock: vi.fn()
}));

vi.mock('$lib/server/capture/load-recent-capture-thoughts', () => ({
	loadRecentCaptureThoughts: loadRecentCaptureThoughtsMock
}));

describe('GET /api/capture/recent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('requires auth', async () => {
		await expect(GET({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 401 });
	});

	it('returns recent capture snippets and details', async () => {
		loadRecentCaptureThoughtsMock.mockResolvedValue({
			recentThoughts: [{ id: 't1', normalizedText: 'hello', category: 'observation', memoryType: null, createdAt: '2026-06-06T18:00:00.000Z' }],
			recentThoughtDetails: [{ id: 't1', enrichmentComplete: false, queueStatus: 'pending' }]
		});
		const res = await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.recentThoughts).toHaveLength(1);
		expect(loadRecentCaptureThoughtsMock).toHaveBeenCalledWith('u1');
	});
});
