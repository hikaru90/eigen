import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	llmChatCompletionMock,
	logActivityCallMock,
	retrieveThoughtsMock,
	deleteThoughtMock,
	editThoughtMock,
	captureThoughtMock,
	createTextFileMock,
	getDbMock,
	mcpToolMap
} = vi.hoisted(() => {
	const retrieveThoughtsMock = vi.fn();
	const deleteThoughtMock = vi.fn();
	const editThoughtMock = vi.fn();
	const captureThoughtMock = vi.fn();
	const createTextFileMock = vi.fn();
	const mcpToolMap = new Map<string, typeof retrieveThoughtsMock>([
		['retrieve_thoughts', retrieveThoughtsMock],
		['delete_thought', deleteThoughtMock],
		['edit_thought', editThoughtMock],
		['capture_thought', captureThoughtMock],
		['create_text_file', createTextFileMock]
	]);
	return {
		llmChatCompletionMock: vi.fn(),
		logActivityCallMock: vi.fn(),
		retrieveThoughtsMock,
		deleteThoughtMock,
		editThoughtMock,
		captureThoughtMock,
		createTextFileMock,
		getDbMock: vi.fn(),
		mcpToolMap
	};
});

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
	MCP_EXPOSED_TOOL_MAP: mcpToolMap,
	MCP_TOOL_MAP: mcpToolMap,
	MCP_AGENT_TOOL_NAMES: [
		'capture_thought',
		'retrieve_thoughts',
		'edit_thought',
		'delete_thought',
		'create_text_file',
		'list_text_files',
		'get_text_file',
		'update_text_file',
		'delete_text_file',
		'search_text_files',
		'link_text_file_to_thought',
		'unlink_text_file_from_thought'
	],
	MCP_EXPOSED_TOOL_DEFINITIONS: [],
	buildAgentToolDescriptionBlock: () => '',
	isAgentTool: (name: string) =>
		[
			'capture_thought',
			'retrieve_thoughts',
			'edit_thought',
			'delete_thought',
			'create_text_file',
			'list_text_files',
			'get_text_file',
			'update_text_file',
			'delete_text_file',
			'search_text_files',
			'link_text_file_to_thought',
			'unlink_text_file_from_thought'
		].includes(name)
}));

import { STRONG_RETRIEVE_MATCH_MIN } from './agent-tool-result-compact';
import { agentChat, AgentParseError } from './agent-loop';

function llmJson(payload: unknown) {
	return {
		choices: [{ message: { content: JSON.stringify(payload) } }]
	};
}

