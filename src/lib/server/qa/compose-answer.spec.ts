import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { composeAnswer, detectContradictions, type RetrievalContextItem } from './compose-answer';

const { searchThoughtsMock, llmChatCompletionMock } = vi.hoisted(() => ({
	searchThoughtsMock: vi.fn(),
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function chatResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

const sampleRetrieval = [
	{
		id: 't_001',
		normalizedText: 'Marcus suggested rice flour for the banneton.',
		category: 'idea',
		score: 0.82,
		vectorScore: 0.9,
		graphScore: 0.5,
		metadata: {},
		createdAt: FIXED_DATE
	},
	{
		id: 't_002',
		normalizedText: 'Tartine sells day-old loaves for half price after 3pm.',
		category: 'memory',
		score: 0.71,
		vectorScore: 0.75,
		graphScore: 0.6,
		metadata: {},
		createdAt: FIXED_DATE
	}
];

describe('composeAnswer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		searchThoughtsMock.mockResolvedValue(sampleRetrieval);
		llmChatCompletionMock.mockResolvedValue(
			chatResponse('Marcus suggested rice flour [t_001]. Also, Tartine has half-price loaves [t_002].')
		);
	});

	it('rejects empty questions before doing any work', async () => {
		await expect(composeAnswer({ userId: 'u1', question: '   ' })).rejects.toThrow(
			'composeAnswer: question must be non-empty'
		);
		expect(searchThoughtsMock).not.toHaveBeenCalled();
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('returns an answer with citations from the retrieved set', async () => {
		const result = await composeAnswer({ userId: 'u1', question: 'what about rice flour?' });
		expect(result.answer).toContain('[t_001]');
		expect(result.citations).toEqual(expect.arrayContaining(['t_001', 't_002']));
		expect(result.retrieved).toHaveLength(2);
		expect(result.retrieved[0].id).toBe('t_001');
		expect(result.conflicts).toBeDefined();
	});

	it('forwards topK, weights, and trimmed question to searchThoughts', async () => {
		await composeAnswer({
			userId: 'u1',
			question: '   what about graph weights?  ',
			topK: 5,
			weights: { vector: 0.4, graph: 0.6 }
		});
		expect(searchThoughtsMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'what about graph weights?',
			topK: 5,
			weights: { vector: 0.4, graph: 0.6 }
		});
	});

	it('uses default topK of 8 when not provided', async () => {
		await composeAnswer({ userId: 'u1', question: 'x' });
		expect(searchThoughtsMock).toHaveBeenCalledWith(
			expect.objectContaining({ topK: 8, weights: CONTEXT_WEIGHTS.default })
		);
	});

	it('merges retrievalQuery search with question search when they differ', async () => {
		searchThoughtsMock
			.mockResolvedValueOnce([sampleRetrieval[1]])
			.mockResolvedValueOnce([sampleRetrieval[0]]);
		const result = await composeAnswer({
			userId: 'u1',
			question: 'scheduling conflict?',
			retrievalQuery: 'March schedule conflicts team'
		});
		expect(searchThoughtsMock).toHaveBeenCalledTimes(2);
		expect(searchThoughtsMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ query: 'scheduling conflict?' })
		);
		expect(searchThoughtsMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ query: 'March schedule conflicts team' })
		);
		expect(result.retrieved.map((r) => r.id)).toEqual(expect.arrayContaining(['t_001', 't_002']));
	});

	it('passes a system + user message pair with temperature 0', async () => {
		await composeAnswer({ userId: 'u1', question: 'why rice flour' });
		const args = llmChatCompletionMock.mock.calls[0][0] as {
			userId: string;
			messages: Array<{ role: string; content: string }>;
			temperature: number;
		};
		expect(args.userId).toBe('u1');
		expect(args.temperature).toBe(0);
		expect(args.messages).toHaveLength(2);
		expect(args.messages[0].role).toBe('system');
		expect(args.messages[1].role).toBe('user');
		expect(args.messages[1].content).toContain('why rice flour');
		expect(args.messages[1].content).toContain('id=t_001');
		expect(args.messages[1].content).toContain('id=t_002');
	});

	it('communicates the no-thoughts case to the prompt without crashing', async () => {
		searchThoughtsMock.mockResolvedValueOnce([]);
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse('I do not have enough information to answer.')
		);
		const result = await composeAnswer({ userId: 'u1', question: 'totally novel question' });
		expect(result.retrieved).toEqual([]);
		expect(result.citations).toEqual([]);
		expect(result.answer).toContain('do not have enough');
		const userMessage = (
			llmChatCompletionMock.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }
		).messages[1].content;
		expect(userMessage).toContain('(no thoughts retrieved)');
	});

	it('drops citations to ids that are not in the retrieved set', async () => {
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse('Some claim [t_001] but also a hallucinated [t_999].')
		);
		const result = await composeAnswer({ userId: 'u1', question: 'q' });
		expect(result.citations).toEqual(['t_001']);
		expect(result.citations).not.toContain('t_999');
	});

	it('throws a clear error when the LLM response shape is unexpected', async () => {
		llmChatCompletionMock.mockResolvedValueOnce(null);
		await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
			'LLM chat response is not an object'
		);
	});

	it('throws when the response has no choices', async () => {
		llmChatCompletionMock.mockResolvedValueOnce({ choices: [] });
		await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
			'LLM chat response has no choices'
		);
	});

	it('throws when a choice has no message', async () => {
		llmChatCompletionMock.mockResolvedValueOnce({ choices: [{}] });
		await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
			'LLM chat response choice has no message'
		);
	});

	it('throws when message content is missing or empty', async () => {
		llmChatCompletionMock.mockResolvedValueOnce({ choices: [{ message: { content: '   ' } }] });
		await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
			'LLM chat response content is empty'
		);
		llmChatCompletionMock.mockResolvedValueOnce({ choices: [{ message: { content: 123 } }] });
		await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
			'LLM chat response content is empty'
		);
	});

	it('surfaces graphProvenance from retrieval metadata into the prompt and context items', async () => {
		searchThoughtsMock.mockResolvedValueOnce([
			{
				id: 't_003',
				normalizedText: 'Connected via Marcus.',
				category: 'thought',
				score: 0.5,
				vectorScore: 0.4,
				graphScore: 0.1,
				metadata: { graphProvenance: 'entity:Marcus' },
				createdAt: FIXED_DATE
			}
		]);
		const result = await composeAnswer({ userId: 'u1', question: 'how is this connected?' });
		expect(result.retrieved[0].graphProvenance).toBe('entity:Marcus');
		const userMessage = (
			llmChatCompletionMock.mock.calls[0][0] as {
				messages: Array<{ role: string; content: string }>;
			}
		).messages[1].content;
		expect(userMessage).toContain('Graph: entity:Marcus');
	});

	it('injects scheduling-conflict instructions into the LLM prompt', async () => {
		searchThoughtsMock.mockResolvedValueOnce([
			{
				id: 't_tom',
				normalizedText: 'Tom is moving to Lisbon in March.',
				category: 'memory',
				score: 0.9,
				vectorScore: 0.9,
				graphScore: 0,
				metadata: {},
				createdAt: FIXED_DATE
			},
			{
				id: 't_berlin',
				normalizedText: 'The team offsite is planned for March in Berlin.',
				category: 'memory',
				score: 0.85,
				vectorScore: 0.85,
				graphScore: 0,
				metadata: {},
				createdAt: FIXED_DATE
			},
			{
				id: 't_mandatory',
				normalizedText:
					'Offsite attendance is mandatory for all senior staff. Tom is a senior engineer.',
				category: 'reference',
				score: 0.8,
				vectorScore: 0.8,
				graphScore: 0,
				metadata: {},
				createdAt: FIXED_DATE
			}
		]);
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse(
				"Answer: Tom's move to Lisbon clashes with the mandatory Berlin offsite in March.\nEvidence:\n- Tom is moving to Lisbon in March [t_tom]\nUnknown:\n- none"
			)
		);
		await composeAnswer({ userId: 'u1', question: 'Is there a scheduling conflict?' });
		const userMessage = (
			llmChatCompletionMock.mock.calls[0][0] as { messages: Array<{ content: string }> }
		).messages[1].content;
		expect(userMessage).toContain('Detected scheduling conflict');
		expect(userMessage).toContain('Do NOT list whether the conflict exists under Unknown');
	});
});

describe('detectContradictions', () => {
	const now = FIXED_DATE;

	it('flags relocation vs mandatory offsite in another city', () => {
		const items: RetrievalContextItem[] = [
			{
				id: 't_tom',
				normalizedText: 'Tom is moving to Lisbon in March.',
				category: 'thought',
				score: 1,
				vectorScore: 1,
				graphScore: 0,
				createdAt: now
			},
			{
				id: 't_berlin',
				normalizedText: 'The team offsite is planned for March in Berlin.',
				category: 'thought',
				score: 1,
				vectorScore: 1,
				graphScore: 0,
				createdAt: now
			},
			{
				id: 't_mandatory',
				normalizedText: 'Offsite attendance is mandatory for all senior staff. Tom is a senior engineer.',
				category: 'thought',
				score: 1,
				vectorScore: 1,
				graphScore: 0,
				createdAt: now
			}
		];
		const conflicts = detectContradictions(items);
		const scheduling = conflicts.find((c) => c.kind === 'scheduling');
		expect(scheduling).toBeDefined();
		expect(scheduling!.ids).toContain('t_tom');
		expect(scheduling!.ids).toContain('t_berlin');
		expect(scheduling!.relatedIds).toContain('t_mandatory');
	});
});
