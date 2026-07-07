import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	ensureUserOntologySeededMock,
	ensureCriticalEntityTypeKindsActiveMock,
	loadOntologyForUserMock,
	loadUserOntologyProfileRowMock,
	loadRecentThoughtsContextMock,
	loadCategoryDistributionMock,
	loadIngestKnownEntityHintsMock,
	loadEntityHintsForThoughtMock,
	getDbMock,
	loadGroundingProfileForEnrichmentMock
} = vi.hoisted(() => ({
	ensureUserOntologySeededMock: vi.fn(),
	ensureCriticalEntityTypeKindsActiveMock: vi.fn(),
	loadOntologyForUserMock: vi.fn(),
	loadUserOntologyProfileRowMock: vi.fn(),
	loadRecentThoughtsContextMock: vi.fn(),
	loadCategoryDistributionMock: vi.fn(),
	loadIngestKnownEntityHintsMock: vi.fn(),
	loadEntityHintsForThoughtMock: vi.fn(),
	getDbMock: vi.fn(),
	loadGroundingProfileForEnrichmentMock: vi.fn()
}));

vi.mock('$lib/server/ontology-db', () => ({
	ensureUserOntologySeeded: ensureUserOntologySeededMock,
	ensureCriticalEntityTypeKindsActive: ensureCriticalEntityTypeKindsActiveMock,
	loadOntologyForUser: loadOntologyForUserMock
}));

vi.mock('$lib/server/ontology/classify-thought-category', () => ({
	loadUserOntologyProfileRow: loadUserOntologyProfileRowMock,
	loadRecentThoughtsContext: loadRecentThoughtsContextMock,
	loadCategoryDistribution: loadCategoryDistributionMock
}));

vi.mock('$lib/server/memory/entity-graph-hints', () => ({
	loadIngestKnownEntityHints: loadIngestKnownEntityHintsMock,
	loadEntityHintsForThought: loadEntityHintsForThoughtMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/grounding/profile', () => ({
	loadGroundingProfileForEnrichment: loadGroundingProfileForEnrichmentMock
}));

import { loadEnrichmentContext } from './enrichment-context';

describe('loadEnrichmentContext', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureUserOntologySeededMock.mockResolvedValue(undefined);
		ensureCriticalEntityTypeKindsActiveMock.mockResolvedValue(undefined);
		loadOntologyForUserMock.mockResolvedValue({
			entityKinds: [{ key: 'person', active: true, kindType: 'entity_type' }],
			entityKindsByKey: new Map()
		});
		loadUserOntologyProfileRowMock.mockResolvedValue({ version: 2 });
		loadRecentThoughtsContextMock.mockResolvedValue([]);
		loadCategoryDistributionMock.mockResolvedValue(new Map());
		loadIngestKnownEntityHintsMock.mockResolvedValue([]);
		loadEntityHintsForThoughtMock.mockResolvedValue([]);
		loadGroundingProfileForEnrichmentMock.mockResolvedValue(null);
		getDbMock.mockReturnValue({
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([])
						})
					})
				})
			})
		});
	});

	it('loads cold-start context without throwing when no community summaries', async () => {
		const ctx = await loadEnrichmentContext({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Met Sarah at the coffee shop',
			rawText: 'Met Sarah at the coffee shop'
		});

		expect(ctx.knownEntities).toEqual([]);
		expect(ctx.completeness.communitySummaryCount).toBe(0);
		expect(ctx.completeness.recentThoughtCount).toBe(0);
	});

	it('merges text and graph entity hints', async () => {
		loadIngestKnownEntityHintsMock.mockResolvedValue([{ label: 'Sarah', entityType: 'person' }]);
		loadEntityHintsForThoughtMock.mockResolvedValue([{ label: 'Berlin', entityType: 'place' }]);

		const ctx = await loadEnrichmentContext({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'Trip to Berlin with Sarah',
			rawText: 'Trip to Berlin with Sarah'
		});

		expect(ctx.knownEntities).toHaveLength(2);
		expect(ctx.completeness.knownEntityCount).toBe(2);
	});
});
