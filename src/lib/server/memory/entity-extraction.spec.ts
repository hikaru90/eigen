import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	acceptEntityTriple,
	extractEntityMentions,
	extractEntityTriples,
	filterAcceptedEntityTriples,
	parseEntityMentions,
	parseEntityTriples,
	resolveEntityTypeKey,
	shouldRetryEntityMentionExtraction
} from './entity-extraction';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

const ONTOLOGY_KINDS_FOR_TESTS = [
	{ key: 'person', name: 'Person', definition: 'A human being' },
	{ key: 'memory', name: 'Memory', definition: 'Past experience' },
	{ key: 'place', name: 'Place', definition: 'A location' }
];

const ALLOWED_TEST_KEYS = new Set(ONTOLOGY_KINDS_FOR_TESTS.map((k) => k.key));

describe('shouldRetryEntityMentionExtraction', () => {
	const marcusAllergy =
		"Marcus is allergic to walnuts. Don't bring the walnut levain to next dinner.";

	it('retries short allergy notes that name a person', () => {
		expect(shouldRetryEntityMentionExtraction(marcusAllergy)).toBe(true);
	});

	it('does not retry very short fragments', () => {
		expect(shouldRetryEntityMentionExtraction('Marcus allergy')).toBe(false);
	});

	it('retries long substantive notes', () => {
		expect(shouldRetryEntityMentionExtraction('x'.repeat(120))).toBe(true);
	});

	it('retries Jonas creative-work note (short but names a person)', () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		expect(shouldRetryEntityMentionExtraction(jonasSilence)).toBe(true);
	});
});

describe('resolveEntityTypeKey', () => {
	it('matches ontology keys case-insensitively', () => {
		const allowed = new Set(['person', 'technology', 'organization']);
		expect(resolveEntityTypeKey('Person', allowed)).toBe('person');
		expect(resolveEntityTypeKey('TECHNOLOGY', allowed)).toBe('technology');
	});

	it('maps common shorthand to canonical keys', () => {
		const allowed = new Set(['organization', 'technology', 'place']);
		expect(resolveEntityTypeKey('org', allowed)).toBe('organization');
		expect(resolveEntityTypeKey('device', allowed)).toBe('technology');
		expect(resolveEntityTypeKey('location', allowed)).toBe('place');
	});

	it('maps operative-note drift (procedure, anatomy) to allowed keys', () => {
		const allowed = new Set(['person', 'place', 'technology', 'organization', 'concept', 'event']);
		expect(resolveEntityTypeKey('procedure', allowed)).toBe('event');
		expect(resolveEntityTypeKey('anatomy', allowed)).toBe('place');
		expect(resolveEntityTypeKey('landmark', allowed)).toBe('place');
	});

	it('maps abstract and human drift to concept and person', () => {
		const allowed = new Set(['person', 'concept']);
		expect(resolveEntityTypeKey('abstract', allowed)).toBe('concept');
		expect(resolveEntityTypeKey('topic', allowed)).toBe('concept');
		expect(resolveEntityTypeKey('human', allowed)).toBe('person');
		expect(resolveEntityTypeKey('individual', allowed)).toBe('person');
	});
});

