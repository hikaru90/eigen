import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './fusion';

describe('reciprocalRankFusion', () => {
	it('sums contributions for ids appearing across rankings', () => {
		const out = reciprocalRankFusion([
			[
				{ id: 'a', rank: 1 },
				{ id: 'b', rank: 2 }
			],
			[
				{ id: 'b', rank: 1 },
				{ id: 'c', rank: 2 }
			]
		]);

		expect(out.get('a')).toBeCloseTo(1 / 61);
		expect(out.get('b')).toBeCloseTo(1 / 62 + 1 / 61);
		expect(out.get('c')).toBeCloseTo(1 / 62);
	});

	it('respects custom k', () => {
		const out = reciprocalRankFusion([[{ id: 'a', rank: 1 }]], 1);
		expect(out.get('a')).toBeCloseTo(0.5);
	});
});
