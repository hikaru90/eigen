import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import {
	composeAnswer,
	extractRetrievalHints,
	findInvalidCitationIds,
	narrowComposeContextToQuestionFocus
} from './compose-answer';

const {
	searchThoughtsMock,
	llmChatCompletionMock,
	findTemporalSchedulingConflictsMock,
	createThoughtEmbeddingMock,
	lexicalSearchMock,
	graphOnlySearchByQueryMock
} = vi.hoisted(() => ({
	searchThoughtsMock: vi.fn(),
	llmChatCompletionMock: vi.fn(),
	findTemporalSchedulingConflictsMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	lexicalSearchMock: vi.fn(),
	graphOnlySearchByQueryMock: vi.fn()
}));

vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/retrieval/lexical', () => ({
	lexicalSearch: lexicalSearchMock
}));

vi.mock('$lib/server/graph/age', () => ({
	graphOnlySearchByQuery: graphOnlySearchByQueryMock
}));

vi.mock('$lib/server/retrieval/temporal-conflicts', () => ({
	findTemporalSchedulingConflicts: findTemporalSchedulingConflictsMock,
	formatTemporalConflictsForPrompt: (conflicts: unknown[]) =>
		conflicts.length > 0 ? '\n\nTemporal scheduling conflicts (from memory graph):\n' : '',
	isSchedulingConflictQuery: (q: string) => /conflict|scheduling/i.test(q)
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn().mockReturnValue({
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		})
	})
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
		createdAt: FIXED_DATE,
		memoryType: null
	},
	{
		id: 't_002',
		normalizedText: 'Tartine sells day-old loaves for half price after 3pm.',
		category: 'memory',
		score: 0.71,
		vectorScore: 0.75,
		graphScore: 0.6,
		metadata: {},
		createdAt: FIXED_DATE,
		memoryType: null
	}
];

describe('narrowComposeContextToQuestionFocus', () => {
	it('keeps only thoughts that mention the question name token', () => {
		const out = narrowComposeContextToQuestionFocus('Wer ist Clemi?', [
			{
				id: 'a',
				normalizedText: 'annie ist meine schwester',
				category: 'reference',
				score: 1,
				vectorScore: 1,
				graphScore: 0,
				createdAt: FIXED_DATE,
				isStale: false
			},
			{
				id: 'b',
				normalizedText: 'clemi ist clemens',
				category: 'reference',
				score: 1,
				vectorScore: 1,
				graphScore: 0,
				createdAt: FIXED_DATE,
				isStale: false
			}
		]);
		expect(out).toHaveLength(1);
		expect(out[0].id).toBe('b');
	});
});

describe('findInvalidCitationIds', () => {
	it('flags citation ids not in the allow-list', () => {
		const invalid = findInvalidCitationIds('Fact [a] and bad [z]', new Set(['a']));
		expect(invalid).toEqual(['z']);
	});
});

describe('extractRetrievalHints', () => {
	it('extracts name tokens from short German questions', () => {
		expect(extractRetrievalHints('Wer ist Clemi?')).toBe('clemi');
	});

	it('returns undefined when hints equal the full normalized question', () => {
		expect(extractRetrievalHints('clemi')).toBeUndefined();
	});
});

