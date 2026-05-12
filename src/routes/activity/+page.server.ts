import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ACTIVITY_PAGE_LLM_PROVIDERS } from '$lib/server/activity/gateway-providers';
import { activityCallLog } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';

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

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	const rows = await getDb()
		.select()
		.from(activityCallLog)
		.where(
			and(
				eq(activityCallLog.userId, event.locals.user.id),
				inArray(activityCallLog.provider, [...ACTIVITY_PAGE_LLM_PROVIDERS])
			)
		)
		.orderBy(desc(activityCallLog.createdAt))
		.limit(100);
	const totals = sumGatewayCosts(rows);
	return { user: event.locals.user, calls: rows, totals };
};