describe('parseEntityMentions', () => {
	it('accepts Title Case entityType when it matches a canonical ontology key', () => {
		const out = parseEntityMentions(
			'[{"surface":"StealthArray","entityType":"Technology","confidence":0.9}]',
			new Set(['person', 'place', 'technology', 'concept'])
		);
		expect(out).toEqual([{ surface: 'StealthArray', entityType: 'technology', confidence: 0.9 }]);
	});

	it('keeps surgical spans when the model uses procedure/anatomy labels', () => {
		const allowed = new Set(['person', 'place', 'technology', 'organization', 'concept', 'event']);
		const out = parseEntityMentions(
			JSON.stringify([
				{ surface: 'MIS TLIF', entityType: 'procedure', confidence: 0.9 },
				{ surface: 'L4 transverse processes', entityType: 'anatomy', confidence: 0.85 },
				{ surface: 'StealthArray navigation', entityType: 'technology', confidence: 0.8 }
			]),
			allowed
		);
		expect(out).toHaveLength(3);
		expect(out[0]).toMatchObject({ surface: 'MIS TLIF', entityType: 'event' });
		expect(out[1]).toMatchObject({ surface: 'L4 transverse processes', entityType: 'place' });
	});

	it('keeps mentions when the model uses abstract or human labels', () => {
		const allowed = new Set(['person', 'concept']);
		const out = parseEntityMentions(
			JSON.stringify([
				{ surface: 'Jonas', entityType: 'human', confidence: 0.9 },
				{ surface: 'silence', entityType: 'abstract', confidence: 0.85 }
			]),
			allowed
		);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ surface: 'Jonas', entityType: 'person' });
		expect(out[1]).toMatchObject({ surface: 'silence', entityType: 'concept' });
	});

	it('parses and filters types not in the ontology key set', () => {
		const out = parseEntityMentions(
			'[{"surface":"  Sam  ","entityType":"person","confidence":0.9},{"surface":"X","entityType":"unknown_type","confidence":1}]',
			ALLOWED_TEST_KEYS
		);
		expect(out).toEqual([{ surface: 'Sam', entityType: 'person', confidence: 0.9 }]);
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
			'[{"surface":42,"entityType":"person","confidence":1},{"surface":"Alex","entityType":42,"confidence":1}]',
			ALLOWED_TEST_KEYS
		);
		expect(out).toEqual([]);
	});

	it('clamps numeric confidence outside [0,1] and treats non-numeric as 0', () => {
		const out = parseEntityMentions(
			'[{"surface":"A","entityType":"place","confidence":5},{"surface":"B","entityType":"place","confidence":-3},{"surface":"C","entityType":"place","confidence":"x"},{"surface":"D","entityType":"place","confidence":null}]',
			ALLOWED_TEST_KEYS
		);
		expect(out.map((m) => m.confidence)).toEqual([1, 0, 0, 0]);
	});

	it('throws when JSON is not an array', () => {
		expect(() => parseEntityMentions('{"surface":"A"}', ALLOWED_TEST_KEYS)).toThrow(/must be a JSON array/);
	});
});

describe('acceptEntityTriple', () => {
	it('rejects low-confidence related_to without lexical support', () => {
		expect(
			acceptEntityTriple(
				{ subject: 'Sam', object: 'Mars', predicate: 'related_to', confidence: 0.9 },
				'sam met alex in berlin'
			)
		).toBe(false);
	});

	it('accepts related_to when both endpoints appear in text', () => {
		expect(
			acceptEntityTriple(
				{ subject: 'Sam', object: 'Berlin', predicate: 'related_to', confidence: 0.8 },
				'sam traveled to berlin'
			)
		).toBe(true);
	});

	it('rejects specific predicates below default confidence floor', () => {
		expect(
			acceptEntityTriple(
				{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.5 },
				'sam in berlin'
			)
		).toBe(false);
	});
});

