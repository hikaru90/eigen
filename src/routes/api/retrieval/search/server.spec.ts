import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { searchThoughtsMock } = vi.hoisted(() => ({ searchThoughtsMock: vi.fn() }));
vi.mock('$lib/server/retrieval/service', () => ({ searchThoughts: searchThoughtsMock }));

describe('POST /api/retrieval/search', () => {
	it('requires auth', async () => {
		await expect(POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never)).rejects.toMatchObject({ status: 401 });
	});

	it('rejects invalid json', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => Promise.reject(new Error('bad'))) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('validates query and topK', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => ({ query: '', topK: 200 })) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns search results', async () => {
		searchThoughtsMock.mockResolvedValue([{ id: 't1' }]);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ query: 'hi', topK: 5 })) }
		} as never);
		expect(searchThoughtsMock).toHaveBeenCalledWith({ userId: 'u1', query: 'hi', topK: 5, weights: { vector: 0.7, graph: 0.3 } });
		expect(res.status).toBe(200);
	});
});
