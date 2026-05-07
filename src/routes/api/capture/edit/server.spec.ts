import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { editStoredThoughtMock } = vi.hoisted(() => ({ editStoredThoughtMock: vi.fn() }));
vi.mock('$lib/server/capture/service', () => ({ editStoredThought: editStoredThoughtMock }));

describe('POST /api/capture/edit', () => {
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

	it('validates required fields', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => ({ thoughtId: '', editRequest: '' })) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 404 when thought not found', async () => {
		editStoredThoughtMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => ({ thoughtId: 't1', editRequest: 'fix' })) }
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns updated thought', async () => {
		editStoredThoughtMock.mockResolvedValue({ ok: true, thought: { id: 't1' } });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ thoughtId: 't1', editRequest: 'fix' })) }
		} as never);
		expect(res.status).toBe(200);
	});
});
