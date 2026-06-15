import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { editStoredThoughtMock, reserveMock } = vi.hoisted(() => ({
	editStoredThoughtMock: vi.fn(),
	reserveMock: vi.fn()
}));
vi.mock('$lib/server/capture/service', () => ({ editStoredThought: editStoredThoughtMock }));
vi.mock('$lib/server/db', () => ({
	appSql: { reserve: reserveMock },
	appDbAsyncLocal: { run: (_db: unknown, fn: () => unknown) => fn() },
	createScopedDrizzle: vi.fn(() => ({})),
	activateTenantDbSession: vi.fn(async () => undefined),
	deactivateTenantDbSession: vi.fn(async () => undefined)
}));

function ndjsonRequest(body: unknown) {
	return {
		json: vi.fn(async () => body),
		headers: {
			get: (name: string) => (name.toLowerCase() === 'accept' ? 'application/x-ndjson' : null)
		},
		signal: new AbortController().signal
	};
}

describe('POST /api/capture/edit', () => {
	beforeEach(() => {
		editStoredThoughtMock.mockReset();
		const reserved = Object.assign(vi.fn(async () => undefined), {
			release: vi.fn(async () => undefined)
		});
		reserveMock.mockResolvedValue(reserved);
	});
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
			async (
				_uid: string,
				_tid: string,
				_req: string,
				opts?: { onProgress?: (ev: { parallel: false; phase: string }) => Promise<void> }
			) => {
				await opts?.onProgress?.({ parallel: false, phase: 'embedding' });
				return { ok: true as const, thought: { id: 't1' } };
			}
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' })
		} as never);
		const text = await res.text();
		expect(editStoredThoughtMock).toHaveBeenLastCalledWith(
			'u1',
			't1',
			'fix',
			expect.objectContaining({ onProgress: expect.any(Function) })
		);
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
			request: ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' })
		} as never);
		const last = JSON.parse((await res.text()).trim().split('\n').filter(Boolean).pop() ?? '{}') as {
			type: string;
			error?: string;
		};
		expect(last.type).toBe('error');
		expect(last.error).toBe('Thought not found');
	});

	it('streams parallel progress events', async () => {
		editStoredThoughtMock.mockImplementation(
			async (
				_uid: string,
				_tid: string,
				_req: string,
				opts?: {
					onProgress?: (ev: { parallel: true; phases: string[] }) => Promise<void>;
				}
			) => {
				await opts?.onProgress?.({ parallel: true, phases: ['embedding', 'graph'] });
				return { ok: true as const, thought: { id: 't1' } };
			}
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' })
		} as never);
		const lines = (await res.text())
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { type: string });
		expect(lines.some((l) => l.type === 'progress_parallel')).toBe(true);
	});

	it('swallows errors while clearing session config after a successful edit', async () => {
		let sqlCalls = 0;
		const reserved = Object.assign(
			vi.fn(async () => {
				sqlCalls += 1;
				if (sqlCalls > 1) throw new Error('clear failed');
			}),
			{ release: vi.fn(async () => undefined) }
		);
		reserveMock.mockResolvedValue(reserved);
		editStoredThoughtMock.mockResolvedValue({ ok: true, thought: { id: 't1' } });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' })
		} as never);
		const lines = (await res.text())
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { type: string });
		expect(lines.some((l) => l.type === 'done')).toBe(true);
	});

	it('streams ndjson error when the db pool cannot reserve a connection', async () => {
		reserveMock.mockRejectedValue(new Error('pool exhausted'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' })
		} as never);
		const last = JSON.parse((await res.text()).trim().split('\n').filter(Boolean).pop() ?? '{}') as {
			type: string;
			error?: string;
		};
		expect(last.type).toBe('error');
		expect(last.error).toBe('pool exhausted');
		consoleSpy.mockRestore();
	});

	it('streams ndjson error when editStoredThought throws a non-Error', async () => {
		editStoredThoughtMock.mockRejectedValue('db down');
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' })
		} as never);
		const last = JSON.parse((await res.text()).trim().split('\n').filter(Boolean).pop() ?? '{}') as {
			type: string;
			error?: string;
		};
		expect(last.type).toBe('error');
		expect(last.error).toBe('Failed to update thought');
		consoleSpy.mockRestore();
	});

	it('logs when editWork rejects after connection release fails', async () => {
		editStoredThoughtMock.mockResolvedValue({ ok: true, thought: { id: 't1' } });
		const reserved = Object.assign(vi.fn(async () => undefined), {
			release: vi.fn(async () => {
				throw new Error('release failed');
			})
		});
		reserveMock.mockResolvedValue(reserved);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' })
		} as never);
		await res.text();
		expect(consoleSpy).toHaveBeenCalledWith(
			'[capture.edit.api] editWork rejected',
			expect.objectContaining({ userId: 'u1', thoughtId: 't1', message: 'release failed' })
		);
		consoleSpy.mockRestore();
	});

	it('aborts the stream when the client disconnects', async () => {
		const ac = new AbortController();
		editStoredThoughtMock.mockImplementation(
			() =>
				new Promise(() => {
					/* hang until abort */
				})
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { ...ndjsonRequest({ thoughtId: 't1', editRequest: 'fix' }), signal: ac.signal }
		} as never);
		ac.abort();
		await expect(res.text()).rejects.toThrow();
	});
});
