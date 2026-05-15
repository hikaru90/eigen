import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { relinkThoughtGraphMock } = vi.hoisted(() => ({ relinkThoughtGraphMock: vi.fn() }));
vi.mock('$lib/server/capture/service', () => ({ relinkThoughtGraph: relinkThoughtGraphMock }));

describe('POST /api/capture/relink', () => {
	it('requires auth', async () => {
		await expect(
			POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('rejects invalid json', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => Promise.reject(new Error('bad'))) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('validates thoughtId', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => ({ thoughtId: '   ' })) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 404 when thought not found', async () => {
		relinkThoughtGraphMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => ({ thoughtId: 't1' })) }
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns thought payload', async () => {
		relinkThoughtGraphMock.mockResolvedValue({
			ok: true,
			thought: { id: 't1', rawText: 'a', normalizedText: 'a', category: 'task' }
		});
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ thoughtId: 't1' })) }
		} as never);
		expect(res.status).toBe(200);
	});

	it('streams ndjson when Accept includes application/x-ndjson', async () => {
		relinkThoughtGraphMock.mockImplementation(
			async (_uid: string, _tid: string, opts?: { onProgress?: (phase: string) => void }) => {
				opts?.onProgress?.('graph');
				return {
					ok: true as const,
					thought: { id: 't1', rawText: 'a', normalizedText: 'a', category: 'task' }
				};
			}
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: {
				json: vi.fn(async () => ({ thoughtId: 't1' })),
				headers: {
					get: (name: string) => (name.toLowerCase() === 'accept' ? 'application/x-ndjson' : null)
				}
			}
		} as never);
		expect(relinkThoughtGraphMock).toHaveBeenCalledWith(
			'u1',
			't1',
			expect.objectContaining({ onProgress: expect.any(Function) })
		);
		const lines = (await res.text())
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { type: string });
		expect(lines.some((l) => l.type === 'progress')).toBe(true);
		expect(lines.some((l) => l.type === 'done')).toBe(true);
	});
});
