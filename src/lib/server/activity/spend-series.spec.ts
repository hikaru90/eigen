import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActivitySpendSeries } from './spend-series';

const {
	chooseUnitMock,
	computeSpanMock,
	fillBucketsMock,
	utcDateKeyMock
} = vi.hoisted(() => ({
	chooseUnitMock: vi.fn(() => 'day' as const),
	computeSpanMock: vi.fn(() => ({
		from: new Date('2026-01-01T00:00:00.000Z'),
		to: new Date('2026-01-03T00:00:00.000Z'),
		spanDays: 3
	})),
	fillBucketsMock: vi.fn((buckets: unknown[]) => buckets),
	utcDateKeyMock: vi.fn((d: Date) => d.toISOString().slice(0, 10))
}));

vi.mock('$lib/activity/spend-chart', () => ({
	chooseActivitySpendBucketUnit: chooseUnitMock,
	computeActivitySpendSpan: computeSpanMock,
	fillActivitySpendBuckets: fillBucketsMock,
	utcDateKey: utcDateKeyMock
}));

function makeDb(opts: {
	earliest?: Date | null;
	latest?: Date | null;
	aggRows?: Array<{ periodStart: string; totalCostUsd: string; callCount: number }>;
}) {
	const earliest = opts.earliest ?? null;
	const latest = opts.latest ?? null;
	const aggRows = opts.aggRows ?? [];

	let selectCall = 0;
	const select = vi.fn(() => {
		selectCall += 1;
		if (selectCall === 1 || selectCall === 2) {
			const row =
				selectCall === 1
					? earliest
						? [{ createdAt: earliest }]
						: []
					: latest
						? [{ createdAt: latest }]
						: [];
			const limit = vi.fn(async () => row);
			const orderBy = vi.fn(() => ({ limit }));
			const where = vi.fn(() => ({ orderBy }));
			const from = vi.fn(() => ({ where }));
			return { from };
		}
		const orderBy = vi.fn(async () => aggRows);
		const groupBy = vi.fn(() => ({ orderBy }));
		const where = vi.fn(() => ({ groupBy }));
		const from = vi.fn(() => ({ where }));
		return { from };
	});

	return { select } as never;
}

describe('loadActivitySpendSeries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		chooseUnitMock.mockReturnValue('day');
		computeSpanMock.mockReturnValue({
			from: new Date('2026-01-01T00:00:00.000Z'),
			to: new Date('2026-01-03T00:00:00.000Z'),
			spanDays: 3
		});
		fillBucketsMock.mockImplementation((buckets: unknown[]) => buckets);
	});

	it('builds buckets from aggregated rows and distributes group counts', async () => {
		const db = makeDb({
			earliest: new Date('2026-01-01T00:00:00.000Z'),
			latest: new Date('2026-01-03T00:00:00.000Z'),
			aggRows: [
				{ periodStart: '2026-01-01', totalCostUsd: '1.5', callCount: 2 },
				{ periodStart: '2026-01-02', totalCostUsd: '0.5', callCount: 2 }
			]
		});

		const series = await loadActivitySpendSeries(db, {
			userId: 'u1',
			from: new Date('2026-01-01T00:00:00.000Z'),
			to: new Date('2026-01-03T00:00:00.000Z'),
			totalGroups: 10
		});

		expect(series.unit).toBe('day');
		expect(series.totalGroups).toBe(10);
		expect(series.buckets).toHaveLength(2);
		expect(series.buckets[0]).toMatchObject({
			periodStart: '2026-01-01',
			totalCostUsd: '1.500000',
			callCount: 2,
			groupCount: 5
		});
		expect(fillBucketsMock).toHaveBeenCalled();
	});

	it('handles empty history with zero group distribution', async () => {
		const db = makeDb({ earliest: null, latest: null, aggRows: [] });
		const series = await loadActivitySpendSeries(db, {
			userId: 'u1',
			from: null,
			to: null,
			totalGroups: 4
		});
		expect(series.buckets).toEqual([]);
		expect(series.totalGroups).toBe(4);
	});

	it('coerces string createdAt timestamps from earliest/latest rows', async () => {
		const db = makeDb({
			earliest: '2026-01-01T00:00:00.000Z' as unknown as Date,
			latest: '2026-01-02T00:00:00.000Z' as unknown as Date,
			aggRows: []
		});
		await loadActivitySpendSeries(db, {
			userId: 'u1',
			from: null,
			to: null,
			totalGroups: 0
		});
		expect(computeSpanMock).toHaveBeenCalledWith(
			expect.objectContaining({
				earliestCallAt: new Date('2026-01-01T00:00:00.000Z'),
				latestCallAt: new Date('2026-01-02T00:00:00.000Z')
			})
		);
	});
});
