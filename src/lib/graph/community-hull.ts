/** Centroid + enclosing radius for member node positions (graph coordinates). */
export function communityCircleFromPositions(
	positions: ReadonlyArray<{ x: number; y: number }>,
	padding = 28
): { cx: number; cy: number; r: number } | null {
	if (positions.length === 0) return null;
	let cx = 0;
	let cy = 0;
	for (const p of positions) {
		cx += p.x;
		cy += p.y;
	}
	cx /= positions.length;
	cy /= positions.length;
	let maxDist = 0;
	for (const p of positions) {
		maxDist = Math.max(maxDist, Math.hypot(p.x - cx, p.y - cy));
	}
	return { cx, cy, r: Math.max(padding, maxDist + padding) };
}

/** Single hull fill: white center fading to transparent (no per-level tint stack). */
export const COMMUNITY_HULL_GRADIENT = {
	center: 'oklch(1 0 0 / 0.88)',
	mid: 'oklch(1 0 0 / 0.14)',
	edge: 'oklch(1 0 0 / 0)'
};

export function communityGradientId(_level?: number): string {
	return 'graph-community-fill';
}
