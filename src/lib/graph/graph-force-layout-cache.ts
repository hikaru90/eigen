/** Persisted force-layout positions survive /memory unmount (timeline, notes, nav away). */

export type GraphForceLayoutCachedNode = {
	id: string;
	x: number;
	y: number;
};

const positionsById = new Map<string, GraphForceLayoutCachedNode>();

export function getGraphForceLayoutPosition(
	id: string
): GraphForceLayoutCachedNode | undefined {
	return positionsById.get(id);
}

export function writeGraphForceLayoutPositions(
	nodes: ReadonlyArray<{ id: string; x?: number; y?: number }>
): void {
	for (const node of nodes) {
		if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
		positionsById.set(node.id, { id: node.id, x: node.x!, y: node.y! });
	}
}

export function pruneGraphForceLayoutCache(keepIds: ReadonlySet<string>): void {
	for (const id of positionsById.keys()) {
		if (!keepIds.has(id)) positionsById.delete(id);
	}
}

export function clearGraphForceLayoutCache(): void {
	positionsById.clear();
}

export function restoreGraphForceLayoutPositions<
	T extends { id: string; x?: number; y?: number }
>(nodes: ReadonlyArray<T>): void {
	for (const node of nodes) {
		if (Number.isFinite(node.x) && Number.isFinite(node.y)) continue;
		const cached = positionsById.get(node.id);
		if (!cached) continue;
		node.x = cached.x;
		node.y = cached.y;
	}
}

export function graphNodesMissingLayoutPositions(
	nodes: ReadonlyArray<{ x?: number; y?: number }>
): boolean {
	return nodes.some((node) => !Number.isFinite(node.x) || !Number.isFinite(node.y));
}

/** Lower alpha when only a few nodes lack positions so the settled graph does not jiggle. */
export function graphLayoutRestartAlpha(
	nodes: ReadonlyArray<{ x?: number; y?: number }>
): number {
	if (nodes.length === 0) return 0.35;
	const missing = nodes.filter(
		(node) => !Number.isFinite(node.x) || !Number.isFinite(node.y)
	).length;
	if (missing === 0) return 0;
	if (missing / nodes.length <= 0.15) return 0.12;
	return 0.35;
}
