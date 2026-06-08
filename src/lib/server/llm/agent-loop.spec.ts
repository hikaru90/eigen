import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	llmChatCompletionMock,
	logActivityCallMock,
	listThoughtsMock,
	retrieveThoughtsMock,
	retrieveThoughtRowsForDeleteRequestMock,
	deleteThoughtMock,
	answerQuestionMock,
	captureGroundingMock,
	getDbMock,
	mcpToolMap,
	routeAgentMessageMock,
	classifyChatIntentMock,
	classifyDeleteIntentMock
} = vi.hoisted(() => {
	const listThoughtsMock = vi.fn();
	const retrieveThoughtsMock = vi.fn();
	const retrieveThoughtRowsForDeleteRequestMock = vi.fn();
	const deleteThoughtMock = vi.fn();
	const answerQuestionMock = vi.fn();
	const captureGroundingMock = vi.fn();
	const routeAgentMessageMock = vi.fn();
	const classifyChatIntentMock = vi.fn();
	const classifyDeleteIntentMock = vi.fn();
	const mcpToolMap = new Map<string, typeof listThoughtsMock>([
		['list_thoughts', listThoughtsMock],
		['retrieve_thoughts', retrieveThoughtsMock],
		['delete_thought', deleteThoughtMock],
		['answer_question', answerQuestionMock],
		['capture_grounding', captureGroundingMock]
	]);
	return {
		llmChatCompletionMock: vi.fn(),
		logActivityCallMock: vi.fn(),
		listThoughtsMock,
		retrieveThoughtsMock,
		retrieveThoughtRowsForDeleteRequestMock,
		deleteThoughtMock,
		answerQuestionMock,
		captureGroundingMock,
		getDbMock: vi.fn(),
		mcpToolMap,
		routeAgentMessageMock,
		classifyChatIntentMock,
		classifyDeleteIntentMock
	};
});

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));
vi.mock('$lib/server/llm/agent-router', () => ({
	routeAgentMessage: routeAgentMessageMock
}));
vi.mock('$lib/server/llm/classify-chat-intent', () => ({
	classifyChatIntent: classifyChatIntentMock
}));
vi.mock('$lib/server/llm/classify-delete-intent', () => ({
	classifyDeleteIntent: classifyDeleteIntentMock
}));
vi.mock('$lib/server/retrieval/retrieve-for-delete', () => ({
	retrieveThoughtRowsForDeleteRequest: retrieveThoughtRowsForDeleteRequestMock
}));
vi.mock('$lib/server/activity/log-call', () => ({
	logActivityCall: logActivityCallMock
}));
vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));
vi.mock('$lib/server/mcp/registry', () => ({
	MCP_TOOL_MAP: mcpToolMap,
	MCP_TOOL_NAMES: ['list_thoughts', 'retrieve_thoughts', 'delete_thought', 'answer_question'],
	MCP_TOOL_DEFINITIONS: [],
	buildAgentToolDescriptionBlock: () => '',
	buildGroundingAgentToolDescriptionBlock: () => '',
	GROUNDING_TOOL_NAMES: ['capture_grounding', 'complete_grounding_session']
}));

import { STRONG_RETRIEVE_MATCH_MIN } from './agent-tool-result-compact';
import { agentChat } from './agent-loop';

function llmJson(payload: unknown) {
	return {
		choices: [{ message: { content: JSON.stringify(payload) } }]
	};
}

function mockDeleteRetrieve(
	results: Array<{
		id: string;
		normalizedText: string;
		category?: string;
		score: number;
	}>,
	queries: string[] = ['recipes cooking dishes meals']
) {
	retrieveThoughtRowsForDeleteRequestMock.mockResolvedValue({ queries, results });
}

