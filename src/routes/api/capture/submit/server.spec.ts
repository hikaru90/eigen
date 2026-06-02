import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { captureThoughtMock, reserveMock } = vi.hoisted(() => ({
	captureThoughtMock: vi.fn(),
	reserveMock: vi.fn()
}));
vi.mock('$lib/server/capture/service', () => ({ captureThought: captureThoughtMock }));
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

describe('POST /api/capture/submit', () => {
	beforeEach(() => {
		captureThoughtMock.mockReset();
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

	it('streams ndjson when Accept includes application/x-ndjson', async () => {
		captureThoughtMock.mockImplementation(
			async (
				_uid: string,
				_raw: string,
				opts?: { onProgress?: (ev: { parallel: false; phase: string }) => Promise<void> }
			) => {
				await opts?.onProgress?.({ parallel: false, phase: 'embedding' });
				return { id: 't1' };
			}
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ raw: 'hello' })
		} as never);
		expect(res.headers.get('content-type')).toContain('ndjson');
		const text = await res.text();
		expect(captureThoughtMock).toHaveBeenLastCalledWith(
			'u1',
			'hello',
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

	it('streams ndjson error line when captureThought throws', async () => {
		captureThoughtMock.mockRejectedValue(new Error('embedding failed'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ raw: 'hello' })
		} as never);
		expect(res.headers.get('content-type')).toContain('ndjson');
		const last = JSON.parse((await res.text()).trim().split('\n').filter(Boolean).pop() ?? '{}') as {
			type: string;
			error?: string;
		};
		expect(last.type).toBe('error');
		expect(last.error).toBe('embedding failed');
		consoleSpy.mockRestore();
	});

	it('swallows errors while clearing session config after a successful capture', async () => {
		let sqlCalls = 0;
		const reserved = Object.assign(
			vi.fn(async () => {
				sqlCalls += 1;
				if (sqlCalls > 1) throw new Error('clear failed');
			}),
			{ release: vi.fn(async () => undefined) }
		);
		reserveMock.mockResolvedValue(reserved);
		captureThoughtMock.mockResolvedValue({ id: 't1' });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ raw: 'hello' })
		} as never);
		const lines = (await res.text())
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { type: string });
		expect(lines.some((l) => l.type === 'done')).toBe(true);
	});

	it('streams parallel progress events', async () => {
		captureThoughtMock.mockImplementation(
			async (
				_uid: string,
				_raw: string,
				opts?: { onProgress?: (ev: { parallel: true; phases: string[] }) => Promise<void> }
			) => {
				await opts?.onProgress?.({ parallel: true, phases: ['embedding', 'persist'] });
				return { id: 't1' };
			}
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ raw: 'hello' })
		} as never);
		const lines = (await res.text())
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { type: string });
		expect(lines.some((l) => l.type === 'progress_parallel')).toBe(true);
	});

	it('logs when captureWork rejects after connection release fails', async () => {
		captureThoughtMock.mockResolvedValue({ id: 't1' });
		const reserved = Object.assign(vi.fn(async () => undefined), {
			release: vi.fn(async () => {
				throw new Error('release failed');
			})
		});
		reserveMock.mockResolvedValue(reserved);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: ndjsonRequest({ raw: 'hello' })
		} as never);
		await res.text();
		expect(consoleSpy).toHaveBeenCalledWith('capture submit: captureWork rejected', expect.any(Error));
		consoleSpy.mockRestore();
	});

	it('aborts the stream when the client disconnects', async () => {
		const ac = new AbortController();
		captureThoughtMock.mockImplementation(
			() =>
				new Promise(() => {
					/* hang until abort */
				})
		);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { ...ndjsonRequest({ raw: 'hello' }), signal: ac.signal }
		} as never);
		ac.abort();
		await expect(res.text()).rejects.toThrow();
	});

	it('returns 500 with error message + details when captureThought throws a chained error', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const root = new Error('embedding failed');
		const wrapped = new Error('capture orchestration failed', { cause: root });
		captureThoughtMock.mockRejectedValue(wrapped);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ raw: 'hello' })) }
		} as never);
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string; details: string[] };
		expect(body.error).toBe('capture orchestration failed');
		expect(body.details).toEqual(
			expect.arrayContaining(['capture orchestration failed', 'embedding failed'])
		);
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('falls back to a generic error message when the thrown value has no useful messages', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		captureThoughtMock.mockRejectedValue(null);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ raw: 'hello' })) }
		} as never);
		const body = (await res.json()) as { error: string; details: string[] };
		expect(body.error).toBe('Failed to capture thought');
		expect(body.details).toEqual([]);
		consoleSpy.mockRestore();
	});

	it('stops collecting when the error cause chain ends on a primitive', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		captureThoughtMock.mockRejectedValue({ message: 'outer', cause: 'done' });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ raw: 'hello' })) }
		} as never);
		const body = (await res.json()) as { error: string; details: string[] };
		expect(body.details).toEqual(['outer']);
		consoleSpy.mockRestore();
	});

	it('collects messages from plain object causes', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const thrown = { message: 'outer', cause: { message: 'inner' } };
		captureThoughtMock.mockRejectedValue(thrown);
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ raw: 'hello' })) }
		} as never);
		const body = (await res.json()) as { error: string; details: string[] };
		expect(body.details).toEqual(expect.arrayContaining(['outer', 'inner']));
		consoleSpy.mockRestore();
	});
});
