import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	llmChatCompletionMock,
	logActivityCallMock,
	listThoughtsMock,
	retrieveThoughtsMock,
	deleteThoughtMock,
	answerQuestionMock,
	getDbMock
} = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn(),
	logActivityCallMock: vi.fn(),
	listThoughtsMock: vi.fn(),
	retrieveThoughtsMock: vi.fn(),
	deleteThoughtMock: vi.fn(),
	answerQuestionMock: vi.fn(),
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));
vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));
vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));
vi.mock('$lib/server/mcp/registry', () => ({
	MCP_TOOL_MAP: new Map([
		['list_thoughts', listThoughtsMock],
		['retrieve_thoughts', retrieveThoughtsMock],
		['delete_thought', deleteThoughtMock],
		['answer_question', answerQuestionMock]
	]),
	MCP_TOOL_NAMES: ['list_thoughts', 'retrieve_thoughts', 'delete_thought', 'answer_question'],
	MCP_TOOL_DEFINITIONS: [],
	buildAgentToolDescriptionBlock: () => ''
}));

import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { maxFusedRrfScore } from '$lib/server/retrieval/rrf-scoring';
import { STRONG_RETRIEVE_MATCH_MIN } from './agent-tool-result-compact';
import { agentChat } from './agent-loop';

function llmJson(payload: unknown) {
	return {
		choices: [{ message: { content: JSON.stringify(payload) } }]
	};
}

describe('agentChat', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({});
		logActivityCallMock.mockResolvedValue(undefined);
	});

	it('returns a final answer when the model responds with {"answer": "..."}', async () => {
		llmChatCompletionMock.mockResolvedValue(llmJson({ answer: 'Hello from memory.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Hi' }]
		});

		expect(result.response).toBe('Hello from memory.');
	});

	it('executes a tool call and returns after the model answers', async () => {
		listThoughtsMock.mockResolvedValue({ thoughts: [{ id: 't1' }] });
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({ tool: 'list_thoughts', arguments: { limit: 5 } })
			)
			.mockResolvedValueOnce(llmJson({ answer: 'You have one recent thought.' }));

		const events: string[] = [];
		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'What did I store?' }],
			onEvent: (event) => {
				events.push(event.type);
			}
		});

		expect(listThoughtsMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1' }),
			{ limit: 5 }
		);
		expect(result.response).toBe('You have one recent thought.');
		expect(events).toContain('tool_call');
		expect(events).toContain('tool_result');
	});

	it('returns a fallback message when the model returns empty content', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Hello' }]
		});

		expect(result.response).toMatch(/did not produce a response/i);
	});

	it('treats invalid JSON as a final answer', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: 'Just plain text.' } }]
		});

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Hello' }]
		});

		expect(result.response).toBe('Just plain text.');
	});

	it('returns answer_question results directly without another LLM turn', async () => {
		answerQuestionMock.mockResolvedValue({
			answer: 'You prefer sourdough.',
			citations: []
		});
		llmChatCompletionMock.mockResolvedValue(
			llmJson({ tool: 'answer_question', arguments: { question: 'What bread?' } })
		);

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'What bread do I like?' }]
		});

		expect(answerQuestionMock).toHaveBeenCalled();
		expect(result.response).toBe('You prefer sourdough.');
	});

	it('retries when the model requests an unknown tool', async () => {
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({ tool: 'missing_tool', arguments: {} })
			)
			.mockResolvedValueOnce(llmJson({ answer: 'Recovered.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Help' }]
		});

		expect(result.response).toBe('Recovered.');
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(2);
	});

	it('never sends embedding arrays to the LLM even if a tool returns them', async () => {
		const vec = Array.from({ length: 1536 }, () => 0.1);
		listThoughtsMock.mockResolvedValue({
			thoughts: [{ id: 't1', normalizedText: 'secret', embedding: vec }]
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(llmJson({ tool: 'list_thoughts', arguments: {} }))
			.mockResolvedValueOnce(llmJson({ answer: 'ok' }));

		await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'list thoughts' }]
		});

		const sentMessages = llmChatCompletionMock.mock.calls[1]?.[0]?.messages as Array<{
			content: string;
		}>;
		const toolMsg = sentMessages.find((m) => m.content.includes('list_thoughts'));
		expect(toolMsg?.content).not.toContain('0.1');
		expect(toolMsg?.content).not.toContain('"embedding"');
	});

	it('feeds compact tool results to the LLM on the next turn', async () => {
		const weights = CONTEXT_WEIGHTS.default;
		const strongScore = maxFusedRrfScore(weights) * STRONG_RETRIEVE_MATCH_MIN;
		retrieveThoughtsMock.mockResolvedValue({
			results: [
				{ id: 't1', normalizedText: 'x'.repeat(8_000), category: 'thought', score: strongScore },
				{ id: 't2', normalizedText: 'y'.repeat(8_000), category: 'thought', score: strongScore }
			]
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'big note' } })
			)
			.mockResolvedValueOnce(llmJson({ answer: 'Pick one.' }));

		await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete the note about groceries' }]
		});

		const followUpMessages = llmChatCompletionMock.mock.calls[1]?.[0]?.messages as Array<{
			content: string;
		}>;
		expect(deleteThoughtMock).not.toHaveBeenCalled();
		const toolResultMessage = followUpMessages.find(
			(m) => m.role === 'user' && m.content.includes('Tool result for retrieve_thoughts')
		);
		expect(toolResultMessage?.content.length).toBeLessThan(20_000);
		expect(toolResultMessage?.content).toContain('candidates');
		expect(toolResultMessage?.content).not.toContain('x'.repeat(500));
	});

	it('auto-deletes when delete intent has exactly one strong retrieve match', async () => {
		const weights = CONTEXT_WEIGHTS.default;
		const strongScore = maxFusedRrfScore(weights) * STRONG_RETRIEVE_MATCH_MIN;
		retrieveThoughtsMock.mockResolvedValue({
			results: [{ id: 't-del', normalizedText: 'Buy milk', category: 'task', score: strongScore }]
		});
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-del' });
		llmChatCompletionMock.mockResolvedValueOnce(
			llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'milk' } })
		);

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete the thought about milk' }]
		});

		expect(deleteThoughtMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1' }),
			{ thought_id: 't-del' }
		);
		expect(result.response).toMatch(/deleted/i);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
	});

	it('returns the max-iteration fallback after too many tool loops', async () => {
		listThoughtsMock.mockResolvedValue({ thoughts: [] });
		llmChatCompletionMock.mockResolvedValue(
			llmJson({ tool: 'list_thoughts', arguments: { limit: 1 } })
		);

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Loop forever' }]
		});

		expect(result.response).toMatch(/too many steps/i);
	});
});
