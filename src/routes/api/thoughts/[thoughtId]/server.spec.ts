import { describe, expect, it, vi } from 'vitest';
import { DELETE, GET } from './+server';

const { deleteThoughtForUserMock, getDbSelectMock } = vi.hoisted(() => ({
	deleteThoughtForUserMock: vi.fn(),
	getDbSelectMock: vi.fn()
}));

vi.mock('$lib/server/capture/service', () => ({
	deleteThoughtForUser: deleteThoughtForUserMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		select: getDbSelectMock
	})
}));

describe('GET /api/thoughts/[thoughtId]', () => {
	it('requires auth', async () => {
		await expect(
			GET({ locals: { user: null }, params: { thoughtId: 't1' } } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns thought row', async () => {
		getDbSelectMock.mockReturnValue({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(async () => [
						{ id: 't1', rawText: 'a', normalizedText: 'a', category: 'perception' }
					])
				}))
			}))
		});
		const res = await GET({
			locals: { user: { id: 'u1' } },
			params: { thoughtId: 't1' }
		} as never);
		expect(res.status).toBe(200);
	});
});

describe('DELETE /api/thoughts/[thoughtId]', () => {
	it('requires auth', async () => {
		await expect(
			DELETE({ locals: { user: null }, params: { thoughtId: 't1' } } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 404 when deleteThoughtForUser reports not found', async () => {
		deleteThoughtForUserMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			DELETE({ locals: { user: { id: 'u1' } }, params: { thoughtId: 't1' } } as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns ok when deleted', async () => {
		deleteThoughtForUserMock.mockResolvedValue({ ok: true });
		const res = await DELETE({
			locals: { user: { id: 'u1' } },
			params: { thoughtId: 't1' }
		} as never);
		expect(res.status).toBe(200);
		expect(deleteThoughtForUserMock).toHaveBeenCalledWith('u1', 't1');
	});
});
