import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncEntityGraphFromThought } from './entity-graph-sync';

const {
	extractEntityMentionsMock,
	extractEntityTriplesMock,
	resolveOrCreateCanonicalEntityMock,
	upsertEntityNodeMock,
	upsertEntityRelationEdgeMock,
	upsertMentionEdgeMock
} = vi.hoisted(() => ({
	extractEntityMentionsMock: vi.fn(),
	extractEntityTriplesMock: vi.fn(),
	resolveOrCreateCanonicalEntityMock: vi.fn(),
	upsertEntityNodeMock: vi.fn(),
	upsertEntityRelationEdgeMock: vi.fn(),
	upsertMentionEdgeMock: vi.fn()
}));

vi.mock('$lib/server/memory/entity-extraction', () => ({
	extractEntityMentions: extractEntityMentionsMock,
	extractEntityTriples: extractEntityTriplesMock
}));

vi.mock('$lib/server/memory/entity-resolution', () => ({
	resolveOrCreateCanonicalEntity: resolveOrCreateCanonicalEntityMock
}));

vi.mock('$lib/server/graph/falkor', () => ({
	upsertEntityNode: upsertEntityNodeMock,
	upsertEntityRelationEdge: upsertEntityRelationEdgeMock,
	upsertMentionEdge: upsertMentionEdgeMock
}));

describe('syncEntityGraphFromThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		extractEntityTriplesMock.mockResolvedValue([]);
	});

	it('returns early when no entity mentions are extracted', async () => {
		extractEntityMentionsMock.mockResolvedValue([]);
		await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'a quiet thought'
		});
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
});