describe('composeAnswer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		searchThoughtsMock.mockResolvedValue(sampleRetrieval);
		findTemporalSchedulingConflictsMock.mockResolvedValue([]);
		createThoughtEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.1));
		lexicalSearchMock.mockResolvedValue([]);
		graphOnlySearchByQueryMock.mockResolvedValue([]);
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

	it('emits onProgress for embedding, searching, and composing', async () => {
		const phases: string[] = [];
		await composeAnswer({
			userId: 'u1',
			question: 'what about rice flour?',
			onProgress: (phase) => {
				phases.push(phase);
			}
		});
		expect(phases).toEqual(['embedding', 'searching', 'composing']);
	});

	it('returns an answer with citations from the retrieved set', async () => {
		const result = await composeAnswer({ userId: 'u1', question: 'what about rice flour?' });
		expect(result.answer).toContain('[t_001]');
		expect(result.citations).toEqual(expect.arrayContaining(['t_001', 't_002']));
		expect(result.retrieved).toHaveLength(2);
		expect(result.retrieved[0].id).toBe('t_001');
		expect(result.conflicts).toBeDefined();
	});

	it('runs hybrid, hint, lexical, and entity-label retrieval for who-is questions', async () => {
		searchThoughtsMock.mockResolvedValue([
			{
				id: 'b',
				normalizedText: 'clemi ist clemens',
				category: 'reference',
				score: 1,
				vectorScore: 1,
				graphScore: 0,
				metadata: {},
				createdAt: FIXED_DATE,
				memoryType: null
			}
		]);
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse('Answer: Clemi is Clemens.\nEvidence:\n- Clemi is Clemens [b]\n\nUnknown:\n- none')
		);
		await composeAnswer({ userId: 'u1', question: 'Wer ist Clemi?' });
		expect(createThoughtEmbeddingMock).toHaveBeenCalled();
		expect(searchThoughtsMock).toHaveBeenCalledTimes(2);
		expect(searchThoughtsMock).toHaveBeenCalledWith(
			expect.objectContaining({ query: 'Wer ist Clemi?', queryEmbedding: expect.any(Array) })
		);
		expect(searchThoughtsMock).toHaveBeenCalledWith(
			expect.objectContaining({ query: 'clemi', queryEmbedding: expect.any(Array) })
		);
		expect(lexicalSearchMock).toHaveBeenCalledWith(
			expect.objectContaining({ query: 'clemi' })
		);
		expect(graphOnlySearchByQueryMock).toHaveBeenCalledWith(
			expect.objectContaining({ query: 'clemi' })
		);
	});

	it('omits unrelated retrieved thoughts from the compose prompt for named-entity questions', async () => {
		searchThoughtsMock.mockResolvedValue([
			{
				id: '38b31459-ba6a-4e59-ac4e-1bf3039d142b',
				normalizedText: 'annie ist meine schwester',
				category: 'reference',
				score: 0.03,
				vectorScore: 0.02,
				graphScore: 0.01,
				metadata: { graphProvenance: 'entity:schwester' },
				createdAt: FIXED_DATE
			}
		]);
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse('Answer: Not in memory.\nEvidence:\n\nUnknown:\n- Wer ist Clemi?')
		);
		await composeAnswer({ userId: 'u1', question: 'Wer ist Clemi?' });
		const userMsg = (
			llmChatCompletionMock.mock.calls[0][0] as {
				messages: Array<{ role: string; content: string }>;
			}
		).messages[1].content;
		expect(userMsg).toContain('(no thoughts retrieved)');
		expect(userMsg).not.toContain('annie');
	});

	it('forwards topK, weights, and trimmed question to searchThoughts', async () => {
		await composeAnswer({
			userId: 'u1',
			question: '   what about graph weights?  ',
			topK: 5,
			weights: { vector: 0.4, graph: 0.6 }
		});
		expect(searchThoughtsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				query: 'what about graph weights?',
				topK: 5,
				weights: { vector: 0.4, graph: 0.6 },
				queryEmbedding: expect.any(Array)
			})
		);
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

	it('throws when the answer cites ids outside the retrieved set', async () => {
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse('Some claim [t_001] but also a hallucinated [t_999].')
		);
		await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
			'cites thought ids not in retrieved context'
		);
	});

	it('embeds hint queries separately from the full question', async () => {
		searchThoughtsMock.mockResolvedValue([
			{
				id: 'b',
				normalizedText: 'clemi ist clemens',
				category: 'reference',
				score: 1,
				vectorScore: 1,
				graphScore: 0,
				metadata: {},
				createdAt: FIXED_DATE,
				memoryType: null
			}
		]);
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse('Answer: Clemi is Clemens.\nEvidence:\n- Clemi is Clemens [b]\n\nUnknown:\n- none')
		);
		createThoughtEmbeddingMock.mockImplementation(async (_userId: string, text: string) => {
			return text.toLowerCase().includes('clemi') && !text.includes('?') ? [0.9] : [0.1];
		});
		await composeAnswer({ userId: 'u1', question: 'Wer ist Clemi?' });
		expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(2);
		expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'Wer ist Clemi?');
		expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'clemi');
		const hintCall = searchThoughtsMock.mock.calls.find(
			(call) => (call[0] as { query: string }).query === 'clemi'
		);
		const questionCall = searchThoughtsMock.mock.calls.find(
			(call) => (call[0] as { query: string }).query === 'Wer ist Clemi?'
		);
		expect(hintCall?.[0].queryEmbedding).toEqual([0.9]);
		expect(questionCall?.[0].queryEmbedding).toEqual([0.1]);
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
		searchThoughtsMock.mockResolvedValue([
			{
				id: 't_003',
				normalizedText: 'Connected via Marcus.',
				category: 'thought',
				score: 0.5,
				vectorScore: 0.4,
				graphScore: 0.1,
				metadata: { graphProvenance: 'entity:Marcus' },
				createdAt: FIXED_DATE,
				memoryType: null
			}
		]);
		llmChatCompletionMock.mockResolvedValueOnce(
			chatResponse('Answer: Connected via Marcus.\nEvidence:\n- Link [t_003]\n\nUnknown:\n- none')
		);
		const result = await composeAnswer({ userId: 'u1', question: 'how is this connected?' });
		expect(result.retrieved[0].graphProvenance).toBe('entity:Marcus');
		const userMessage = (
			llmChatCompletionMock.mock.calls[0][0] as {
				messages: Array<{ role: string; content: string }>;
			}
		).messages[1].content;
		expect(userMessage).toContain('Graph: entity:Marcus');
	});

	it('includes temporal graph conflicts in the prompt when detected', async () => {
		findTemporalSchedulingConflictsMock.mockResolvedValueOnce([
			{
				personEntityId: 'ent-tom',
				personLabel: 'Tom',
				events: [],
				mandatoryThoughtIds: ['t_mandatory'],
				thoughtIds: ['t_tom', 't_berlin', 't_mandatory'],
				description: 'Tom has overlapping events in Lisbon and Berlin'
			}
		]);
		await composeAnswer({ userId: 'u1', question: 'Is there a scheduling conflict?' });
		expect(findTemporalSchedulingConflictsMock).toHaveBeenCalled();
		const userMessage = (
			llmChatCompletionMock.mock.calls[0][0] as { messages: Array<{ content: string }> }
		).messages[1].content;
		expect(userMessage).toContain('Temporal scheduling conflicts');
	});
});
