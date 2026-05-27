import type { EmbeddingSnapshotItem } from '../api/embeddings/snapshot/+server';

/** UMAP requires strictly more points than nNeighbors. */
export function computeUmapNeighbors(itemCount: number): number {
	if (itemCount <= 1) return 1;
	return Math.min(30, Math.min(itemCount - 1, Math.max(1, Math.round(Math.sqrt(itemCount) * 2))));
}

/** Deterministic 2D layout when UMAP cannot run (too few points). */
export function fallbackProjection2d(itemCount: number): number[][] {
	if (itemCount === 1) return [[0, 0]];
	if (itemCount === 2) return [[-1, 0], [1, 0]];
	const coords: number[][] = [];
	const radius = 1 + itemCount * 0.05;
	for (let i = 0; i < itemCount; i++) {
		const angle = (2 * Math.PI * i) / itemCount;
		coords.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
	}
	return coords;
}

export function l2NormalizeEmbeddings(items: EmbeddingSnapshotItem[]): number[][] {
	return items.map((i) => {
		const v = i.embedding.map((x) => (typeof x === 'number' ? x : Number.parseFloat(String(x))));
		let sumSq = 0;
		for (const x of v) sumSq += x * x;
		const norm = Math.sqrt(sumSq);
		if (norm === 0) return v;
		return v.map((x) => x / norm);
	});
}

export function canRunUmap(itemCount: number, nNeighbors: number): boolean {
	return itemCount > nNeighbors && itemCount >= 3;
}
