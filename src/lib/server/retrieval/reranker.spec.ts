import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rerankCandidates } from './reranker';
import type { RerankCandidate } from './reranker';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function makeResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

const candidates: RerankCandidate[] = [
	{ id: 'a', normalizedText: 'Anna pushed back on Q3 pricing', score: 0.9 },
	{ id: 'b', normalizedText: 'Marcus sent the contract yesterday', score: 0.8 },
	{ id: 'c', normalizedText: 'Meeting notes from Monday standup', score: 0.7 }
];

describe('rerankCandidates', () => {
	beforeEach(() => vi.clearAllMocks());

	it('reorders candidates according to LLM ranked IDs', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('["c", "a", "b"]'));

		const result = await rerankCandidates('u1', 'standup notes', candidates);
		expect(result.map((r) => r.id)).toEqual(['c', 'a', 'b']);
	});

	it('returns original order when LLM returns invalid JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('not valid json'));
		const result = await rerankCandidates('u1', 'query', candidates);
		expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});

	it('returns original order when LLM call fails', async () => {
		llmChatCompletionMock.mockRejectedValue(new Error('LLM error'));
		const result = await rerankCandidates('u1', 'query', candidates);
		expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});

	it('returns original order when LLM returns non-array JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('{"ids": ["a","b"]}'));
		const result = await rerankCandidates('u1', 'query', candidates);
		expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});

	it('returns input unchanged for single candidate', async () => {
		const single = [candidates[0]];
		const result = await rerankCandidates('u1', 'query', single);
		expect(result).toEqual(single);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('places candidates with unknown IDs at the end', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('["b"]')); // only returns one ID
		const result = await rerankCandidates('u1', 'query', candidates);
		// b first (ranked), then a and c in their relative original order
		expect(result[0].id).toBe('b');
	});

	it('includes recent context in the prompt when provided', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('["a","b","c"]'));

		await rerankCandidates('u1', 'pricing discussion', candidates, [
			{ normalizedText: 'Just had a call with Anna about next quarter' }
		]);

		const call = llmChatCompletionMock.mock.calls.at(-1)![0];
		const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
		expect(userMsg.content).toContain('Anna about next quarter');
	});

	it('strips markdown code fences from LLM response', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('```json\n["c","b","a"]\n```'));
		const result = await rerankCandidates('u1', 'query', candidates);
		expect(result.map((r) => r.id)).toEqual(['c', 'b', 'a']);
	});

	it('preserves all candidate fields in output', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('["b","a","c"]'));
		const result = await rerankCandidates('u1', 'query', candidates);
		expect(result[0]).toEqual(candidates[1]); // b
		expect(result[1]).toEqual(candidates[0]); // a
	});
});
