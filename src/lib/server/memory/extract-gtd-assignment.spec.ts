import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractGtdAssignment, parseGtdAssignmentPayload } from './extract-gtd-assignment';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

vi.mock('$lib/server/memory/project-next-action', () => ({
	linkThoughtToProject: vi.fn(async () => undefined),
	designateNextAction: vi.fn(async () => undefined)
}));

function makeResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('extractGtdAssignment', () => {
	beforeEach(() => vi.clearAllMocks());

	it('rejects project ids not in the catalog', () => {
		const allowed = new Set(['p1']);
		expect(
			parseGtdAssignmentPayload(
				{ projectEntityId: 'other-id', isNextAction: true },
				allowed
			)
		).toEqual({ projectEntityId: null, isNextAction: true });
	});

	it('parses valid project assignment from LLM JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse(
				JSON.stringify({
					projectEntityId: 'p1',
					isNextAction: true
				})
			)
		);

		const result = await extractGtdAssignment({
			userId: 'u1',
			normalizedText: 'Call Marcus about the proposal',
			projects: [{ entityId: 'p1', label: 'Eigen Mesh', status: 'active' }]
		});

		expect(result).toEqual({ projectEntityId: 'p1', isNextAction: true });
	});
});
