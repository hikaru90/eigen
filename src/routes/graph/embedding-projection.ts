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

/** Deterministic 3D layout when UMAP cannot run (too few points). */
export function fallbackProjection3d(itemCount: number): number[][] {
	if (itemCount === 1) return [[0, 0, 0]];
	if (itemCount === 2) return [[-1, 0, 0], [1, 0, 0]];
	const coords: number[][] = [];
	const radius = 1 + itemCount * 0.05;
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < itemCount; i++) {
		const t = (i + 0.5) / itemCount;
		const phi = Math.acos(1 - 2 * t);
		const theta = goldenAngle * i;
		coords.push([
			radius * Math.sin(phi) * Math.cos(theta),
			radius * Math.sin(phi) * Math.sin(theta),
			radius * Math.cos(phi)
		]);
	}
	return coords;
}

/** Center a 3D point cloud and scale so the farthest point sits at unit radius. */
export function centerAndScaleCoords3d(coords: number[][]): number[][] {
	if (coords.length === 0) return [];
	let cx = 0;
	let cy = 0;
	let cz = 0;
	for (const [x, y, z] of coords) {
		cx += x;
		cy += y;
		cz += z;
	}
	cx /= coords.length;
	cy /= coords.length;
	cz /= coords.length;

	let maxDist = 0;
	for (const [x, y, z] of coords) {
		const dx = x - cx;
		const dy = y - cy;
		const dz = z - cz;
		const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (dist > maxDist) maxDist = dist;
	}

	const scale = maxDist > 0 ? 1 / maxDist : 1;
	return coords.map(([x, y, z]) => [(x - cx) * scale, (y - cy) * scale, (z - cz) * scale]);
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
