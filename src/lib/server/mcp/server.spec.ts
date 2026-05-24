import { describe, expect, it, vi } from 'vitest';

const { handlerMap, runCaptureThoughtToolMock, runSearchThoughtsToolMock } = vi.hoisted(() => ({
	handlerMap: new Map(),
	runCaptureThoughtToolMock: vi.fn(),
	runSearchThoughtsToolMock: vi.fn()
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
	Server: class MockServer {
		setRequestHandler(schema: unknown, handler: unknown) {
			handlerMap.set(schema, handler);
		}
	}
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
	ListToolsRequestSchema: Symbol.for('list-tools'),
	CallToolRequestSchema: Symbol.for('call-tool')
}));

vi.mock('./tools', () => ({
	runCaptureThoughtTool: runCaptureThoughtToolMock,
	runListThoughtsTool: vi.fn(),
	runEditThoughtTool: vi.fn(),
	runDeleteThoughtTool: vi.fn(),
	runRetrieveThoughtsTool: runSearchThoughtsToolMock,
	runAnswerQuestionTool: vi.fn()
}));

describe('createMcpServer', () => {
	it('registers list tools handler', async () => {
		const { createMcpServer } = await import('./server');
		createMcpServer({ userId: 'u1' });
		const listHandler = handlerMap.get(Symbol.for('list-tools')) as () => Promise<{ tools: Array<{ name: string }> }>;
		const result = await listHandler();
		expect(result.tools.map((t) => t.name)).toEqual(
			expect.arrayContaining([
				'capture_thought',
				'list_thoughts',
				'retrieve_thoughts',
				'edit_thought',
				'delete_thought',
				'answer_question'
			])
		);
	});

	it('dispatches call tool handler', async () => {
		runSearchThoughtsToolMock.mockResolvedValue({ results: [{ id: 't1' }] });
		const { createMcpServer } = await import('./server');
		createMcpServer({ userId: 'u1' });
		const callHandler = handlerMap.get(Symbol.for('call-tool')) as (request: {
			params: { name: string; arguments?: unknown };
		}) => Promise<{ content: Array<{ text: string }> }>;
		const result = await callHandler({
			params: { name: 'retrieve_thoughts', arguments: { query: 'hello' } }
		});
		expect(runSearchThoughtsToolMock).toHaveBeenCalledWith({ userId: 'u1' }, { query: 'hello' });
		expect(result.content[0].text).toContain('results');
	});

	it('throws on unknown tool name', async () => {
		const { createMcpServer } = await import('./server');
		createMcpServer({ userId: 'u1' });
		const callHandler = handlerMap.get(Symbol.for('call-tool')) as (request: {
			params: { name: string; arguments?: unknown };
		}) => Promise<unknown>;
		await expect(callHandler({ params: { name: 'nope' } })).rejects.toThrow(/Unknown tool/);
	});
});
