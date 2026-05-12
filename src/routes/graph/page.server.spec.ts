import { isActionFailure } from '@sveltejs/kit';
import { assert, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

const { fetchSnapshotMock, pruneMock, recomputeMock } = vi.hoisted(() => ({
	fetchSnapshotMock: vi.fn(),
	pruneMock: vi.fn().mockResolvedValue({
		deletedEntityKindIds: [] as string[],
		deletedRelationKindIds: [] as string[]
	}),
	recomputeMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(() => ({}))
}));

vi.mock('$lib/server/graph/falkor', () => ({
	fetchGraphVisualizationSnapshot: fetchSnapshotMock
}));

vi.mock('$lib/server/ontology-db', () => ({
	ensureUserOntologySeeded: vi.fn().mockResolvedValue(undefined),
	loadOntologyForUser: vi.fn().mockResolvedValue({
		entityKinds: [],
		relationKinds: [],
		entityKindsById: new Map(),
		entityKindsByKey: new Map(),
		relationKindsById: new Map(),
		relationKindsByKey: new Map()
	}),
	pruneUnusedOntologyEntityKinds: pruneMock
}));

vi.mock('$lib/server/ontology', () => ({
	recomputeUserOntologyProfileForUser: recomputeMock
}));

describe('graph page server', () => {
	it('redirects unauthenticated user', async () => {
		await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 });
	});

	it('returns snapshot for signed-in user', async () => {
		fetchSnapshotMock.mockResolvedValueOnce({ nodes: [], edges: [] });
		const data = await load({
			locals: {
				user: { id: 'u1', email: 'a@b.c' }
			}
		} as never);
		expect(data).toBeTruthy();
		if (!data) return;
		expect(data.snapshot).toEqual({ nodes: [], edges: [] });
		expect(Array.isArray(data.graphLegendSections)).toBe(true);
		expect(data.graphLegendSections!.length).toBeGreaterThan(0);
		expect(fetchSnapshotMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', nodeLimit: 500, edgeLimit: 1200 })
		);
	});

	it('recomputeOntology prunes unused kinds then refreshes classifier profile', async () => {
		pruneMock.mockResolvedValueOnce({
			deletedEntityKindIds: ['e1'],
			deletedRelationKindIds: ['r1']
		});
		const result = await actions.recomputeOntology({
			locals: { user: { id: 'u1' } },
			request: new Request('http://test/graph', { method: 'POST', body: new FormData() })
		} as never);
		expect(isActionFailure(result)).toBe(false);
		assert(!isActionFailure(result));
		expect(pruneMock).toHaveBeenCalledTimes(1);
		expect(recomputeMock).toHaveBeenCalledWith('u1');
		expect(result.ontologyMessage).toContain('Removed 1 unused ontology entity kind');
		expect(result.ontologyMessage).toContain('Classifier ontology profile refreshed');
	});
});
