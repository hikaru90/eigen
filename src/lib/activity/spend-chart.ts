export type ActivitySpendBucket = {
	periodStart: string;
	totalCostUsd: string;
	callCount: number;
	groupCount: number;
};

export type ActivitySpendBucketUnit = 'day' | 'week' | 'month';

export function chooseActivitySpendBucketUnit(spanDays: number): ActivitySpendBucketUnit {
	if (spanDays <= 31) return 'day';
	if (spanDays <= 180) return 'week';
	return 'month';
}

export function utcDateKey(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export function startOfUtcPeriod(d: Date, unit: ActivitySpendBucketUnit): Date {
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth();
	const day = d.getUTCDate();
	if (unit === 'day') return new Date(Date.UTC(y, m, day));
	if (unit === 'month') return new Date(Date.UTC(y, m, 1));
	const dow = d.getUTCDay();
	const diff = dow === 0 ? 6 : dow - 1;
	return new Date(Date.UTC(y, m, day - diff));
}

export function advanceUtcPeriod(d: Date, unit: ActivitySpendBucketUnit): Date {
	const next = new Date(d);
	if (unit === 'day') {
		next.setUTCDate(next.getUTCDate() + 1);
	} else if (unit === 'week') {
		next.setUTCDate(next.getUTCDate() + 7);
	} else {
		next.setUTCMonth(next.getUTCMonth() + 1);
	}
	return next;
}

export function computeActivitySpendSpan(input: {
	from: Date | null;
	to: Date | null;
	earliestCallAt: Date | null;
}): { from: Date; to: Date; spanDays: number } {
	const to = input.to ?? new Date();
	let from: Date;
	if (input.from) {
		from = input.from;
	} else if (input.earliestCallAt) {
		from = input.earliestCallAt;
	} else {
		from = new Date(to);
		from.setUTCDate(from.getUTCDate() - 30);
	}
	const spanDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
	return { from, to, spanDays };
}

/** Fill missing periods with zero spend so the chart has a continuous x-axis. */
export function fillActivitySpendBuckets(
	rows: ActivitySpendBucket[],
	from: Date,
	to: Date,
	unit: ActivitySpendBucketUnit
): ActivitySpendBucket[] {
	const byKey = new Map(rows.map((row) => [row.periodStart, row]));
	const filled: ActivitySpendBucket[] = [];
	const rangeStart = startOfUtcPeriod(from, unit);
	const rangeEnd = startOfUtcPeriod(to, unit);

	for (let cursor = rangeStart; cursor.getTime() <= rangeEnd.getTime(); cursor = advanceUtcPeriod(cursor, unit)) {
		const key = utcDateKey(cursor);
		filled.push(
			byKey.get(key) ?? {
				periodStart: key,
				totalCostUsd: '0.000000',
				callCount: 0,
				groupCount: 0
			}
		);
	}

	return filled;
}

export function formatActivitySpendBucketLabel(
	periodStart: string,
	unit: ActivitySpendBucketUnit
): string {
	const d = new Date(`${periodStart}T00:00:00.000Z`);
	if (unit === 'month') {
		return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
	}
	if (unit === 'week') {
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
	}
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
