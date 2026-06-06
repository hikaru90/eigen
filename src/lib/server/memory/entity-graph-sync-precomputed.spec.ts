import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncEntityGraphFromThought } from './entity-graph-sync';

const {
	extractEntityGraphBundleMock,
	resolveOrCreateCanonicalEntityMock,
	upsertMentionEdgeMock,
	loadOntologyForUserMock
} = vi.hoisted(() => ({
	extractEntityGraphBundleMock: vi.fn(),
	resolveOrCreateCanonicalEntityMock: vi.fn(),
	upsertMentionEdgeMock: vi.fn(),
	loadOntologyForUserMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(() => ({}))
}));

vi.mock('$lib/server/ontology-db', () => ({
	ensureUserOntologySeeded: vi.fn(async () => undefined),
	loadOntologyForUser: loadOntologyForUserMock
}));

vi.mock('$lib/server/memory/entity-extraction', () => ({
	extractEntityGraphBundle: extractEntityGraphBundleMock,
	filterAcceptedEntityTriples: vi.fn(({ triples }: { triples: unknown[] }) => triples)
}));

vi.mock('$lib/server/memory/entity-resolution', () => ({
	resolveOrCreateCanonicalEntity: resolveOrCreateCanonicalEntityMock,
	clearEntityResolutionLogsForThought: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/memory/entity-graph-hints', () => ({
	loadEntityHintsForThought: vi.fn(async () => [])
}));

vi.mock('$lib/server/graph/age', () => ({
	upsertEntityNode: vi.fn(async () => undefined),
	upsertMentionEdge: upsertMentionEdgeMock,
	upsertEntityRelationEdge: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbeddings: vi.fn(async (_userId: string, texts: string[]) =>
		texts.map(() => [0.1, 0.2])
	)
}));

describe('syncEntityGraphFromThought precomputed path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadOntologyForUserMock.mockResolvedValue({
			entityKinds: [
				{
					key: 'person',
					name: 'Person',
					definition: 'Human',
					active: true,
					kindType: 'entity_type'
				}
			]
		});
		resolveOrCreateCanonicalEntityMock.mockResolvedValue({
			entityId: 'ent-1',
			canonicalKey: 'marcus'
		});
	});

	it('skips extractEntityGraphBundle when precomputed graph is provided', async () => {
		const precomputed = {
			mentions: [{ surface: 'Marcus', entityType: 'person', confidence: 0.9 }],
			triples: []
		};

		const { mentionCount } = await syncEntityGraphFromThought({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Marcus uses rice flour.',
			precomputedEntityGraph: precomputed
		});

		expect(extractEntityGraphBundleMock).not.toHaveBeenCalled();
		expect(mentionCount).toBe(1);
		expect(resolveOrCreateCanonicalEntityMock).toHaveBeenCalledWith(
			expect.objectContaining({ surface: 'Marcus' })
		);
	});
});
