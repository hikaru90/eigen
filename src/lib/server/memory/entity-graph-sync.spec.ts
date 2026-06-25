import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncEntityGraphFromThought, upsertEntityRelationTriples } from './entity-graph-sync';

const {
	extractEntityGraphBundleMock,
	extractEntityTriplesMock,
	resolveOrCreateCanonicalEntityMock,
	clearEntityResolutionLogsForThoughtMock,
	loadEntityHintsForThoughtMock,
	upsertEntityNodeMock,
	upsertEntityRelationEdgeMock,
	upsertMentionEdgeMock,
	upsertThoughtNodeMock,
	getDbMock,
	loadOntologyForUserMock,
	createThoughtEmbeddingsMock,
	ensureUserOntologySeededMock
} = vi.hoisted(() => ({
	extractEntityGraphBundleMock: vi.fn(),
	extractEntityTriplesMock: vi.fn(),
	resolveOrCreateCanonicalEntityMock: vi.fn(),
	clearEntityResolutionLogsForThoughtMock: vi.fn(),
	loadEntityHintsForThoughtMock: vi.fn(),
	upsertEntityNodeMock: vi.fn(),
	upsertEntityRelationEdgeMock: vi.fn(),
	upsertMentionEdgeMock: vi.fn(),
	upsertThoughtNodeMock: vi.fn(),
	getDbMock: vi.fn(),
	loadOntologyForUserMock: vi.fn(),
	ensureUserOntologySeededMock: vi.fn(),
	createThoughtEmbeddingsMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/ontology-db', () => ({
	ensureUserOntologySeeded: ensureUserOntologySeededMock,
	loadOntologyForUser: loadOntologyForUserMock
}));

vi.mock('$lib/server/memory/entity-extraction', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/memory/entity-extraction')>();
	return {
		...actual,
		extractEntityGraphBundle: extractEntityGraphBundleMock,
		extractEntityTriples: extractEntityTriplesMock
	};
});

vi.mock('$lib/server/memory/entity-resolution', () => ({
	resolveOrCreateCanonicalEntity: resolveOrCreateCanonicalEntityMock,
	clearEntityResolutionLogsForThought: clearEntityResolutionLogsForThoughtMock
}));

vi.mock('$lib/server/memory/entity-graph-hints', () => ({
	loadEntityHintsForThought: loadEntityHintsForThoughtMock
}));

vi.mock('$lib/server/graph/age', () => ({
	upsertEntityNode: upsertEntityNodeMock,
	upsertEntityRelationEdge: upsertEntityRelationEdgeMock,
	upsertMentionEdge: upsertMentionEdgeMock,
	upsertThoughtNode: upsertThoughtNodeMock
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbeddings: createThoughtEmbeddingsMock
}));

vi.mock('$lib/server/memory/project-list', () => ({
	loadEligibleGtdProjects: vi.fn(async () => [])
}));

vi.mock('$lib/server/memory/promote-eligible-project-hubs', () => ({
	evaluateHubsForGtdPromotion: vi.fn(async () => 0)
}));

