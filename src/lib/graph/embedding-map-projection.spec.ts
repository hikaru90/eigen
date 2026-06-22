import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ensureEmbeddingProjection,
	getEmbeddingProjectionPhase,
	invalidateEmbeddingProjection
} from './embedding-map-projection';

vi.mock('umap-js', () => ({
	UMAP: class {
		constructor() {}
		async fitAsync(_embeddings: number[][], onEpoch: (epoch: number) => boolean) {
			onEpoch(1);
			return _embeddings.map((_, i) => [i, i, i]);
		}
	}
}));

function makeItem(id: string) {
	return {
		id,
		kind: 'Thought' as const,
		label: id,
		subtype: 'observation',
		embedding: Array.from({ length: 1536 }, (_, i) => i * 0.001)
	};
}

describe('embedding-map-projection', () => {
	beforeEach(() => {
		invalidateEmbeddingProjection();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		invalidateEmbeddingProjection();
		vi.unstubAllGlobals();
	});

	it('reuses cached projection when revision is unchanged', async () => {
		const revision = 'rev-1';
		const items = [makeItem('t1')];
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ revision, items }), { status: 200 })
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ revision }), { status: 200 }));

		await ensureEmbeddingProjection();
		expect(getEmbeddingProjectionPhase().kind).toBe('ready');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await ensureEmbeddingProjection();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/embeddings/revision');
		expect(getEmbeddingProjectionPhase().kind).toBe('ready');
	});

	it('refetches and reprojects after forced refresh', async () => {
		const revisionA = 'rev-a';
		const revisionB = 'rev-b';
		const itemsA = [makeItem('t1')];
		const itemsB = [makeItem('t1'), makeItem('t2')];
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ revision: revisionA, items: itemsA }), { status: 200 })
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ revision: revisionB, items: itemsB }), { status: 200 })
			);

		await ensureEmbeddingProjection();
		await ensureEmbeddingProjection(true);

		const phase = getEmbeddingProjectionPhase();
		expect(phase.kind).toBe('ready');
		if (phase.kind === 'ready') {
			expect(phase.items).toHaveLength(2);
		}
	});
});
