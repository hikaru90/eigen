import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { ACTIVITY_PAGE_LLM_PROVIDERS, AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers';
import { loadActivitySpendSeries } from '$lib/server/activity/spend-series';
import { getOrCreateWallet } from '$lib/server/billing/wallet';
import { activityCallLog } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';

const VALID_FILTERS = ['all', 'gateway', 'agent'] as const;
type ActivityFilter = (typeof VALID_FILTERS)[number];

/** Number of groups to show per page. */
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

function parsePage(raw: string | null): number {
	const n = Number.parseInt(raw ?? '1', 10);
	return Number.isFinite(n) && n >= 1 ? n : 1;
}

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const rawFilter = event.url.searchParams.get('type') ?? 'all';
	const filter: ActivityFilter = VALID_FILTERS.includes(rawFilter as ActivityFilter)
		? (rawFilter as ActivityFilter)
		: 'all';

	const gatewayProviders = inArray(activityCallLog.provider, [...ACTIVITY_PAGE_LLM_PROVIDERS]);

	const conditions = [eq(activityCallLog.userId, event.locals.user.id)];
	if (filter === 'all') {
		conditions.push(or(gatewayProviders, eq(activityCallLog.provider, AGENT_TOOL_ACTIVITY_PROVIDER)));
	} else if (filter === 'gateway') {
		conditions.push(gatewayProviders);
	} else if (filter === 'agent') {
		conditions.push(eq(activityCallLog.provider, AGENT_TOOL_ACTIVITY_PROVIDER));
	}

	const fromParam = event.url.searchParams.get('from');
	const toParam = event.url.searchParams.get('to');

	if (fromParam) {
		const from = new Date(fromParam);
		if (!Number.isNaN(from.getTime())) {
			conditions.push(gte(activityCallLog.createdAt, from));
		}
	}
	if (toParam) {
		const to = new Date(toParam);
		if (!Number.isNaN(to.getTime())) {
			conditions.push(lte(activityCallLog.createdAt, to));
		}
	}

	const whereClause = and(...conditions);
	const page = parsePage(event.url.searchParams.get('page'));

	const db = getDb();
	const wallet = await getOrCreateWallet(event.locals.user.id);

	// Step 1: Get all distinct groups with their earliest timestamp
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

	// Step 2: Get group IDs for the current page
	const startIdx = (safePage - 1) * PAGE_SIZE;
	const endIdx = startIdx + PAGE_SIZE;
	const pageGroupEntries = distinctGroups.slice(startIdx, endIdx);

	if (pageGroupEntries.length === 0) {
		// Empty page - no groups
		const isGatewayFilter = filter === 'all' || filter === 'gateway';
		const fromDate =
			fromParam && !Number.isNaN(new Date(fromParam).getTime()) ? new Date(fromParam) : null;
		const toDate = toParam && !Number.isNaN(new Date(toParam).getTime()) ? new Date(toParam) : null;

		const spendSeries = isGatewayFilter
			? await loadActivitySpendSeries(db, {
					userId: event.locals.user.id,
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
							eq(activityCallLog.userId, event.locals.user.id),
							gatewayProviders,
							sql`${activityCallLog.totalCostUsd}::numeric > 0`,
							...(fromDate ? [gte(activityCallLog.createdAt, fromDate)] : []),
							...(toDate ? [lte(activityCallLog.createdAt, toDate)] : [])
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

		return {
			user: event.locals.user,
			walletAvailableCredits: wallet.availableCredits,
			calls: [],
			groups: [],
			totals: { baseCostUsd: '0.000000', markupUsd: '0.000000', totalCostUsd: '0.000000' },
			overallTotals,
			spendSeries,
			filter,
			from: fromParam ?? null,
			to: toParam ?? null,
			pagination: {
				page: safePage,
				pageSize: PAGE_SIZE,
				totalCount: totalGroups,
				totalPages,
				hasPrev: safePage > 1,
				hasNext: safePage < totalPages
			}
		};
	}

	// Step 3: Fetch all calls for the groups on this page
	// Separate null and non-null group IDs for proper query construction
	const nullGroupEntries = pageGroupEntries.filter((g) => g.groupId === null);
	const nonNullGroupIds = pageGroupEntries
		.map((g) => g.groupId)
		.filter((id): id is string => id !== null);

	// Build conditions for matching groups
	const groupConditions: ReturnType<typeof sql>[] = [];
	if (nonNullGroupIds.length > 0) {
		groupConditions.push(inArray(activityCallLog.groupId, nonNullGroupIds));
	}
	if (nullGroupEntries.length > 0) {
		// For ungrouped entries (null groupId), use IS NULL (can't use eq() for NULL)
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

	const fromDate =
		fromParam && !Number.isNaN(new Date(fromParam).getTime()) ? new Date(fromParam) : null;
	const toDate = toParam && !Number.isNaN(new Date(toParam).getTime()) ? new Date(toParam) : null;

	const spendSeries = isGatewayFilter
		? await loadActivitySpendSeries(db, {
				userId: event.locals.user.id,
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
						eq(activityCallLog.userId, event.locals.user.id),
						gatewayProviders,
						sql`${activityCallLog.totalCostUsd}::numeric > 0`,
						...(fromDate ? [gte(activityCallLog.createdAt, fromDate)] : []),
						...(toDate ? [lte(activityCallLog.createdAt, toDate)] : [])
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

	return {
		user: event.locals.user,
		walletAvailableCredits: wallet.availableCredits,
		calls: rows,
		// groups computed client-side from calls
		groups: undefined,
		totals,
		overallTotals,
		spendSeries,
		filter,
		from: fromParam ?? null,
		to: toParam ?? null,
		pagination: {
			page: safePage,
			pageSize: PAGE_SIZE,
			totalCount: totalGroups,
			totalPages,
			hasPrev: safePage > 1,
			hasNext: safePage < totalPages
		}
	};
};
