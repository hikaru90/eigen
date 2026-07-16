import { describe, expect, it } from 'vitest';
import {
	buildAgentHistoryFromSessionMessages,
	sessionMessagesToAgentHistory,
	trimAgentHistory
} from './session-history-for-agent';
import type { PersistedChatMessage } from '$lib/chat/normalize-messages';

describe('buildAgentHistoryFromSessionMessages', () => {
	it('maps user + tool_step + final answer into agent loop message shape', () => {
		const rows: PersistedChatMessage[] = [
			{ role: 'user', content: 'add a shopping list note' },
			{
				role: 'assistant',
				content: '{"text_file_id":"abc","title":"shopping list"}',
				metadata: {
					variant: 'tool_step',
					tool: 'create_text_file',
					arguments: { title: 'shopping list', body: '' },
					displaySummary: 'Created note'
				}
			},
			{ role: 'assistant', content: "I've added your shopping list note." }
		];

		const history = buildAgentHistoryFromSessionMessages(rows);
		expect(history).toEqual([
			{ role: 'user', content: 'add a shopping list note' },
			{
				role: 'assistant',
				content: JSON.stringify({
					tool: 'create_text_file',
					arguments: { title: 'shopping list', body: '' }
				})
			},
			{
				role: 'user',
				content: expect.stringContaining('Tool result for create_text_file:')
			},
			{
				role: 'assistant',
				content: JSON.stringify({ answer: "I've added your shopping list note." })
			}
		]);
		expect(history[2].content).toContain('{"text_file_id":"abc","title":"shopping list"}');
	});

	it('skips thinking / executing / progress and pairs legacy tool_call + tool_result', () => {
		const rows: PersistedChatMessage[] = [
			{ role: 'user', content: 'remember milk' },
			{ role: 'assistant', content: 'planning', metadata: { variant: 'thinking' } },
			{
				role: 'assistant',
				content: '{"tool":"capture_thought"}',
				metadata: {
					variant: 'tool_call',
					tool: 'capture_thought',
					arguments: { raw: 'milk' }
				}
			},
			{
				role: 'assistant',
				content: 'capture_thought',
				metadata: { variant: 'tool_executing', tool: 'capture_thought' }
			},
			{
				role: 'assistant',
				content: 'Saving…',
				metadata: { variant: 'tool_progress', tool: 'capture_thought', label: 'Saving…' }
			},
			{
				role: 'assistant',
				content: '{"thought_id":"t1"}',
				metadata: { variant: 'tool_result', tool: 'capture_thought' }
			},
			{ role: 'assistant', content: 'Saved.' }
		];

		const history = buildAgentHistoryFromSessionMessages(rows);
		expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
		expect(history[1].content).toContain('capture_thought');
		expect(history[2].content).toContain('Tool result for capture_thought:');
		expect(history[2].content).toContain('{"thought_id":"t1"}');
		expect(history[3].content).toBe(JSON.stringify({ answer: 'Saved.' }));
	});

	it('does not include a current-turn user row that was never passed in', () => {
		const priorOnly: PersistedChatMessage[] = [
			{ role: 'user', content: 'first' },
			{ role: 'assistant', content: 'ok' }
		];
		const history = buildAgentHistoryFromSessionMessages(priorOnly);
		expect(history).toHaveLength(2);
		expect(history.some((m) => m.content === 'second turn')).toBe(false);
	});
});

describe('trimAgentHistory', () => {
	it('drops oldest messages until under budget and skips dangling tool-result prefix', () => {
		const toolResult =
			'Tool result for retrieve_thoughts:\n{"hits":[]}\n\nIf more tools are needed, call one now. Otherwise give your final answer using {"answer": "<your response>"}.';
		const messages = [
			{ role: 'user' as const, content: 'old-user-aaaaaaaa' },
			{
				role: 'assistant' as const,
				content: JSON.stringify({ tool: 'retrieve_thoughts', arguments: {} })
			},
			{ role: 'user' as const, content: toolResult },
			{ role: 'assistant' as const, content: JSON.stringify({ answer: 'done' }) },
			{ role: 'user' as const, content: 'follow-up' }
		];
		// Budget keeps only the last user message after dropping a leading tool-result pair mid-cut.
		const trimmed = trimAgentHistory(messages, toolResult.length + 5);
		expect(trimmed.some((m) => m.content === 'follow-up')).toBe(true);
		expect(trimmed[0]?.content.startsWith('Tool result for ')).toBe(false);
		expect(trimmed.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(
			toolResult.length + 5
		);
	});
});

describe('sessionMessagesToAgentHistory', () => {
	it('builds and trims in one step', () => {
		const rows: PersistedChatMessage[] = [
			{ role: 'user', content: 'a'.repeat(100) },
			{ role: 'assistant', content: 'b'.repeat(100) },
			{ role: 'user', content: 'latest' }
		];
		const history = sessionMessagesToAgentHistory(rows, 50);
		expect(history.some((m) => m.content === 'latest')).toBe(true);
		expect(history.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(50);
	});
});
