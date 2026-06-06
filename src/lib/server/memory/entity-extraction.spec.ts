import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	acceptEntityTriple,
	extractEntityGraphBundle,
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

	it('does not retry empty text', () => {
		expect(shouldRetryEntityMentionExtraction('   ')).toBe(false);
	});

	it('retries notes that start a new sentence with a capitalized word', () => {
		expect(
			shouldRetryEntityMentionExtraction(
				'Done. Marcus called about dinner plans for next week soon enough.'
			)
		).toBe(true);
	});

	it('retries notes with two capitalized tokens', () => {
		expect(
			shouldRetryEntityMentionExtraction(
				'Marcus Berlin lunch meeting next week planning session today now.'
			)
		).toBe(true);
	});

	it('does not retry medium-length notes without retry signals', () => {
		expect(shouldRetryEntityMentionExtraction('a'.repeat(60))).toBe(false);
	});

	it('does not retry medium-length all-lowercase notes without retry signals', () => {
		expect(
			shouldRetryEntityMentionExtraction(
				'the team discussed plans for next week and agreed on several details today.'
			)
		).toBe(false);
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

	it('returns null for empty or whitespace-only input', () => {
		const allowed = new Set(['person']);
		expect(resolveEntityTypeKey('', allowed)).toBeNull();
		expect(resolveEntityTypeKey('   ', allowed)).toBeNull();
	});

	it('returns exact key when already present in allowed set', () => {
		const allowed = new Set(['person', 'place']);
		expect(resolveEntityTypeKey('person', allowed)).toBe('person');
	});

	it('returns null when synonym maps to a key not in allowed', () => {
		const allowed = new Set(['person']);
		expect(resolveEntityTypeKey('org', allowed)).toBeNull();
		expect(resolveEntityTypeKey('location', allowed)).toBeNull();
	});

	it('returns null for unknown types with no synonym mapping', () => {
		const allowed = new Set(['person', 'place']);
		expect(resolveEntityTypeKey('unknown_type', allowed)).toBeNull();
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

	it('drops greeting surfaces after parse', () => {
		const out = parseEntityMentions(
			'[{"surface":"Hallo","entityType":"person","confidence":0.9},{"surface":"Alex","entityType":"person","confidence":0.95}]',
			ALLOWED_TEST_KEYS
		);
		expect(out).toEqual([{ surface: 'Alex', entityType: 'person', confidence: 0.95 }]);
	});

	it('throws when JSON is not an array', () => {
		expect(() => parseEntityMentions('{"surface":"A"}', ALLOWED_TEST_KEYS)).toThrow(/must be a JSON array/);
	});

	it('warns when every mention is dropped due to invalid entityType', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const out = parseEntityMentions(
			'[{"surface":"Sam","entityType":"bogus","confidence":0.9}]',
			ALLOWED_TEST_KEYS
		);
		expect(out).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-extraction] all LLM mentions dropped (invalid entityType?)',
			expect.objectContaining({ rawEntityTypes: ['bogus'] })
		);
		warnSpy.mockRestore();
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

	it('accepts non-related_to predicates at or above default confidence floor', () => {
		expect(
			acceptEntityTriple(
				{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.55 },
				'sam in berlin'
			)
		).toBe(true);
	});

	it('rejects related_to below the higher confidence floor even with lexical support', () => {
		expect(
			acceptEntityTriple(
				{ subject: 'Sam', object: 'Berlin', predicate: 'related_to', confidence: 0.7 },
				'sam traveled to berlin'
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

	it('clamps triple confidence outside [0,1] and treats non-numeric as 0', () => {
		const allowed = new Set(['A', 'B']);
		const out = parseEntityTriples(
			'[{"subject":"A","object":"B","predicate":"related_to","confidence":2},{"subject":"A","object":"B","predicate":"knows","confidence":"x"}]',
			allowed
		);
		expect(out).toHaveLength(2);
		expect(out[0].confidence).toBe(1);
		expect(out[1].confidence).toBe(0);
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

	it('returns [] when the LLM emits invalid mention JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('not-json'));

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: 'x'.repeat(120),
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(out).toEqual([]);
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

	it('does not retry when text is too short to warrant a second pass', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('[]'));

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: 'short note',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
		expect(out).toEqual([]);
	});

	it('returns [] after all retry passes fail on substantive text', async () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		llmChatCompletionMock
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(chatResponse('[]'));

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: jonasSilence,
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(3);
		expect(out).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-extraction] zero mentions after all retries',
			expect.objectContaining({ userId: 'u1' })
		);
		warnSpy.mockRestore();
	});

	it('includes knownEntities in the default pass prompt', async () => {
		llmChatCompletionMock.mockResolvedValue(
			chatResponse('[{"surface":"Jonas","entityType":"person","confidence":0.9}]')
		);

		await extractEntityMentions({
			userId: 'u1',
			normalizedText: 'Jonas was here',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
			knownEntities: [{ label: 'Jonas', entityType: 'person' }]
		});

		const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content;
		expect(String(prompt)).toContain('Known entities already in memory');
		expect(String(prompt)).toContain('Never replace a name in the text');
		expect(String(prompt)).toContain('Jonas (person)');
	});

	it('uses minimum-rule wording on the second retry pass', async () => {
		const marcusAllergy =
			"Marcus is allergic to walnuts. Don't bring the walnut levain to next dinner.";
		llmChatCompletionMock
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(
				chatResponse('[{"surface":"Marcus","entityType":"person","confidence":0.9}]')
			);

		await extractEntityMentions({
			userId: 'u1',
			normalizedText: marcusAllergy,
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		const secondPassPrompt = llmChatCompletionMock.mock.calls[1]?.[0]?.messages?.[1]?.content;
		expect(String(secondPassPrompt)).toContain('Return at least 2 items');
	});

	it('swallows invalid JSON on retry passes and continues retrying', async () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		llmChatCompletionMock
			.mockResolvedValueOnce(chatResponse('not-json'))
			.mockResolvedValueOnce(chatResponse('[]'))
			.mockResolvedValueOnce(
				chatResponse('[{"surface":"Jonas","entityType":"person","confidence":0.9}]')
			);

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: jonasSilence,
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(3);
		expect(out).toEqual([{ surface: 'Jonas', entityType: 'person', confidence: 0.9 }]);
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-extraction] invalid mention JSON from LLM',
			expect.objectContaining({ pass: 'default' })
		);
		warnSpy.mockRestore();
	});

	it('strips markdown JSON fences from LLM content', async () => {
		llmChatCompletionMock.mockResolvedValue(
			chatResponse('```json\n[{"surface":"Sam","entityType":"person","confidence":0.9}]\n```')
		);

		const out = await extractEntityMentions({
			userId: 'u1',
			normalizedText: 'Sam was here',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(out).toEqual([{ surface: 'Sam', entityType: 'person', confidence: 0.9 }]);
	});
});

describe('extractEntityGraphBundle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function graphBundleResponse(mentions: unknown[], triples: unknown[] = []) {
		return chatResponse(JSON.stringify({ mentions, triples }));
	}

	it('returns parsed mentions and triples from a valid graph bundle', async () => {
		llmChatCompletionMock.mockResolvedValue(
			graphBundleResponse(
				[{ surface: 'Sam', entityType: 'person', confidence: 0.9 }],
				[{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.8 }]
			)
		);

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: 'Sam in Berlin',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(out.mentions).toEqual([{ surface: 'Sam', entityType: 'person', confidence: 0.9 }]);
		expect(out.triples).toEqual([]);
	});

	it('throws when ontologyEntityKinds is empty', async () => {
		await expect(
			extractEntityGraphBundle({ userId: 'u1', normalizedText: 'x', ontologyEntityKinds: [] })
		).rejects.toThrow(/at least one ontology entity kind/);
	});

	it('returns empty bundle when graph JSON is invalid', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		llmChatCompletionMock.mockResolvedValue(chatResponse('not-json'));

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: 'x'.repeat(120),
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(out).toEqual({ mentions: [], triples: [] });
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-extraction] invalid graph bundle JSON from LLM',
			expect.objectContaining({ pass: 'default' })
		);
		warnSpy.mockRestore();
	});

	it('returns empty bundle when parsed output is not an object', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		llmChatCompletionMock.mockResolvedValue(chatResponse('null'));

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: 'Sam was here',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(out).toEqual({ mentions: [], triples: [] });
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-extraction] invalid graph bundle JSON from LLM',
			expect.objectContaining({ pass: 'default' })
		);
		warnSpy.mockRestore();
	});

	it('treats non-array mentions and triples as empty arrays', async () => {
		llmChatCompletionMock.mockResolvedValue(
			chatResponse(
				JSON.stringify({
					mentions: { surface: 'Sam', entityType: 'person' },
					triples: 'bad'
				})
			)
		);

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: 'Sam was here',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(out).toEqual({ mentions: [], triples: [] });
	});

	it('includes knownEntities in the graph bundle prompt', async () => {
		llmChatCompletionMock.mockResolvedValue(
			graphBundleResponse([{ surface: 'Jonas', entityType: 'person', confidence: 0.9 }])
		);

		await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: 'Jonas was here',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
			knownEntities: [{ label: 'Jonas', entityType: 'person' }]
		});

		const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content;
		expect(String(prompt)).toContain('Known entities already in memory');
		expect(String(prompt)).toContain('Jonas (person)');
	});

	it('retries graph bundle with minimum rule when first pass has zero mentions', async () => {
		const marcusAllergy =
			"Marcus is allergic to walnuts. Don't bring the walnut levain to next dinner.";
		llmChatCompletionMock
			.mockResolvedValueOnce(graphBundleResponse([]))
			.mockResolvedValueOnce(
				graphBundleResponse([
					{ surface: 'Marcus', entityType: 'person', confidence: 0.95 },
					{ surface: 'walnuts', entityType: 'memory', confidence: 0.9 }
				])
			);

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: marcusAllergy,
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(2);
		const secondPassPrompt = llmChatCompletionMock.mock.calls[1]?.[0]?.messages?.[1]?.content;
		expect(String(secondPassPrompt)).toContain('Return at least 2 mentions');
		expect(out.mentions.some((m) => m.surface === 'Marcus')).toBe(true);
	});

	it('retries graph bundle on third verbatim pass when first two return empty', async () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		llmChatCompletionMock
			.mockResolvedValueOnce(graphBundleResponse([]))
			.mockResolvedValueOnce(graphBundleResponse([]))
			.mockResolvedValueOnce(
				graphBundleResponse([
					{ surface: 'Jonas', entityType: 'person', confidence: 0.9 },
					{ surface: 'silence', entityType: 'memory', confidence: 0.85 }
				])
			);

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: jonasSilence,
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(3);
		const thirdPassPrompt = llmChatCompletionMock.mock.calls[2]?.[0]?.messages?.[1]?.content;
		expect(String(thirdPassPrompt)).toContain('verbatim');
		expect(out.mentions.some((m) => m.surface === 'Jonas')).toBe(true);
	});

	it('logs after all graph bundle retries fail on substantive text', async () => {
		const jonasSilence =
			'Before any creative work, Jonas needs at least 20 minutes of silence — music or noise kills his flow completely.';
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		llmChatCompletionMock
			.mockResolvedValueOnce(graphBundleResponse([]))
			.mockResolvedValueOnce(graphBundleResponse([]))
			.mockResolvedValueOnce(graphBundleResponse([]));

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: jonasSilence,
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(3);
		expect(out).toEqual({ mentions: [], triples: [] });
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-extraction] zero mentions after all graph bundle retries',
			expect.objectContaining({ userId: 'u1' })
		);
		warnSpy.mockRestore();
	});

	it('keeps triples whose endpoints match parsed mention surfaces', async () => {
		llmChatCompletionMock.mockResolvedValue(
			graphBundleResponse(
				[
					{ surface: 'Sam', entityType: 'person', confidence: 0.9 },
					{ surface: 'Berlin', entityType: 'place', confidence: 0.8 }
				],
				[{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.8 }]
			)
		);

		const out = await extractEntityGraphBundle({
			userId: 'u1',
			normalizedText: 'Sam in Berlin',
			ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS
		});

		expect(out.triples).toHaveLength(1);
		expect(out.triples[0]).toMatchObject({ subject: 'Sam', object: 'Berlin', predicate: 'located_in' });
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

	it('throws when the LLM response is malformed', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [] });
		const mentions = [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }];
		await expect(
			extractEntityTriples({
				userId: 'u1',
				normalizedText: 'Sam was here',
				mentions
			})
		).rejects.toThrow(/no choices/);
	});

	it('throws when triple JSON is not an array', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('{"subject":"Sam"}'));
		const mentions = [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }];
		await expect(
			extractEntityTriples({
				userId: 'u1',
				normalizedText: 'Sam was here',
				mentions
			})
		).rejects.toThrow(/must be a JSON array/);
	});

	it('includes mention surfaces in the triple extraction prompt', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('[]'));
		const mentions = [
			{ surface: 'Sam', entityType: 'person', confidence: 0.9 },
			{ surface: 'Berlin', entityType: 'place', confidence: 0.8 }
		];
		await extractEntityTriples({
			userId: 'u1',
			normalizedText: 'Sam in Berlin',
			mentions
		});
		const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content;
		expect(String(prompt)).toContain('- Sam (person)');
		expect(String(prompt)).toContain('- Berlin (place)');
	});
});
