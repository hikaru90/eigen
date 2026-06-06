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

/** White radial hull fill — full strength at overview zoom; pair with zoom-scaled opacity. */
export const COMMUNITY_HULL_GRADIENT = {
	center: 'oklch(1 0 0 / 0.88)',
	mid: 'oklch(1 0 0 / 0.14)',
	edge: 'oklch(1 0 0 / 0)'
};

/** Fade hull fills when zoomed in so large communities do not read as a solid white page. */
export function communityHullFillOpacityForZoom(scale: number): number {
	if (!Number.isFinite(scale) || scale <= 1) return 1;
	return Math.max(0.12, 1 / scale);
}

export function communityGradientId(_level?: number): string {
	return 'graph-community-fill';
}
