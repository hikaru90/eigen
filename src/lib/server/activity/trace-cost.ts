import { and, eq } from 'drizzle-orm';
import { totalCostUsdToCredits } from '$lib/billing/platform-pricing';
import type { AppDatabase } from '$lib/server/db';
import { activityCallLog } from '$lib/server/db/schema';

export type ActivityCostRow = {
	operation: string;
	baseCostUsd: string;
	markupUsd: string;
	totalCostUsd: string;
	durationMs: number | null;
};

export type OperationCostStats = {
	count: number;
	totalUsd: string;
	totalMs: number;
};

export type ActivityCostAggregate = {
	totalUsd: string;
	totalCredits: number;
	totalMs: number;
	callCount: number;
	byOperation: Record<string, OperationCostStats>;
};

function fmtUsd(n: number): string {
	return Number.isFinite(n) && n >= 0 ? n.toFixed(6) : '0.000000';
}

/** Pure aggregation for unit tests and DB loaders. */
export function aggregateActivityCostFromRows(rows: ActivityCostRow[]): ActivityCostAggregate {
	let usdSum = 0;
	let msSum = 0;
	const byOperation: Record<string, OperationCostStats> = {};

	for (const row of rows) {
		const parsed = Number(row.totalCostUsd);
		const usd = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
		const ms = typeof row.durationMs === 'number' && row.durationMs >= 0 ? row.durationMs : 0;
		const op = row.operation?.trim() || 'unknown';

		usdSum += usd;
		msSum += ms;

		const cur = byOperation[op] ?? { count: 0, totalUsd: '0.000000', totalMs: 0 };
		cur.count += 1;
		cur.totalMs += ms;
		cur.totalUsd = fmtUsd(Number(cur.totalUsd) + usd);
		byOperation[op] = cur;
	}

	return {
		totalUsd: fmtUsd(usdSum),
		totalCredits: totalCostUsdToCredits(fmtUsd(usdSum)),
		totalMs: msSum,
		callCount: rows.length,
		byOperation
	};
}

/** Sum gateway cost and latency for all activity rows in a trace group. */
export async function aggregateActivityCostByGroupId(
	db: AppDatabase,
	userId: string,
	groupId: string
): Promise<ActivityCostAggregate> {
	const rows = await db
		.select({
			operation: activityCallLog.operation,
			baseCostUsd: activityCallLog.baseCostUsd,
			markupUsd: activityCallLog.markupUsd,
			totalCostUsd: activityCallLog.totalCostUsd,
			durationMs: activityCallLog.durationMs
		})
		.from(activityCallLog)
		.where(and(eq(activityCallLog.userId, userId), eq(activityCallLog.groupId, groupId)));

	return aggregateActivityCostFromRows(rows);
}

/** Sum all gateway activity cost for a tenant (harness spend snapshots). */
export async function aggregateUserActivityCost(
	db: AppDatabase,
	userId: string
): Promise<ActivityCostAggregate> {
	const rows = await db
		.select({
			operation: activityCallLog.operation,
			baseCostUsd: activityCallLog.baseCostUsd,
			markupUsd: activityCallLog.markupUsd,
			totalCostUsd: activityCallLog.totalCostUsd,
			durationMs: activityCallLog.durationMs
		})
		.from(activityCallLog)
		.where(eq(activityCallLog.userId, userId));

	return aggregateActivityCostFromRows(rows);
}
