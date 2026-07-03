import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AppDatabase } from '$lib/server/db';
import { activityCallLog } from '$lib/server/db/schema';
import {
	chooseActivitySpendBucketUnit,
	computeActivitySpendSpan,
	fillActivitySpendBuckets,
	utcDateKey,
	type ActivitySpendBucket,
	type ActivitySpendBucketUnit
} from '$lib/activity/spend-chart';
import { ACTIVITY_PAGE_LLM_PROVIDERS } from './gateway-providers';

export type ActivitySpendSeries = {
	unit: ActivitySpendBucketUnit;
	buckets: ActivitySpendBucket[];
	totalGroups: number;
};

const TRUNC_SQL: Record<ActivitySpendBucketUnit, ReturnType<typeof sql>> = {
	day: sql`date_trunc('day', ${activityCallLog.createdAt})`,
	week: sql`date_trunc('week', ${activityCallLog.createdAt})`,
	month: sql`date_trunc('month', ${activityCallLog.createdAt})`
};

export async function loadActivitySpendSeries(
	db: AppDatabase,
	input: {
		userId: string;
		from: Date | null;
		to: Date | null;
		totalGroups: number;
	}
): Promise<ActivitySpendSeries> {
	const gatewayProviders = inArray(activityCallLog.provider, [...ACTIVITY_PAGE_LLM_PROVIDERS]);
	const baseConditions = [
		eq(activityCallLog.userId, input.userId),
		gatewayProviders,
		sql`${activityCallLog.totalCostUsd}::numeric > 0`
	];

	if (input.from) baseConditions.push(gte(activityCallLog.createdAt, input.from));
	if (input.to) baseConditions.push(lte(activityCallLog.createdAt, input.to));

	const coerceCreatedAt = (value: unknown): Date => {
		if (value instanceof Date) return value;
		return new Date(String(value));
	};

	const [earliestRow] = await db
		.select({ createdAt: activityCallLog.createdAt })
		.from(activityCallLog)
		.where(and(...baseConditions))
		.orderBy(activityCallLog.createdAt)
		.limit(1);

	const [latestRow] = await db
		.select({ createdAt: activityCallLog.createdAt })
		.from(activityCallLog)
		.where(and(...baseConditions))
		.orderBy(sql`${activityCallLog.createdAt} DESC`)
		.limit(1);

	const earliestCallAt = earliestRow?.createdAt ? coerceCreatedAt(earliestRow.createdAt) : null;
	const latestCallAt = latestRow?.createdAt ? coerceCreatedAt(latestRow.createdAt) : null;
	const allTime = !input.from && !input.to;

	const span = computeActivitySpendSpan({
		from: input.from,
		to: input.to,
		earliestCallAt: allTime || !input.from ? earliestCallAt : null,
		latestCallAt: allTime || !input.to ? latestCallAt : null
	});
	const unit = chooseActivitySpendBucketUnit(span.spanDays);
	const trunc = TRUNC_SQL[unit];

	const rows = await db
		.select({
			periodStart: sql<string>`(${trunc})::date`,
			totalCostUsd: sql<string>`coalesce(sum(${activityCallLog.totalCostUsd}::numeric), 0)`,
			callCount: sql<number>`count(*)::int`
		})
		.from(activityCallLog)
		.where(
			and(
				...baseConditions,
				gte(activityCallLog.createdAt, span.from),
				lte(activityCallLog.createdAt, span.to)
			)
		)
		.groupBy(trunc)
		.orderBy(trunc);

	// Use the totalGroups passed from the page server
	const totalGroups = input.totalGroups;

	// Distribute groups proportionally across periods based on call distribution
	const totalCalls = rows.reduce((sum, r) => sum + r.callCount, 0);

	const normalized: ActivitySpendBucket[] = rows.map((row) => ({
		periodStart: utcDateKey(new Date(`${String(row.periodStart)}T00:00:00.000Z`)),
		totalCostUsd: Number(row.totalCostUsd).toFixed(6),
		callCount: row.callCount,
		groupCount: totalCalls > 0 ? Math.round((row.callCount / totalCalls) * totalGroups) : 0
	}));

	return {
		unit,
		buckets: fillActivitySpendBuckets(normalized, span.from, span.to, unit),
		totalGroups
	};
}
