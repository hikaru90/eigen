import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const {
	runCaptureThoughtToolMock,
	runRetrieveThoughtsToolMock,
	runEditThoughtToolMock,
	runAnswerQuestionToolMock
} = vi.hoisted(() => ({
	runCaptureThoughtToolMock: vi.fn(),
	runRetrieveThoughtsToolMock: vi.fn(),
	runEditThoughtToolMock: vi.fn(),
	runAnswerQuestionToolMock: vi.fn()
}));

vi.mock('$lib/server/mcp/tools', () => ({
	runCaptureThoughtTool: runCaptureThoughtToolMock,
	runRetrieveThoughtsTool: runRetrieveThoughtsToolMock,
	runEditThoughtTool: runEditThoughtToolMock,
	runAnswerQuestionTool: runAnswerQuestionToolMock
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
		runRetrieveThoughtsToolMock.mockResolvedValue({ results: [{ id: 't1' }] });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: {
				json: vi.fn(async () => ({
					method: 'tools/call',
					params: { name: 'retrieve_thoughts', arguments: { query: 'hello' } }
				}))
			}
		} as never);
		expect(runRetrieveThoughtsToolMock).toHaveBeenCalledWith({ userId: 'u1' }, { query: 'hello' });
		expect(res.status).toBe(200);
	});
});