describe('agentChat', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		llmChatCompletionMock.mockReset();
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

	it('fails deterministically after repeated invalid model JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(llmJson({ unexpected: 'field' }));

		await expect(
			agentChat({
				userId: 'u1',
				messages: [{ role: 'user', content: 'Hi' }]
			})
		).rejects.toThrow(AgentParseError);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(3);
	});

	it('never returns raw tool JSON as the final response', async () => {
		llmChatCompletionMock.mockResolvedValue(
			llmJson({
				answer: '{"tool":"retrieve_thoughts","arguments":{"query":"schedule"}}'
			})
		);

		await expect(
			agentChat({
				userId: 'u1',
				messages: [{ role: 'user', content: 'What is on my schedule?' }]
			})
		).rejects.toThrow(AgentParseError);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(3);
	});

	it('executes a tool call and returns after the model answers', async () => {
		retrieveThoughtsMock.mockResolvedValue({ results: [{ id: 't1', snippet: 'Buy milk' }] });
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'milk', order: 'created_at' } })
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

		expect(retrieveThoughtsMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1' }),
			{ query: 'milk', order: 'created_at' }
		);
		expect(result.response).toBe('You have one recent thought.');
		expect(events).toContain('tool_call');
		expect(events).toContain('tool_result');
	});

	it('marks a thought done via retrieve then edit_thought', async () => {
		retrieveThoughtsMock.mockResolvedValue({
			results: [{ id: 't-done', snippet: 'Finish the grocery list', category: 'idea' }]
		});
		editThoughtMock.mockResolvedValue({
			thoughtId: 't-done',
			summary: 'Marked as completed.',
			after: { status: 'completed' }
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({ tool: 'retrieve_thoughts', arguments: { query: 'grocery' } })
			)
			.mockResolvedValueOnce(
				llmJson({
					tool: 'edit_thought',
					arguments: { thought_id: 't-done', edit_request: 'mark as done' }
				})
			)
			.mockResolvedValueOnce(llmJson({ answer: 'Marked the grocery thought as done.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'please mark this grocery thought as done' }]
		});

		expect(editThoughtMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ thought_id: 't-done', edit_request: 'mark as done' })
		);
		expect(result.response).toMatch(/done/i);
	});

	it('returns a fallback message when the model returns empty content', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Hello' }]
		});

		expect(result.response).toMatch(/did not produce a response/i);
	});

	it('fails deterministically when the model returns invalid JSON', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: 'Just plain text.' } }]
		});

		await expect(
			agentChat({
				userId: 'u1',
				messages: [{ role: 'user', content: 'Hello' }]
			})
		).rejects.toThrow(AgentParseError);
	});

	it('retries when the model requests an unknown tool', async () => {
		llmChatCompletionMock
			.mockResolvedValueOnce(llmJson({ tool: 'missing_tool', arguments: {} }))
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
		retrieveThoughtsMock.mockResolvedValue({
			results: [{ id: 't1', normalizedText: 'secret', embedding: vec }]
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(llmJson({ tool: 'retrieve_thoughts', arguments: {} }))
			.mockResolvedValueOnce(llmJson({ answer: 'ok' }));

		await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'list thoughts' }]
		});

		const sentMessages = llmChatCompletionMock.mock.calls[1]?.[0]?.messages as Array<{
			content: string;
		}>;
		const toolMsg = sentMessages.find((m) => m.content.includes('retrieve_thoughts'));
		expect(toolMsg?.content).not.toContain('0.1');
		expect(toolMsg?.content).not.toContain('"embedding"');
	});

	it('feeds compact tool results to the LLM on the next turn', async () => {
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

	it('deletes via retrieve then delete_thought when the model drives the loop', async () => {
		retrieveThoughtsMock.mockResolvedValue({
			results: [
				{
					id: 't-salmon',
					snippet: 'Japanese glazed salmon with mirin glaze',
					category: 'reference'
				}
			]
		});
		deleteThoughtMock.mockResolvedValue({ archived: true, thoughtId: 't-salmon' });
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({
					tool: 'retrieve_thoughts',
					arguments: { query: 'Japanese glazed salmon' }
				})
			)
			.mockResolvedValueOnce(
				llmJson({ tool: 'delete_thought', arguments: { thought_id: 't-salmon' } })
			)
			.mockResolvedValueOnce(llmJson({ answer: 'Deleted the salmon recipe.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [
				{
					role: 'user',
					content: 'Can you please delete the Japanese glazed salmon recipe?'
				}
			]
		});

		expect(deleteThoughtMock).toHaveBeenCalledWith(expect.anything(), {
			thought_id: 't-salmon'
		});
		expect(result.response).toMatch(/deleted/i);
	});

	it('parses thinking blocks, fenced JSON, and brace-matched tool calls', async () => {
		retrieveThoughtsMock.mockResolvedValue({ results: [] });
		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							content:
								'<think>Need to browse thoughts</think>\n```json\n{"tool":"retrieve_thoughts","arguments":{"order":"created_at","top_k":1}}\n```'
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
		expect(retrieveThoughtsMock).toHaveBeenCalled();
		expect(result.response).toBe('Listed.');
	});

	it('surfaces tool handler failures to the model and activity log', async () => {
		retrieveThoughtsMock.mockRejectedValue(new Error('db unavailable'));
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({ tool: 'retrieve_thoughts', arguments: { order: 'created_at' } })
			)
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
			expect.objectContaining({ operation: 'tool_error.retrieve_thoughts' })
		);
		expect(result.response).toBe('Recovered after tool error.');
	});

	it('returns the max-iteration fallback after too many tool loops', async () => {
		retrieveThoughtsMock.mockResolvedValue({ results: [] });
		llmChatCompletionMock.mockResolvedValue(
			llmJson({ tool: 'retrieve_thoughts', arguments: { order: 'created_at' } })
		);

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'Loop forever' }]
		});

		expect(result.response).toMatch(/too many steps/i);
	});

	it('parses brace-matched JSON embedded in prose', async () => {
		retrieveThoughtsMock.mockResolvedValue({ results: [] });
		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							content:
								'I will browse thoughts now. {"tool":"retrieve_thoughts","arguments":{"order":"created_at","top_k":2}}'
						}
					}
				]
			})
			.mockResolvedValueOnce(llmJson({ answer: 'Done.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'list' }]
		});

		expect(retrieveThoughtsMock).toHaveBeenCalled();
		expect(result.response).toBe('Done.');
	});

	it('fails deterministically for non-object JSON and objects without tool/answer', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '42' } }] });

		await expect(
			agentChat({
				userId: 'u1',
				messages: [{ role: 'user', content: 'one' }]
			})
		).rejects.toThrow(AgentParseError);

		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: '{"status":"ok"}' } }]
		});

		await expect(
			agentChat({
				userId: 'u1',
				messages: [{ role: 'user', content: 'two' }]
			})
		).rejects.toThrow(AgentParseError);
	});

	it('normalizes thought_id aliases for edit_thought', async () => {
		editThoughtMock.mockResolvedValue({
			thoughtId: 't1',
			summary: 'Updated.',
			after: { status: 'open' }
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({
					tool: 'edit_thought',
					arguments: { id: 't1', edit_request: 'fix typo' }
				})
			)
			.mockResolvedValueOnce(llmJson({ answer: 'Fixed.' }));

		await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'fix the typo' }]
		});

		expect(editThoughtMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ thought_id: 't1', edit_request: 'fix typo' })
		);
	});

	it('captures via capture_thought when the model chooses it', async () => {
		captureThoughtMock.mockResolvedValue({ thoughtId: 't-new', status: 'queued' });
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({ tool: 'capture_thought', arguments: { raw: 'I love mirin' } })
			)
			.mockResolvedValueOnce(llmJson({ answer: 'Saved.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'remember that I love mirin' }]
		});

		expect(captureThoughtMock).toHaveBeenCalledWith(expect.anything(), {
			raw: 'I love mirin'
		});
		expect(result.response).toBe('Saved.');
	});

	it('creates a text note via create_text_file when the model chooses it', async () => {
		createTextFileMock.mockResolvedValue({
			textFileId: 'f1',
			textFile: { id: 'f1', title: 'Shopping', body: 'eggs' }
		});
		llmChatCompletionMock
			.mockResolvedValueOnce(
				llmJson({
					tool: 'create_text_file',
					arguments: { title: 'Shopping', body: 'eggs' }
				})
			)
			.mockResolvedValueOnce(llmJson({ answer: 'Note created.' }));

		const result = await agentChat({
			userId: 'u1',
			messages: [{ role: 'user', content: 'add a note titled Shopping: eggs' }]
		});

		expect(createTextFileMock).toHaveBeenCalledWith(expect.anything(), {
			title: 'Shopping',
			body: 'eggs'
		});
		expect(captureThoughtMock).not.toHaveBeenCalled();
		expect(result.response).toBe('Note created.');
	});
});
