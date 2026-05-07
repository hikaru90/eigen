import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { captureThoughtMock } = vi.hoisted(() => ({ captureThoughtMock: vi.fn() }));
vi.mock('$lib/server/capture/service', () => ({ captureThought: captureThoughtMock }));

describe('POST /api/capture/submit', () => {
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

	it('requires raw input', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => ({})) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('captures thought when payload is valid', async () => {
		captureThoughtMock.mockResolvedValue({ id: 't1' });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ raw: 'hello' })) }
		} as never);
		expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'hello');
		expect(res.status).toBe(200);
	});
});
