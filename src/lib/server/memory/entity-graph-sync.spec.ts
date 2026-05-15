import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncEntityGraphFromThought } from './entity-graph-sync';

const {
	extractEntityMentionsMock,
	extractEntityTriplesMock,
	resolveOrCreateCanonicalEntityMock,
	matchCanonicalEntitiesByEmbeddingMock,
	createThoughtEmbeddingMock,
	upsertEntityNodeMock,
	upsertEntityRelationEdgeMock,
	upsertMentionEdgeMock,
	getDbMock,
	loadOntologyForUserMock,
	ensureUserOntologySeededMock
} = vi.hoisted(() => ({
	extractEntityMentionsMock: vi.fn(),
	extractEntityTriplesMock: vi.fn(),
	resolveOrCreateCanonicalEntityMock: vi.fn(),
	matchCanonicalEntitiesByEmbeddingMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	upsertEntityNodeMock: vi.fn(),
	upsertEntityRelationEdgeMock: vi.fn(),
	upsertMentionEdgeMock: vi.fn(),
	getDbMock: vi.fn(),
	loadOntologyForUserMock: vi.fn(),
	ensureUserOntologySeededMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/ontology-db', () => ({
	ensureUserOntologySeeded: ensureUserOntologySeededMock,
	loadOntologyForUser: loadOntologyForUserMock
}));

vi.mock('$lib/server/memory/entity-extraction', () => ({
	extractEntityMentions: extractEntityMentionsMock,
	extractEntityTriples: extractEntityTriplesMock
}));

vi.mock('$lib/server/memory/entity-resolution', () => ({
	resolveOrCreateCanonicalEntity: resolveOrCreateCanonicalEntityMock,
	matchCanonicalEntitiesByEmbedding: matchCanonicalEntitiesByEmbeddingMock
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/graph/falkor', () => ({
	upsertEntityNode: upsertEntityNodeMock,
	upsertEntityRelationEdge: upsertEntityRelationEdgeMock,
	upsertMentionEdge: upsertMentionEdgeMock
}));

describe('syncEntityGraphFromThought', () => {
	// Mock entity_type kind rows (real-world entity types, not thought categories)
	const entityTypeRows = [
		{ id: 'et1', userId: 'u1', key: 'person', name: 'Person', definition: 'A human being', active: true, kindType: 'entity_type' },
		{ id: 'et2', userId: 'u1', key: 'place', name: 'Place', definition: 'A location', active: true, kindType: 'entity_type' }
	];

	beforeEach(() => {
		vi.clearAllMocks();
		extractEntityTriplesMock.mockResolvedValue([]);
		getDbMock.mockReturnValue({});
		ensureUserOntologySeededMock.mockResolvedValue(undefined);
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([]);
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
		extractEntityMentionsMock.mockResolvedValue([]);
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'a quiet thought'
		});
		expect(ensureUserOntologySeededMock).toHaveBeenCalled();
		expect(extractEntityMentionsMock).toHaveBeenCalledWith(
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
		expect(extractEntityTriplesMock).not.toHaveBeenCalled();
		expect(upsertEntityRelationEdgeMock).not.toHaveBeenCalled();
	});

	it('resolves each mention, upserts Entity and MENTIONS edges, and writes ENTITY_RELATES for valid triples', async () => {
		extractEntityMentionsMock.mockResolvedValue([
			{ surface: 'Sam', entityType: 'person', confidence: 0.9 },
			{ surface: 'Berlin', entityType: 'place', confidence: 0.8 }
		]);
		resolveOrCreateCanonicalEntityMock.mockImplementation(
			async (input: { surface: string }) => ({
				entityId: `id-${input.surface}`,
				canonicalKey: input.surface.toLowerCase(),
				decision: 'created'
			})
		);
		extractEntityTriplesMock.mockResolvedValue([
			{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.7 }
		]);

		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Sam lives in Berlin'
		});

		expect(resolveOrCreateCanonicalEntityMock).toHaveBeenCalledTimes(2);
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
		extractEntityMentionsMock.mockResolvedValue([
			{ surface: 'Sam', entityType: 'person', confidence: 0.9 }
		]);
		resolveOrCreateCanonicalEntityMock.mockResolvedValue({
			entityId: 'id-Sam',
			canonicalKey: 'sam',
			decision: 'created'
		});
		extractEntityTriplesMock.mockResolvedValue([
			{ subject: 'Sam', object: 'Ghost', predicate: 'knows', confidence: 0.4 },
			{ subject: 'Sam', object: 'Sam', predicate: 'related_to', confidence: 0.5 }
		]);

		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Sam talks about himself'
		});

		expect(upsertEntityRelationEdgeMock).not.toHaveBeenCalled();
	});

	it('uses provided thoughtEmbedding instead of creating a new one', async () => {
		extractEntityMentionsMock.mockResolvedValue([]);
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'some text',
			thoughtEmbedding: [0.5, 0.6, 0.7]
		});
		// Should use the provided embedding for known entity lookup
		expect(matchCanonicalEntitiesByEmbeddingMock).toHaveBeenCalledWith(
			expect.objectContaining({ embedding: [0.5, 0.6, 0.7] })
		);
		expect(createThoughtEmbeddingMock).not.toHaveBeenCalled();
	});
});
