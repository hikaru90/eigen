import { describe, expect, it } from 'vitest';
import {
	canRunUmap,
	computeUmapNeighbors,
	fallbackProjection2d
} from './embedding-projection';

describe('computeUmapNeighbors', () => {
	it('never exceeds itemCount - 1', () => {
		for (const n of [3, 5, 10, 50, 370, 800]) {
			expect(computeUmapNeighbors(n)).toBeLessThanOrEqual(n - 1);
		}
	});

	it('uses 1 neighbor for a single item', () => {
		expect(computeUmapNeighbors(1)).toBe(1);
	});
});

describe('canRunUmap', () => {
	it('rejects datasets UMAP cannot embed', () => {
		expect(canRunUmap(1, 1)).toBe(false);
		expect(canRunUmap(2, 1)).toBe(false);
		expect(canRunUmap(3, 2)).toBe(true);
	});
});

describe('fallbackProjection2d', () => {
	it('returns one coordinate per item', () => {
		expect(fallbackProjection2d(1)).toEqual([[0, 0]]);
		expect(fallbackProjection2d(2)).toHaveLength(2);
		expect(fallbackProjection2d(5)).toHaveLength(5);
	});
});
