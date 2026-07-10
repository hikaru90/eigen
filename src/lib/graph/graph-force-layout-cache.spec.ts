import { describe, expect, it } from 'vitest';
import {
	clearGraphForceLayoutCache,
	getGraphForceLayoutPosition,
	graphLayoutRestartAlpha,
	graphNodesMissingLayoutPositions,
	pruneGraphForceLayoutCache,
	restoreGraphForceLayoutPositions,
	writeGraphForceLayoutPositions
} from './graph-force-layout-cache';

describe('graph-force-layout-cache', () => {
	it('restores cached positions onto nodes missing layout coords', () => {
		writeGraphForceLayoutPositions([{ id: 'a', x: 10, y: 20 }]);
		const nodes = [{ id: 'a' as const, x: undefined, y: undefined }];
		restoreGraphForceLayoutPositions(nodes);
		expect(nodes[0]).toEqual({ id: 'a', x: 10, y: 20 });
	});

	it('prunes stale node ids from the cache', () => {
		writeGraphForceLayoutPositions([
			{ id: 'a', x: 1, y: 2 },
			{ id: 'b', x: 3, y: 4 }
		]);
		pruneGraphForceLayoutCache(new Set(['a']));
		expect(getGraphForceLayoutPosition('a')).toBeDefined();
		expect(getGraphForceLayoutPosition('b')).toBeUndefined();
	});

	it('uses a gentle alpha when only a few nodes need layout', () => {
		expect(
			graphLayoutRestartAlpha([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
				{ x: 2, y: 2 },
				{ x: 3, y: 3 },
				{ x: 4, y: 4 },
				{ x: 5, y: 5 },
				{ x: 6, y: 6 },
				{ x: 7, y: 7 },
				{ x: 8, y: 8 },
				{}
			])
		).toBe(0.12);
		expect(graphLayoutRestartAlpha([{}, {}, {}])).toBe(0.35);
		expect(graphNodesMissingLayoutPositions([{ x: 0, y: 0 }])).toBe(false);
	});

	it('clears all cached positions', () => {
		writeGraphForceLayoutPositions([{ id: 'a', x: 0, y: 0 }]);
		clearGraphForceLayoutCache();
		expect(getGraphForceLayoutPosition('a')).toBeUndefined();
	});
});
