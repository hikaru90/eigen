import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import {
	assertValidEmbeddingSnapshotRows,
	computeEmbeddingSnapshotRevision,
	embeddingSnapshotMetaFromRows,
	loadEmbeddingSnapshotRows
} from '$lib/server/embeddings/embedding-snapshot';
import {
	canRunUmap,
	centerAndScaleCoords3d,
	computeUmapNeighbors,
	fallbackProjection3d,
	l2NormalizeEmbeddings
} from '$lib/server/embeddings/embedding-projection';

export type ProjectedEmbeddingResponse = {
	revision: string;
	coords: number[][];
	method: 'umap' | 'fallback';
};

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const rows = await loadEmbeddingSnapshotRows(getDb(), user.id);

	try {
		assertValidEmbeddingSnapshotRows(rows);
	} catch (err) {
		error(500, err instanceof Error ? err.message : String(err));
	}

	const revision = computeEmbeddingSnapshotRevision(embeddingSnapshotMetaFromRows(rows));
	const items = rows.map(({ embedding }) => ({
		embedding
	}));

	if (items.length === 0) {
		return json({ revision, coords: [], method: 'fallback' } satisfies ProjectedEmbeddingResponse);
	}

	const embeddings = l2NormalizeEmbeddings(items);
	const nNeighbors = computeUmapNeighbors(items.length);

	let coords: number[][];
	let method: 'umap' | 'fallback';

	if (canRunUmap(items.length, nNeighbors)) {
		try {
			/** Dynamic import to avoid bundling UMAP on client */
			const { UMAP } = await import('umap-js');
			const nEpochs = items.length > 200 ? 300 : 500;

			const umap = new UMAP({
				nNeighbors,
				nEpochs,
				nComponents: 3,
				minDist: 0.1,
				spread: 1.0
			});

			coords = umap.fit(embeddings);
			method = 'umap';
		} catch {
			coords = fallbackProjection3d(items.length);
			method = 'fallback';
		}
	} else {
		coords = fallbackProjection3d(items.length);
		method = 'fallback';
	}

	const centeredCoords = centerAndScaleCoords3d(coords);

	return json({
		revision,
		coords: centeredCoords,
		method
	} satisfies ProjectedEmbeddingResponse);
};
