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

	it('streams ndjson when Accept includes application/x-ndjson', async () => {
		editStoredThoughtMock.mockImplementation(
			async (_uid: string, _tid: string, _req: string, opts?: { onProgress?: (phase: string) => void }) => {
				opts?.onProgress?.('embedding');
				return { ok: true as const, thought: { id: 't1' } };
			}
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: {
				json: vi.fn(async () => ({ thoughtId: 't1', editRequest: 'fix' })),
				headers: {
					get: (name: string) => (name.toLowerCase() === 'accept' ? 'application/x-ndjson' : null)
				}
			}
		} as never);
		expect(editStoredThoughtMock).toHaveBeenCalledWith(
			'u1',
			't1',
			'fix',
			expect.objectContaining({ onProgress: expect.any(Function) })
		);
		const text = await res.text();
		const lines = text
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { type: string });
		expect(lines.some((l) => l.type === 'progress')).toBe(true);
		expect(lines.some((l) => l.type === 'done')).toBe(true);
	});

	it('streams ndjson error when thought is not found', async () => {
		editStoredThoughtMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: {
				json: vi.fn(async () => ({ thoughtId: 't1', editRequest: 'fix' })),
				headers: {
					get: (name: string) => (name.toLowerCase() === 'accept' ? 'application/x-ndjson' : null)
				}
			}
		} as never);
		const last = JSON.parse((await res.text()).trim().split('\n').filter(Boolean).pop() ?? '{}') as {
			type: string;
			error?: string;
		};
		expect(last.type).toBe('error');
		expect(last.error).toBe('Thought not found');
	});
});
