import { describe, expect, it } from 'vitest';
import {
	chooseActivitySpendBucketUnit,
	computeActivitySpendSpan,
	fillActivitySpendBuckets,
	startOfUtcPeriod,
	utcDateKey
} from './spend-chart';

describe('activity spend chart helpers', () => {
	it('chooses bucket unit from span length', () => {
		expect(chooseActivitySpendBucketUnit(7)).toBe('day');
		expect(chooseActivitySpendBucketUnit(31)).toBe('day');
		expect(chooseActivitySpendBucketUnit(32)).toBe('week');
		expect(chooseActivitySpendBucketUnit(180)).toBe('week');
		expect(chooseActivitySpendBucketUnit(181)).toBe('month');
	});

	it('defaults span to last 30 days when no bounds or history', () => {
		const to = new Date('2026-03-01T12:00:00.000Z');
		const span = computeActivitySpendSpan({ from: null, to, earliestCallAt: null });
		expect(span.spanDays).toBe(30);
		expect(utcDateKey(span.from)).toBe('2026-01-30');
	});

	it('fills missing daily buckets with zero spend', () => {
		const from = new Date('2026-01-01T00:00:00.000Z');
		const to = new Date('2026-01-03T00:00:00.000Z');
		const filled = fillActivitySpendBuckets(
			[{ periodStart: '2026-01-02', totalCostUsd: '1.200000', callCount: 2, groupCount: 1 }],
			from,
			to,
			'day'
		);
		expect(filled).toEqual([
			{ periodStart: '2026-01-01', totalCostUsd: '0.000000', callCount: 0, groupCount: 0 },
			{ periodStart: '2026-01-02', totalCostUsd: '1.200000', callCount: 2, groupCount: 1 },
			{ periodStart: '2026-01-03', totalCostUsd: '0.000000', callCount: 0, groupCount: 0 }
		]);
	});

	it('starts weekly buckets on Monday UTC', () => {
		const wed = new Date('2026-01-07T15:00:00.000Z');
		expect(utcDateKey(startOfUtcPeriod(wed, 'week'))).toBe('2026-01-05');
	});
});
