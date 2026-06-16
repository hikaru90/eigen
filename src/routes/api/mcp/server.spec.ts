import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const {
	runCaptureThoughtToolMock,
	runListThoughtsToolMock,
	runRetrieveThoughtsToolMock,
	runEditThoughtToolMock,
	runDeleteThoughtToolMock,
	runListTemporalEventsToolMock,
	runListProjectsToolMock,
	runManageTemporalEventToolMock,
	runAnswerQuestionToolMock,
	runCaptureGroundingToolMock,
	runCompleteGroundingSessionToolMock
} = vi.hoisted(() => ({
	runCaptureThoughtToolMock: vi.fn(),
	runListThoughtsToolMock: vi.fn(),
	runRetrieveThoughtsToolMock: vi.fn(),
	runEditThoughtToolMock: vi.fn(),
	runDeleteThoughtToolMock: vi.fn(),
	runListTemporalEventsToolMock: vi.fn(),
	runListProjectsToolMock: vi.fn(),
	runManageTemporalEventToolMock: vi.fn(),
	runAnswerQuestionToolMock: vi.fn(),
	runCaptureGroundingToolMock: vi.fn(),
	runCompleteGroundingSessionToolMock: vi.fn()
}));

vi.mock('$lib/server/mcp/tools', () => ({
	runCaptureThoughtTool: runCaptureThoughtToolMock,
	runListThoughtsTool: runListThoughtsToolMock,
	runRetrieveThoughtsTool: runRetrieveThoughtsToolMock,
	runEditThoughtTool: runEditThoughtToolMock,
	runDeleteThoughtTool: runDeleteThoughtToolMock,
	runListTemporalEventsTool: runListTemporalEventsToolMock,
	runListProjectsTool: runListProjectsToolMock,
	runManageTemporalEventTool: runManageTemporalEventToolMock,
	runAnswerQuestionTool: runAnswerQuestionToolMock,
	runCaptureGroundingTool: runCaptureGroundingToolMock,
	runCompleteGroundingSessionTool: runCompleteGroundingSessionToolMock
}));

function makeRequest(body: unknown, method = 'POST'): Request {
	return new Request('http://localhost/api/mcp', {
		method,
		headers: {
			'Content-Type': 'application/json',
			// MCP transport requires both types in Accept header (line 378 of webStandardStreamableHttp.js)
			'Accept': 'application/json, text/event-stream'
		},
		body: JSON.stringify(body)
	});
}

describe('POST /api/mcp', () => {
	it('requires auth', async () => {
		const res = await POST({
			locals: { user: null },
			request: makeRequest({})
		} as never);
		expect(res.status).toBe(401);
	});

	it('lists tools', async () => {
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: makeRequest({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: {}
			})
		} as never);
		expect(res.status).toBe(200);
	});

	it('rejects unknown tool name', async () => {
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: makeRequest({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'nope', arguments: {} }
			})
		} as never);
		// MCP SDK returns error in JSON-RPC body with 200, or 4xx — either is acceptable
		expect(res.status).toBeGreaterThanOrEqual(200);
		if (res.status === 200) {
			const body = await res.json() as { error?: unknown };
			expect(body.error).toBeDefined();
		}
	});

	it('dispatches tool call', async () => {
		runRetrieveThoughtsToolMock.mockResolvedValue({ results: [{ id: 't1' }] });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: makeRequest({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: { name: 'retrieve_thoughts', arguments: { query: 'hello' } }
			})
		} as never);
		expect(runRetrieveThoughtsToolMock).toHaveBeenCalledWith({ userId: 'u1' }, { query: 'hello' });
		expect(res.status).toBe(200);
	});
});
