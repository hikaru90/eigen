import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { syncCanonicalEntityVertexToGraphMock } = vi.hoisted(() => ({
	syncCanonicalEntityVertexToGraphMock: vi.fn()
}));

vi.mock('$lib/server/memory/canonical-entity-admin', () => ({
	syncCanonicalEntityVertexToGraph: syncCanonicalEntityVertexToGraphMock
}));

describe('POST /api/entities/[entityId]/sync', () => {
	it('requires auth', async () => {
		await expect(
			POST({ locals: { user: null }, params: { entityId: 'e1' } } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 404 when entity missing', async () => {
		syncCanonicalEntityVertexToGraphMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			POST({ locals: { user: { id: 'u1' } }, params: { entityId: 'e1' } } as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns ok when synced', async () => {
		syncCanonicalEntityVertexToGraphMock.mockResolvedValue({ ok: true });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			params: { entityId: 'e1' }
		} as never);
		expect(res.status).toBe(200);
		expect(syncCanonicalEntityVertexToGraphMock).toHaveBeenCalledWith('u1', 'e1');
	});
});