describe('agentChat', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		llmChatCompletionMock.mockReset();
		getDbMock.mockReturnValue({});
		logActivityCallMock.mockResolvedValue(undefined);
		routeAgentMessageMock.mockResolvedValue({ mode: 'multi_step' });
		classifyChatIntentMock.mockResolvedValue('capture');
		classifyDeleteIntentMock.mockResolvedValue(false);
	});

	it('retries answer_question once after tool error', async () => {
		answerQuestionMock
			.mockRejectedValueOnce(new Error('Invalid tsrange literal'))
			.mockResolvedValueOnce({ answer: 'You are at home.', citations: [] });
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'answer_question',
			arguments: { question: 'Where am I?' }
		});

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Where am I?' }]
		});

		expect(answerQuestionMock).toHaveBeenCalledTimes(2);
		expect(result.response).toBe('You are at home.');
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
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'answer_question',
			arguments: { question: 'What bread?' }
		});

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'What bread do I like?' }]
		});

		expect(answerQuestionMock).toHaveBeenCalled();
		expect(result.response).toBe('You prefer sourdough.');
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('overrides misrouted capture_thought to answer_question when classifier says answer', async () => {
		const question = 'Wie koche ich Japanese-Glazed Salmon?';
		answerQuestionMock.mockResolvedValue({
			answer: 'Glaze with mirin and soy, then broil.',
			citations: []
		});
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'capture_thought',
			arguments: { raw: 'How to cook Japanese-glazed salmon' }
		});
		classifyChatIntentMock.mockResolvedValue('answer');

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: question }]
		});

		expect(classifyChatIntentMock).toHaveBeenCalledWith({
			userId: 'u1',
			userMessage: question
		});
		expect(answerQuestionMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ question })
		);
		expect(result.response).toBe('Glaze with mirin and soy, then broil.');
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('escalates misrouted capture_thought to multi_step when classifier says manage', async () => {
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'capture_thought',
			arguments: { raw: 'delete the salmon note' }
		});
		classifyChatIntentMock.mockResolvedValue('manage');
		llmChatCompletionMock.mockResolvedValue(llmJson({ answer: 'Removed the note.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete the salmon note' }]
		});

		expect(classifyChatIntentMock).toHaveBeenCalled();
		expect(answerQuestionMock).not.toHaveBeenCalled();
		expect(result.response).toBe('Removed the note.');
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
		classifyDeleteIntentMock.mockResolvedValue(false);
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
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
			messages: [{ role: 'user', content: 'search my notes about groceries' }]
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

	it('resolves delete target via LLM and reports not found without listing thoughts', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'delete_thought',
			arguments: { thought_id: 'Japanese glazed salmon recipe' }
		});
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		mockDeleteRetrieve(
			[
				{
					id: 't-chicken',
					normalizedText: 'Recipe: Lemon Herb Roast Chicken',
					category: 'observation',
					score: strongScore
				},
				{
					id: 't-risotto',
					normalizedText: 'Recipe: Creamy Mushroom Risotto',
					category: 'observation',
					score: strongScore
				}
			],
			['Japanese glazed salmon', 'recipes cooking dishes']
		);
		llmChatCompletionMock.mockResolvedValueOnce(llmJson({ thoughtIds: [] }));

		const events: Array<{ type: string; tool?: string; preview?: string }> = [];
		const result = await agentChat({
			userId: 'u1',
			messages: [
				{
					role: 'user',
					content: 'Can you please delete the Japanese glazed salmon recipe?'
				}
			],
			onEvent: (event) => events.push(event)
		});

		expect(retrieveThoughtRowsForDeleteRequestMock).toHaveBeenCalledWith({
			userId: 'u1',
			deleteRequest: 'Can you please delete the Japanese glazed salmon recipe?'
		});
		expect(deleteThoughtMock).not.toHaveBeenCalled();
		expect(result.response).toMatch(/could not find/i);
		expect(result.response).not.toMatch(/^1\./);
		expect(
			events.some(
				(e) =>
					e.type === 'tool_result' &&
					e.tool === 'retrieve_thoughts' &&
					e.preview?.includes('Lemon Herb Roast Chicken')
			)
		).toBe(false);
	});

	it('retrieves then auto-deletes when router passes a description as thought_id', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'delete_thought',
			arguments: { thought_id: 'Japanese glazed salmon recipe' }
		});
		mockDeleteRetrieve(
			[
				{
					id: 't-salmon',
					normalizedText: 'Japanese glazed salmon with mirin glaze',
					category: 'reference',
					score: STRONG_RETRIEVE_MATCH_MIN + 0.1
				}
			],
			['Japanese glazed salmon']
		);
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-salmon' });

		const result = await agentChat({
			userId: 'u1',
			messages: [
				{
					role: 'user',
					content: 'Can you please delete the Japanese glazed salmon recipe?'
				}
			]
		});

		expect(retrieveThoughtRowsForDeleteRequestMock).toHaveBeenCalledWith({
			userId: 'u1',
			deleteRequest: 'Can you please delete the Japanese glazed salmon recipe?'
		});
		expect(deleteThoughtMock).toHaveBeenCalledWith(expect.anything(), { thought_id: 't-salmon' });
		expect(result.response).toMatch(/deleted/i);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('auto-deletes after retrieve when LLM classifies delete intent and match is unique', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		mockDeleteRetrieve([
			{
				id: 't-del',
				normalizedText: 'Buy milk',
				category: 'task',
				score: STRONG_RETRIEVE_MATCH_MIN + 0.1
			}
		]);
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-del' });
		llmChatCompletionMock.mockResolvedValueOnce(
			llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'milk' } })
		);

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete the thought about milk' }]
		});

		expect(deleteThoughtMock).toHaveBeenCalledWith(expect.anything(), { thought_id: 't-del' });
		expect(result.response).toMatch(/deleted/i);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
	});

	it('resolves one delete target via LLM when multiple strong matches exist', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		mockDeleteRetrieve([
			{ id: 't-del', normalizedText: 'Buy milk', category: 'task', score: strongScore },
			{ id: 't-other', normalizedText: 'Buy eggs', category: 'task', score: strongScore }
		]);
		llmChatCompletionMock.mockResolvedValueOnce(
			llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'milk' } })
		);
		llmChatCompletionMock.mockResolvedValueOnce(llmJson({ thoughtIds: ['t-del'] }));
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-del' });

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete the thought about milk' }]
		});

		expect(deleteThoughtMock).toHaveBeenCalledWith(expect.anything(), { thought_id: 't-del' });
		expect(result.response).toMatch(/deleted/i);
	});

	it('runs semantic delete retrieval with LLM-derived content queries', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		mockDeleteRetrieve(
			[
				{
					id: 't-chicken',
					normalizedText: 'Recipe: Lemon Herb Roast Chicken',
					category: 'observation',
					score: 0.2
				}
			],
			['recipes cooking dishes meals', 'food ingredients preparation']
		);
		llmChatCompletionMock
			.mockResolvedValueOnce(llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'recipe' } }))
			.mockResolvedValueOnce(llmJson({ thoughtIds: ['t-chicken'] }));
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-chicken' });

		await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'please delete all my recipe notes' }]
		});

		expect(retrieveThoughtRowsForDeleteRequestMock).toHaveBeenCalledWith({
			userId: 'u1',
			deleteRequest: 'please delete all my recipe notes'
		});
		expect(retrieveThoughtsMock).not.toHaveBeenCalled();
	});

	it('resolves delete targets from weak-scored retrieve hits via LLM', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'delete_thought',
			arguments: { thought_id: 'recipe' }
		});
		const weakScore = STRONG_RETRIEVE_MATCH_MIN - 0.15;
		mockDeleteRetrieve([
			{
				id: 't-chicken',
				normalizedText: 'Recipe: Lemon Herb Roast Chicken',
				category: 'observation',
				score: weakScore
			}
		]);
		llmChatCompletionMock.mockResolvedValueOnce(llmJson({ thoughtIds: ['t-chicken'] }));
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-chicken' });

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete my recipe notes' }]
		});

		expect(deleteThoughtMock).toHaveBeenCalled();
		expect(result.response).toMatch(/deleted/i);
	});

	it('deletes multiple thoughts when the resolver returns several ids', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'delete_thought',
			arguments: { thought_id: 'all recipe notes' }
		});
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		mockDeleteRetrieve([
			{
				id: 't-chicken',
				normalizedText: 'Recipe: Lemon Herb Roast Chicken',
				category: 'observation',
				score: strongScore
			},
			{
				id: 't-salmon',
				normalizedText: 'Recipe: Japanese glazed salmon with mirin glaze',
				category: 'reference',
				score: strongScore
			},
			{
				id: 't-risotto',
				normalizedText: 'Recipe: Creamy Mushroom Risotto',
				category: 'observation',
				score: strongScore
			}
		]);
		llmChatCompletionMock.mockResolvedValueOnce(
			llmJson({ thoughtIds: ['t-chicken', 't-salmon', 't-risotto'] })
		);
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-chicken' });

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete all my recipe notes' }]
		});

		expect(deleteThoughtMock).toHaveBeenCalledTimes(3);
		expect(result.response).toMatch(/Deleted 3 thoughts/i);
	});

	it('picks the matching recipe via LLM among several strong candidates', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		routeAgentMessageMock.mockResolvedValue({
			mode: 'single_tool',
			tool: 'delete_thought',
			arguments: { thought_id: 'Japanese glazed salmon recipe' }
		});
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		mockDeleteRetrieve(
			[
				{
					id: 't-chicken',
					normalizedText: 'Recipe: Lemon Herb Roast Chicken',
					category: 'observation',
					score: strongScore
				},
				{
					id: 't-salmon',
					normalizedText: 'Recipe: Japanese glazed salmon with mirin glaze',
					category: 'reference',
					score: strongScore
				},
				{
					id: 't-risotto',
					normalizedText: 'Recipe: Creamy Mushroom Risotto',
					category: 'observation',
					score: strongScore
				}
			],
			['Japanese glazed salmon']
		);
		llmChatCompletionMock.mockResolvedValueOnce(llmJson({ thoughtIds: ['t-salmon'] }));
		deleteThoughtMock.mockResolvedValue({ deleted: true, thoughtId: 't-salmon' });

		const result = await agentChat({
			userId: 'u1',
			messages: [
				{
					role: 'user',
					content: 'Can you please delete the Japanese glazed salmon recipe?'
				}
			]
		});

		expect(deleteThoughtMock).toHaveBeenCalledWith(expect.anything(), { thought_id: 't-salmon' });
		expect(result.response).toMatch(/deleted/i);
	});

	it('parses thinking blocks, fenced JSON, and brace-matched tool calls', async () => {
		listThoughtsMock.mockResolvedValue({ thoughts: [] });
		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							content:
								'<think>Need to list thoughts</think>\n```json\n{"tool":"list_thoughts","arguments":{"limit":1}}\n```'
						}
					}
				]
			})
			.mockResolvedValueOnce(llmJson({ answer: 'Listed.' }));

		const events: string[] = [];
		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'show thoughts' }],
			onEvent: (event) => events.push(event.type)
		});

		expect(events).toContain('thinking');
		expect(listThoughtsMock).toHaveBeenCalled();
		expect(result.response).toBe('Listed.');
	});

	it('surfaces tool handler failures to the model and activity log', async () => {
		listThoughtsMock.mockRejectedValue(new Error('db unavailable'));
		llmChatCompletionMock
			.mockResolvedValueOnce(llmJson({ tool: 'list_thoughts', arguments: { limit: 1 } }))
			.mockResolvedValueOnce(llmJson({ answer: 'Recovered after tool error.' }));

		const events: Array<{ type: string; failed?: boolean }> = [];
		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'list' }],
			onEvent: (event) => events.push(event)
		});

		expect(events.some((e) => e.type === 'tool_result' && e.failed)).toBe(true);
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({ operation: 'tool_error.list_thoughts' })
		);
		expect(result.response).toBe('Recovered after tool error.');
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

	it('parses brace-matched JSON embedded in prose', async () => {
		listThoughtsMock.mockResolvedValue({ thoughts: [] });
		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							content:
								'I will list thoughts now. {"tool":"list_thoughts","arguments":{"limit":2}}'
						}
					}
				]
			})
			.mockResolvedValueOnce(llmJson({ answer: 'Done.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'list' }]
		});

		expect(listThoughtsMock).toHaveBeenCalled();
		expect(result.response).toBe('Done.');
	});

	it('treats non-object JSON and objects without tool/answer as final text', async () => {
		llmChatCompletionMock
			.mockResolvedValueOnce({ choices: [{ message: { content: '42' } }] })
			.mockResolvedValueOnce({ choices: [{ message: { content: '{"status":"ok"}' } }] });

		const numeric = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'one' }]
		});
		expect(numeric.response).toBe('42');

		const orphan = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'two' }]
		});
		expect(orphan.response).toBe('{"status":"ok"}');
	});

	it('returns fallback when the LLM response has no choices content', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [] });

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Hello' }]
		});

		expect(result.response).toMatch(/did not produce a response/i);
	});

	it('emits preparing label on follow-up iterations and forwards tool progress', async () => {
		listThoughtsMock.mockImplementation(async (ctx) => {
			ctx.onToolProgress?.({ tool: 'list_thoughts', phase: 'fetch', label: 'Loading…' });
			return { thoughts: [] };
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(llmJson({ tool: 'list_thoughts', arguments: { limit: 1 } }))
			.mockResolvedValueOnce(llmJson({ answer: 'All set.' }));

		const progressLabels: string[] = [];
		const events: Array<{ type: string; label?: string; phase?: string }> = [];
		await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'list thoughts' }],
			onEvent: (event) => {
				events.push(event);
				if (event.type === 'agent_progress') progressLabels.push(event.label);
				if (event.type === 'tool_progress') events.push(event);
			}
		});

		expect(progressLabels).toContain('Preparing your reply…');
		expect(events.some((e) => e.type === 'tool_progress' && e.phase === 'fetch')).toBe(true);
	});

	it('continues normally when delete handler is missing despite a strong match', async () => {
		classifyDeleteIntentMock.mockResolvedValue(true);
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		mockDeleteRetrieve([
			{ id: 't-del', normalizedText: 'Buy milk', category: 'task', score: strongScore }
		]);
		mcpToolMap.delete('delete_thought');
		llmChatCompletionMock.mockResolvedValueOnce(
			llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'milk' } })
		);

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'delete the thought about milk' }]
		});

		expect(deleteThoughtMock).not.toHaveBeenCalled();
		expect(result.response).toMatch(/could not find/i);
		mcpToolMap.set('delete_thought', deleteThoughtMock);
	});

	it('handles conversations without a user message for delete-intent detection', async () => {
		llmChatCompletionMock.mockResolvedValue(llmJson({ answer: 'Noted.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'assistant', content: 'Earlier reply' }]
		});

		expect(result.response).toBe('Noted.');
	});

	it('surfaces non-Error tool failures to the activity log', async () => {
		listThoughtsMock.mockRejectedValue('db string failure');
		llmChatCompletionMock
			.mockResolvedValueOnce(llmJson({ tool: 'list_thoughts', arguments: { limit: 1 } }))
			.mockResolvedValueOnce(llmJson({ answer: 'Handled.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'list' }]
		});

		expect(result.response).toBe('Handled.');
		expect(logActivityCallMock).toHaveBeenCalledWith(
			expect.anything(),
			'u1',
			expect.objectContaining({
				operation: 'tool_error.list_thoughts',
				context: 'limit: 1'
			})
		);
	});

	it('grounding mode allows one capture_grounding per user turn then requires answer', async () => {
		captureGroundingMock.mockResolvedValue({
			ok: true,
			facetKeys: ['work', 'routines'],
			facetCount: 2,
			suggestComplete: false
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({
					tool: 'capture_grounding',
					arguments: {
						facets: [{ key: 'work', content: 'Codes at SPACE Hamburg' }]
					}
				})
			)
			.mockResolvedValueOnce(
				llmJson({
					tool: 'capture_grounding',
					arguments: {
						facets: [{ key: 'routines', content: 'Cooks in the evening' }]
					}
				})
			)
			.mockResolvedValueOnce(
				llmJson({ answer: 'Thanks — what matters most to you outside of work?' })
			);

		const result = await agentChat({
			userId: 'u1',
			mode: 'grounding',
			messages: [{ role: 'user', content: 'I code at SPACE Hamburg and cook at night.' }]
		});

		expect(captureGroundingMock).toHaveBeenCalledTimes(1);
		expect(result.response).toBe('Thanks — what matters most to you outside of work?');
		expect(routeAgentMessageMock).not.toHaveBeenCalled();
	});
});
