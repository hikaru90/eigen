import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { ACTIVITY_PAGE_LLM_PROVIDERS, AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers';
import { loadActivitySpendSeries } from '$lib/server/activity/spend-series';
import { activityCallLog } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';

const PAGE_SIZE = 20;

function sumUsd(rows: Array<{ baseCostUsd: string; markupUsd: string; totalCostUsd: string }>) {
	let base = 0;
	let markup = 0;
	let total = 0;
	for (const r of rows) {
		base += Number(r.baseCostUsd);
		markup += Number(r.markupUsd);
		total += Number(r.totalCostUsd);
	}
	return {
		baseCostUsd: base.toFixed(6),
		markupUsd: markup.toFixed(6),
		totalCostUsd: total.toFixed(6)
	};
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const filter = (url.searchParams.get('type') ?? 'all') as 'all' | 'gateway' | 'agent';
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10));
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');

	const gatewayProviders = inArray(activityCallLog.provider, [...ACTIVITY_PAGE_LLM_PROVIDERS]);

	const conditions = [eq(activityCallLog.userId, locals.user.id)];
	if (filter === 'all') {
		conditions.push(or(gatewayProviders, eq(activityCallLog.provider, AGENT_TOOL_ACTIVITY_PROVIDER)));
	} else if (filter === 'gateway') {
		conditions.push(gatewayProviders);
	} else if (filter === 'agent') {
		conditions.push(eq(activityCallLog.provider, AGENT_TOOL_ACTIVITY_PROVIDER));
	}

	const fromDate = fromParam ? new Date(fromParam) : null;
	const toDate = toParam ? new Date(toParam) : null;

	if (fromDate && !Number.isNaN(fromDate.getTime())) {
		conditions.push(gte(activityCallLog.createdAt, fromDate));
	}
	if (toDate && !Number.isNaN(toDate.getTime())) {
		conditions.push(lte(activityCallLog.createdAt, toDate));
	}

	const whereClause = and(...conditions);
	const db = getDb();

	// Get distinct groups with their earliest timestamp
	const distinctGroups = await db
		.select({
			groupId: activityCallLog.groupId,
			minCreatedAt: sql<Date>`min(${activityCallLog.createdAt})`
		})
		.from(activityCallLog)
		.where(whereClause)
		.groupBy(activityCallLog.groupId)
		.orderBy(sql`min(${activityCallLog.createdAt}) DESC`);

	const totalGroups = distinctGroups.length;
	const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));
	const safePage = Math.min(page, totalPages);

	const startIdx = (safePage - 1) * PAGE_SIZE;
	const endIdx = startIdx + PAGE_SIZE;
	const pageGroupEntries = distinctGroups.slice(startIdx, endIdx);

	if (pageGroupEntries.length === 0) {
		const isGatewayFilter = filter === 'all' || filter === 'gateway';
		const spendSeries = isGatewayFilter
			? await loadActivitySpendSeries(db, {
					userId: locals.user.id,
					from: fromDate,
					to: toDate,
					totalGroups: 0
				})
			: null;

		const overallTotals = isGatewayFilter
			? await db
					.select({
						baseCostUsd: sql<string>`coalesce(sum(${activityCallLog.baseCostUsd}::numeric), 0)`,
						markupUsd: sql<string>`coalesce(sum(${activityCallLog.markupUsd}::numeric), 0)`,
						totalCostUsd: sql<string>`coalesce(sum(${activityCallLog.totalCostUsd}::numeric), 0)`
					})
					.from(activityCallLog)
					.where(
						and(
							eq(activityCallLog.userId, locals.user.id),
							gatewayProviders,
							sql`${activityCallLog.totalCostUsd}::numeric > 0`,
							...(fromDate && !Number.isNaN(fromDate.getTime()) ? [gte(activityCallLog.createdAt, fromDate)] : []),
							...(toDate && !Number.isNaN(toDate.getTime()) ? [lte(activityCallLog.createdAt, toDate)] : [])
						)
					)
					.then((r) => {
						const row = r[0] ?? { baseCostUsd: '0', markupUsd: '0', totalCostUsd: '0' };
						return {
							baseCostUsd: Number(row.baseCostUsd).toFixed(6),
							markupUsd: Number(row.markupUsd).toFixed(6),
							totalCostUsd: Number(row.totalCostUsd).toFixed(6)
						};
					})
			: { baseCostUsd: '0.000000', markupUsd: '0.000000', totalCostUsd: '0.000000' };

		return json({
			calls: [],
			totals: { baseCostUsd: '0.000000', markupUsd: '0.000000', totalCostUsd: '0.000000' },
			overallTotals,
			spendSeries,
			pagination: {
				page: safePage,
				pageSize: PAGE_SIZE,
				totalCount: totalGroups,
				totalPages,
				hasPrev: safePage > 1,
				hasNext: safePage < totalPages
			}
		});
	}

	// Fetch calls for groups on this page
	const nullGroupEntries = pageGroupEntries.filter((g) => g.groupId === null);
	const nonNullGroupIds = pageGroupEntries
		.map((g) => g.groupId)
		.filter((id): id is string => id !== null);

	const groupConditions: ReturnType<typeof sql>[] = [];
	if (nonNullGroupIds.length > 0) {
		groupConditions.push(inArray(activityCallLog.groupId, nonNullGroupIds));
	}
	if (nullGroupEntries.length > 0) {
		for (const entry of nullGroupEntries) {
			groupConditions.push(
				and(
					isNull(activityCallLog.groupId),
					eq(activityCallLog.createdAt, entry.minCreatedAt)
				)
			);
		}
	}

	const rows = await db
		.select()
		.from(activityCallLog)
		.where(and(whereClause, or(...groupConditions)))
		.orderBy(desc(activityCallLog.createdAt));

	const isGatewayFilter = filter === 'all' || filter === 'gateway';
	const totals = sumUsd(rows);

	const spendSeries = isGatewayFilter
		? await loadActivitySpendSeries(db, {
				userId: locals.user.id,
				from: fromDate,
				to: toDate,
				totalGroups
			})
		: null;

	const overallTotals = isGatewayFilter
		? await db
				.select({
					baseCostUsd: sql<string>`coalesce(sum(${activityCallLog.baseCostUsd}::numeric), 0)`,
					markupUsd: sql<string>`coalesce(sum(${activityCallLog.markupUsd}::numeric), 0)`,
					totalCostUsd: sql<string>`coalesce(sum(${activityCallLog.totalCostUsd}::numeric), 0)`
				})
				.from(activityCallLog)
				.where(
					and(
						eq(activityCallLog.userId, locals.user.id),
						gatewayProviders,
						sql`${activityCallLog.totalCostUsd}::numeric > 0`,
						...(fromDate && !Number.isNaN(fromDate.getTime()) ? [gte(activityCallLog.createdAt, fromDate)] : []),
						...(toDate && !Number.isNaN(toDate.getTime()) ? [lte(activityCallLog.createdAt, toDate)] : [])
					)
				)
				.then((r) => {
					const row = r[0] ?? { baseCostUsd: '0', markupUsd: '0', totalCostUsd: '0' };
					return {
						baseCostUsd: Number(row.baseCostUsd).toFixed(6),
						markupUsd: Number(row.markupUsd).toFixed(6),
						totalCostUsd: Number(row.totalCostUsd).toFixed(6)
					};
				})
		: { baseCostUsd: '0.000000', markupUsd: '0.000000', totalCostUsd: '0.000000' };

	return json({
		calls: rows,
		totals,
		overallTotals,
		spendSeries,
		pagination: {
			page: safePage,
			pageSize: PAGE_SIZE,
			totalCount: totalGroups,
			totalPages,
			hasPrev: safePage > 1,
			hasNext: safePage < totalPages
		}
	});
};
