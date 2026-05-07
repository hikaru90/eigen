import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const {
	runCaptureThoughtToolMock,
	runListThoughtsToolMock,
	runSearchThoughtsToolMock,
	runEditThoughtToolMock
} = vi.hoisted(() => ({
	runCaptureThoughtToolMock: vi.fn(),
	runListThoughtsToolMock: vi.fn(),
	runSearchThoughtsToolMock: vi.fn(),
	runEditThoughtToolMock: vi.fn()
}));

vi.mock('$lib/server/mcp/tools', () => ({
	runCaptureThoughtTool: runCaptureThoughtToolMock,
	runListThoughtsTool: runListThoughtsToolMock,
	runSearchThoughtsTool: runSearchThoughtsToolMock,
	runEditThoughtTool: runEditThoughtToolMock
}));

describe('POST /api/mcp', () => {
	it('requires auth', async () => {
		await expect(POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never)).rejects.toMatchObject({ status: 401 });
	});

	it('rejects invalid json body', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => Promise.reject(new Error('bad'))) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('lists tools', async () => {
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: { json: vi.fn(async () => ({ method: 'tools/list' })) }
		} as never);
		expect(res.status).toBe(200);
	});

	it('rejects unsupported method', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: { json: vi.fn(async () => ({ method: 'unknown' })) }
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unknown tool name', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				request: {
					json: vi.fn(async () => ({ method: 'tools/call', params: { name: 'nope', arguments: {} } }))
				}
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('dispatches tool call', async () => {
		runSearchThoughtsToolMock.mockResolvedValue({ results: [{ id: 't1' }] });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: {
				json: vi.fn(async () => ({
					method: 'tools/call',
					params: { name: 'search_thoughts', arguments: { query: 'hello' } }
				}))
			}
		} as never);
		expect(runSearchThoughtsToolMock).toHaveBeenCalledWith({ userId: 'u1' }, { query: 'hello' });
		expect(res.status).toBe(200);
	});
});
