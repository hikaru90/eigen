import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

const { fetchSnapshotMock, fetchCommunitiesMock } = vi.hoisted(() => ({
	fetchSnapshotMock: vi.fn(),
	fetchCommunitiesMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(() => ({}))
}));

vi.mock('$lib/server/graph/falkor', () => ({
	fetchGraphVisualizationSnapshot: fetchSnapshotMock
}));

vi.mock('$lib/server/graph/community-overlays', () => ({
	fetchGraphCommunityOverlays: fetchCommunitiesMock
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
	})
}));

describe('graph page server', () => {
	it('redirects unauthenticated user', async () => {
		await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 });
	});

	it('returns snapshot for signed-in user', async () => {
		fetchSnapshotMock.mockResolvedValueOnce({ nodes: [], edges: [] });
		fetchCommunitiesMock.mockResolvedValueOnce([]);
		const data = await load({
			locals: {
				user: { id: 'u1', email: 'a@b.c' }
			}
		} as never);
		expect(data).toBeTruthy();
		if (!data) return;
		expect(data.snapshot).toEqual({ nodes: [], edges: [] });
		expect(data.communities).toEqual([]);
		expect(Array.isArray(data.graphLegendSections)).toBe(true);
		expect(fetchSnapshotMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', nodeLimit: 500, edgeLimit: 1200 })
		);
	});
});