describe('filterAcceptedEntityTriples', () => {
	it('filters invalid triples from a batch', () => {
		const out = filterAcceptedEntityTriples({
			normalizedText: 'sam in berlin',
			triples: [
				{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.8 },
				{ subject: 'Sam', object: 'Mars', predicate: 'related_to', confidence: 0.9 }
			]
		});
		expect(out).toHaveLength(1);
		expect(out[0].predicate).toBe('located_in');
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
			chatResponse('[{"surface":"Sam","entityType":"person","confidence":0.9}]')
		);
		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: 'Sam was here',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});
		expect(out).toEqual([{ surface: 'Sam', entityType: 'person', confidence: 0.9 }]);
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

	it('retries with a minimum-mention prompt when the first pass returns an empty array on a short allergy note', async () => {
		const marcusAllergy =
			"Marcus is allergic to walnuts. Don't bring the walnut levain to next dinner.";
		llmChatCompletionMock
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(
				chatResponse(
					'[{"surface":"Marcus","entityType":"person","confidence":0.95},{"surface":"walnuts","entityType":"concept","confidence":0.9}]'
				)
			);

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: marcusAllergy,
			ontologyEntityKinds: [
				...ONTOLOGY_KINDS_FOR_TESTS,
				{ key: 'concept', name: 'Concept', definition: 'An idea or topic' }
			]
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(2);
		expect(out.some((m) => m.surface.toLowerCase().includes('marcus'))).toBe(true);
		expect(out.some((m) => m.surface.toLowerCase().includes('walnut'))).toBe(true);
	});

	it('throws when the LLM gateway fails (no silent empty fallback)', async () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		llmChatCompletionMock.mockRejectedValue(new Error('LLM HTTP 500'));

		await expect(
			extractEntityMentions({
				userId: 'u1',
				normalizedText: jonasSilence,
				ontologyEntityKinds: [
					...ONTOLOGY_KINDS_FOR_TESTS,
					{ key: 'concept', name: 'Concept', definition: 'An idea or topic' }
				]
			})
		).rejects.toThrow(/LLM HTTP 500/);
	});

	it('retries Jonas creative-work note and returns LLM mentions on second pass', async () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		llmChatCompletionMock
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(
				chatResponse(
					'[{"surface":"Jonas","entityType":"person","confidence":0.9},{"surface":"silence","entityType":"concept","confidence":0.85}]'
				)
			);

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: jonasSilence,
			ontologyEntityKinds: [
				...ONTOLOGY_KINDS_FOR_TESTS,
				{ key: 'concept', name: 'Concept', definition: 'An idea or topic' }
			]
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(2);
		expect(out.some((m) => m.surface === 'Jonas')).toBe(true);
		expect(out.some((m) => m.surface === 'silence')).toBe(true);
	});

	it('retries Jonas creative-work note on third verbatim pass when first two return empty', async () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		llmChatCompletionMock
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(
				chatResponse(
					'[{"surface":"Jonas","entityType":"person","confidence":0.9},{"surface":"silence","entityType":"concept","confidence":0.85}]'
				)
			);

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: jonasSilence,
			ontologyEntityKinds: [
				...ONTOLOGY_KINDS_FOR_TESTS,
				{ key: 'concept', name: 'Concept', definition: 'An idea or topic' }
			],
			knownEntities: [
				{ label: 'Jonas', entityType: 'person' },
				{ label: 'silence', entityType: 'concept' }
			]
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(3);
		const thirdPassPrompt = llmChatCompletionMock.mock.calls[2]?.[0]?.messages?.[1]?.content;
		expect(String(thirdPassPrompt)).toContain('verbatim');
		expect(String(thirdPassPrompt)).toContain('Jonas (person)');
		expect(out.some((m) => m.surface === 'Jonas')).toBe(true);
		expect(out.some((m) => m.surface === 'silence')).toBe(true);
	});

	it('retries with a minimum-mention prompt when the first pass returns an empty array on long text', async () => {
		const tlifText =
			'MIS TLIF L4-L5 after intraoperative AP fluoroscopy degraded. StealthArray navigation: registration anchored on paired L4 transverse processes with RMS error 1.6 mm versus institutional proceed-if-under 2.0 mm.';
		llmChatCompletionMock
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(
				chatResponse(
					'[{"surface":"MIS TLIF","entityType":"event","confidence":0.9},{"surface":"L4 transverse processes","entityType":"place","confidence":0.85}]'
				)
			);

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: tlifText,
			ontologyEntityKinds: [
				...ONTOLOGY_KINDS_FOR_TESTS,
				{ key: 'technology', name: 'Technology', definition: 'A system or device' },
				{ key: 'event', name: 'Event', definition: 'A procedure or occurrence' }
			]
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(2);
		expect(out).toHaveLength(2);
		expect(out.some((m) => m.surface.toLowerCase().includes('transverse'))).toBe(true);
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
		const mentions = [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }];
		const out = await extractEntityTriples({
			userId: 'u1',
			normalizedText: 'Sam in Berlin',
			mentions
		});
		expect(out).toEqual([]);
	});

	it('returns triples when endpoints match mention surfaces', async () => {
		llmChatCompletionMock.mockResolvedValue(
			chatResponse('[{"subject":"Sam","object":"Berlin","predicate":"located_in","confidence":0.6}]')
		);
		const mentions = [
			{ surface: 'Sam', entityType: 'person', confidence: 0.9 },
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