describe('syncEntityGraphFromThought', () => {
	// Mock entity_type kind rows (real-world entity types, not thought categories)
	const entityTypeRows = [
		{ id: 'et1', userId: 'u1', key: 'person', name: 'Person', definition: 'A human being', active: true, kindType: 'entity_type' },
		{ id: 'et2', userId: 'u1', key: 'place', name: 'Place', definition: 'A location', active: true, kindType: 'entity_type' }
	];

	function mockThoughtAnchor(category = 'observation') {
		getDbMock.mockReturnValue({
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ category }])
					})
				})
			})
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
		extractEntityGraphBundleMock.mockResolvedValue({ mentions: [], triples: [] });
		extractEntityTriplesMock.mockResolvedValue([]);
		clearEntityResolutionLogsForThoughtMock.mockResolvedValue(undefined);
		getDbMock.mockReturnValue({});
		ensureUserOntologySeededMock.mockResolvedValue(undefined);
		loadEntityHintsForThoughtMock.mockResolvedValue([]);
		createThoughtEmbeddingsMock.mockImplementation(async (_userId: string, texts: string[]) =>
			texts.map(() => [0.1, 0.2])
		);
		loadOntologyForUserMock.mockResolvedValue({
			entityKinds: entityTypeRows,
			relationKinds: [],
			entityKindsById: new Map(),
			entityKindsByKey: new Map(),
			relationKindsById: new Map(),
			relationKindsByKey: new Map()
		});
	});

	it('returns early when no entity mentions are extracted', async () => {
		extractEntityGraphBundleMock.mockResolvedValue({ mentions: [], triples: [] });
		const result = await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'a quiet thought'
		});
		expect(result).toEqual({ mentionCount: 0, projectLikeEntities: [] });
		expect(clearEntityResolutionLogsForThoughtMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1'
		});
		expect(ensureUserOntologySeededMock).toHaveBeenCalled();
		expect(extractEntityGraphBundleMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				normalizedText: 'a quiet thought',
				ontologyEntityKinds: [
					{ key: 'person', name: 'Person', definition: 'A human being' },
					{ key: 'place', name: 'Place', definition: 'A location' }
				]
			})
		);
		expect(resolveOrCreateCanonicalEntityMock).not.toHaveBeenCalled();
		expect(upsertEntityNodeMock).not.toHaveBeenCalled();
		expect(upsertMentionEdgeMock).not.toHaveBeenCalled();
		expect(upsertEntityRelationEdgeMock).not.toHaveBeenCalled();
	});

	it('resolves each mention, upserts Entity and MENTIONS edges, and writes ENTITY_RELATES for valid triples', async () => {
		mockThoughtAnchor('observation');
		extractEntityGraphBundleMock.mockResolvedValue({
			mentions: [
				{ surface: 'Sam', entityType: 'person', confidence: 0.9 },
				{ surface: 'Berlin', entityType: 'place', confidence: 0.8 }
			],
			triples: [{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.7 }]
		});
		resolveOrCreateCanonicalEntityMock.mockImplementation(
			async (input: { surface: string }) => ({
				entityId: `id-${input.surface}`,
				canonicalKey: input.surface.toLowerCase(),
				decision: 'created'
			})
		);
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Sam lives in Berlin'
		});

		expect(resolveOrCreateCanonicalEntityMock).toHaveBeenCalledTimes(2);
		expect(upsertThoughtNodeMock).toHaveBeenCalledWith({
			id: 't1',
			userId: 'u1',
			category: 'observation'
		});
		expect(resolveOrCreateCanonicalEntityMock.mock.calls[1][0]).toMatchObject({
			coMentionEntityIds: ['id-Sam']
		});
		expect(upsertEntityNodeMock).toHaveBeenCalledTimes(2);
		expect(upsertEntityNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'id-Sam',
				canonicalKey: 'sam',
				label: 'Sam',
				entityType: 'person'
			})
		);
		expect(upsertMentionEdgeMock).toHaveBeenCalledTimes(2);
		expect(upsertMentionEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			entityId: 'id-Sam'
		});
		expect(upsertEntityRelationEdgeMock).toHaveBeenCalledTimes(1);
		expect(upsertEntityRelationEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			sourceEntityId: 'id-Sam',
			targetEntityId: 'id-Berlin',
			predicate: 'located_in'
		});
	});

	it('skips triples whose endpoints are unknown or self-referential', async () => {
		mockThoughtAnchor();
		extractEntityGraphBundleMock.mockResolvedValue({
			mentions: [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }],
			triples: [
				{ subject: 'Sam', object: 'Ghost', predicate: 'knows', confidence: 0.4 },
				{ subject: 'Sam', object: 'Sam', predicate: 'related_to', confidence: 0.5 }
			]
		});
		resolveOrCreateCanonicalEntityMock.mockResolvedValue({
			entityId: 'id-Sam',
			canonicalKey: 'sam',
			decision: 'created'
		});
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Sam talks about himself'
		});

		expect(upsertEntityRelationEdgeMock).not.toHaveBeenCalled();
	});

	it('passes graph-derived known entities into mention extraction', async () => {
		loadEntityHintsForThoughtMock.mockResolvedValue([{ label: 'Berlin', entityType: 'place' }]);
		extractEntityGraphBundleMock.mockResolvedValue({ mentions: [], triples: [] });
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'some text'
		});
		expect(loadEntityHintsForThoughtMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'some text'
		});
		expect(extractEntityGraphBundleMock).toHaveBeenCalledWith(
			expect.objectContaining({
				knownEntities: [{ label: 'Berlin', entityType: 'place' }]
			})
		);
	});

	it('throws when no active entity_type ontology kinds exist', async () => {
		loadOntologyForUserMock.mockResolvedValue({
			entityKinds: [],
			relationKinds: [],
			entityKindsById: new Map(),
			entityKindsByKey: new Map(),
			relationKindsById: new Map(),
			relationKindsByKey: new Map()
		});
		await expect(
			syncEntityGraphFromThought({
				userId: 'u1',
				thoughtId: 't1',
				normalizedText: 'some text'
			})
		).rejects.toThrow(/requires at least one active entity_type kind/);
	});

	it('continues without hints when graph hint loading fails with a non-Error', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		loadEntityHintsForThoughtMock.mockRejectedValue('hint lookup failed');
		extractEntityGraphBundleMock.mockResolvedValue({ mentions: [], triples: [] });
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'some text'
		});
		expect(extractEntityGraphBundleMock).toHaveBeenCalledWith(
			expect.objectContaining({ knownEntities: undefined })
		);
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-graph-sync] graph known-entity hints failed, proceeding without hints',
			expect.objectContaining({ message: 'hint lookup failed' })
		);
		warnSpy.mockRestore();
	});

	it('continues without hints when graph hint loading fails with an Error', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		loadEntityHintsForThoughtMock.mockRejectedValue(new Error('hint lookup failed'));
		extractEntityGraphBundleMock.mockResolvedValue({ mentions: [], triples: [] });
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'some text'
		});
		expect(warnSpy).toHaveBeenCalledWith(
			'[entity-graph-sync] graph known-entity hints failed, proceeding without hints',
			expect.objectContaining({ message: 'hint lookup failed' })
		);
		warnSpy.mockRestore();
	});

	it('deduplicates preloaded and graph hints by label', async () => {
		loadEntityHintsForThoughtMock.mockResolvedValue([{ label: 'Berlin', entityType: 'place' }]);
		extractEntityGraphBundleMock.mockResolvedValue({ mentions: [], triples: [] });
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'some text',
			preloadedKnownEntities: [{ label: ' berlin ', entityType: 'place' }]
		});
		expect(extractEntityGraphBundleMock).toHaveBeenCalledWith(
			expect.objectContaining({
				knownEntities: [{ label: ' berlin ', entityType: 'place' }]
			})
		);
	});
});

describe('upsertEntityRelationTriples', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extractEntityTriplesMock.mockResolvedValue([
			{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.7 }
		]);
	});

	it('extracts triples when none are supplied and writes valid edges', async () => {
		await upsertEntityRelationTriples({
			userId: 'u1',
			normalizedText: 'Sam lives in Berlin',
			mentions: [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }],
			surfaceToEntityId: new Map([
				['Sam', 'id-Sam'],
				['Berlin', 'id-Berlin']
			])
		});

		expect(extractEntityTriplesMock).toHaveBeenCalled();
		expect(upsertEntityRelationEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			sourceEntityId: 'id-Sam',
			targetEntityId: 'id-Berlin',
			predicate: 'located_in'
		});
	});

	it('skips triples whose endpoints are missing from the surface map', async () => {
		await upsertEntityRelationTriples({
			userId: 'u1',
			normalizedText: 'Sam knows Ghost',
			mentions: [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }],
			surfaceToEntityId: new Map([['Sam', 'id-Sam']]),
			triples: [{ subject: 'Sam', object: 'Ghost', predicate: 'knows', confidence: 0.4 }]
		});

		expect(upsertEntityRelationEdgeMock).not.toHaveBeenCalled();
	});
});
