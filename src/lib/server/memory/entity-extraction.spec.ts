import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	extractEntityMentions,
	extractEntityTriples,
	parseEntityMentions,
	parseEntityTriples
} from './entity-extraction';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

const ONTOLOGY_KINDS_FOR_TESTS = [
	{ key: 'perception', name: 'Perception', definition: 'Sensory intake' },
	{ key: 'memory', name: 'Memory', definition: 'Past experience' },
	{ key: 'emotion', name: 'Emotion', definition: 'Feeling' }
];

const ALLOWED_TEST_KEYS = new Set(ONTOLOGY_KINDS_FOR_TESTS.map((k) => k.key));

describe('parseEntityMentions', () => {
	it('parses and filters types not in the ontology key set', () => {
		const out = parseEntityMentions(
			'[{"surface":"  Sam  ","entityType":"perception","confidence":0.9},{"surface":"X","entityType":"person","confidence":1}]',
			ALLOWED_TEST_KEYS
		);
		expect(out).toEqual([{ surface: 'Sam', entityType: 'perception', confidence: 0.9 }]);
	});

	it('drops entries that are not objects or are missing surface', () => {
		const out = parseEntityMentions(
			'["bad", null, {"surface":"","entityType":"memory","confidence":1}, {"surface":"Alex","entityType":"memory"}]',
			ALLOWED_TEST_KEYS
		);
		expect(out).toEqual([{ surface: 'Alex', entityType: 'memory', confidence: 0 }]);
	});

	it('drops entries where surface or entityType are not strings', () => {
		const out = parseEntityMentions(
			'[{"surface":42,"entityType":"perception","confidence":1},{"surface":"Alex","entityType":42,"confidence":1}]',
			ALLOWED_TEST_KEYS
		);
		expect(out).toEqual([]);
	});

	it('clamps numeric confidence outside [0,1] and treats non-numeric as 0', () => {
		const out = parseEntityMentions(
			'[{"surface":"A","entityType":"emotion","confidence":5},{"surface":"B","entityType":"emotion","confidence":-3},{"surface":"C","entityType":"emotion","confidence":"x"},{"surface":"D","entityType":"emotion","confidence":null}]',
			ALLOWED_TEST_KEYS
		);
		expect(out.map((m) => m.confidence)).toEqual([1, 0, 0, 0]);
	});

	it('throws when JSON is not an array', () => {
		expect(() => parseEntityMentions('{"surface":"A"}', ALLOWED_TEST_KEYS)).toThrow(/must be a JSON array/);
	});
});

describe('parseEntityTriples', () => {
	it('keeps triples whose endpoints are allowed surfaces', () => {
		const allowed = new Set(['Sam', 'Berlin']);
		const out = parseEntityTriples(
			'[{"subject":"Sam","object":"Berlin","predicate":"located_in","confidence":0.8},{"subject":"Sam","object":"Mars","predicate":"located_in","confidence":0.8}]',
			allowed
		);
		expect(out).toHaveLength(1);
		expect(out[0].predicate).toBe('located_in');
	});

	it('drops entries with invalid predicate or empty endpoints', () => {
		const allowed = new Set(['A', 'B']);
		const out = parseEntityTriples(
			'[{"subject":"A","object":"B","predicate":"invented"},{"subject":"","object":"B","predicate":"related_to"},"bad"]',
			allowed
		);
		expect(out).toEqual([]);
	});

	it('drops entries with non-string subject, object, or predicate fields', () => {
		const allowed = new Set(['A', 'B']);
		const out = parseEntityTriples(
			'[{"subject":1,"object":"B","predicate":"related_to"},{"subject":"A","object":2,"predicate":"related_to"},{"subject":"A","object":"B","predicate":3}]',
			allowed
		);
		expect(out).toEqual([]);
	});

	it('throws when JSON is not an array', () => {
		expect(() => parseEntityTriples('{"x":1}', new Set())).toThrow(/must be a JSON array/);
	});
});

function chatResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('extractEntityMentions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns parsed mentions from the chat completion content', async () => {
		llmChatCompletionMock.mockResolvedValue(
			chatResponse('[{"surface":"Sam","entityType":"perception","confidence":0.9}]')
		);
		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: 'Sam was here',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});
		expect(out).toEqual([{ surface: 'Sam', entityType: 'perception', confidence: 0.9 }]);
		expect(llmChatCompletionMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', temperature: 0 })
		);
	});

	it('throws when ontologyEntityKinds is empty', async () => {
		await expect(
			extractEntityMentions({ userId: 'u1', normalizedText: 'x', ontologyEntityKinds: [] })
		).rejects.toThrow(/at least one ontology entity kind/);
	});

	it('throws when the response is not an object', async () => {
		llmChatCompletionMock.mockResolvedValue(null);
		await expect(
			extractEntityMentions({
				userId: 'u1',
				normalizedText: 'x',
				ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
			})
		).rejects.toThrow(/not an object/);
	});

	it('throws when the response has no choices', async () => {
		llmChatCompletionMock.mockResolvedValue({});
		await expect(
			extractEntityMentions({
				userId: 'u1',
				normalizedText: 'x',
				ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
			})
		).rejects.toThrow(/no choices/);
	});

	it('throws when the first choice has no message', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{}] });
		await expect(
			extractEntityMentions({
				userId: 'u1',
				normalizedText: 'x',
				ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
			})
		).rejects.toThrow(/no message/);
	});

	it('throws when the message content is not a string', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: 123 } }] });
		await expect(
			extractEntityMentions({
				userId: 'u1',
				normalizedText: 'x',
				ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
			})
		).rejects.toThrow(/must be a string/);
	});
});

describe('extractEntityTriples', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('short-circuits with an empty array when no mentions are provided', async () => {
		const out = await extractEntityTriples({
			userId: 'u1',
			normalizedText: 'x',
			mentions: []
		});
		expect(out).toEqual([]);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('returns parsed triples from the chat completion content', async () => {
		llmChatCompletionMock.mockResolvedValue(
			chatResponse('[{"subject":"Sam","object":"Berlin","predicate":"located_in","confidence":0.5}]')
		);
		const mentions = [{ surface: 'Sam', entityType: 'perception', confidence: 0.9 }];
		const out = await extractEntityTriples({
			userId: 'u1',
			normalizedText: 'Sam in Berlin',
			mentions
		});
		expect(out).toEqual([]);
	});

	it('returns triples when endpoints match mention surfaces', async () => {
		llmChatCompletionMock.mockResolvedValue(
			chatResponse('[{"subject":"Sam","object":"Berlin","predicate":"located_in","confidence":0.5}]')
		);
		const mentions = [
			{ surface: 'Sam', entityType: 'perception', confidence: 0.9 },
			{ surface: 'Berlin', entityType: 'memory', confidence: 0.8 }
		];
		const out = await extractEntityTriples({
			userId: 'u1',
			normalizedText: 'Sam in Berlin',
			mentions
		});
		expect(out).toHaveLength(1);
		expect(out[0].predicate).toBe('located_in');
	});
});
