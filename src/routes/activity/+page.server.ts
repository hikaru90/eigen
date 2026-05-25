import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { ACTIVITY_PAGE_LLM_PROVIDERS, AGENT_TOOL_ACTIVITY_PROVIDER } from '$lib/server/activity/gateway-providers';
import { activityCallLog } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';

const VALID_FILTERS = ['all', 'gateway', 'agent'] as const;
type ActivityFilter = (typeof VALID_FILTERS)[number];

function sumGatewayCosts(
	rows: Array<{ baseCostUsd: string; markupUsd: string; totalCostUsd: string }>
) {
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

function groupCalls(rows: Array<{ groupId: string | null; createdAt: Date }>) {
	const groups: Array<{ groupId: string | null; groupStart: Date; callCount: number }> = [];
	const seen = new Map<string, number>();

	for (const row of rows) {
		const key = row.groupId ?? `__ungrouped__${row.createdAt.getTime()}_${Math.random()}`;
		const idx = seen.get(key);
		if (idx !== undefined) {
			groups[idx].callCount += 1;
			if (row.createdAt < groups[idx].groupStart) {
				groups[idx].groupStart = row.createdAt;
			}
		} else {
			seen.set(key, groups.length);
			groups.push({ groupId: row.groupId, groupStart: row.createdAt, callCount: 1 });
		}
	}

	return groups;
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

	const rows = await getDb()
		.select()
		.from(activityCallLog)
		.where(and(...conditions))
		.orderBy(desc(activityCallLog.createdAt))
		.limit(100);

	const isGatewayFilter = filter === 'all' || filter === 'gateway';

	const totals = sumGatewayCosts(rows);
	const groups = groupCalls(rows);

	const overallTotals = isGatewayFilter
		? await getDb()
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
						...(fromParam && !Number.isNaN(new Date(fromParam).getTime())
							? [gte(activityCallLog.createdAt, new Date(fromParam))]
							: []),
						...(toParam && !Number.isNaN(new Date(toParam).getTime())
							? [lte(activityCallLog.createdAt, new Date(toParam))]
							: [])
					)
				)
				.then((r) => r[0] ?? { baseCostUsd: '0', markupUsd: '0', totalCostUsd: '0' })
		: { baseCostUsd: '0', markupUsd: '0', totalCostUsd: '0' };

	return { user: event.locals.user, calls: rows, groups, totals, overallTotals, filter, from: fromParam ?? null, to: toParam ?? null };
};
