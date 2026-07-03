import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrCreateWallet } from '$lib/server/billing/wallet';
import { ACTIVITY_PAGE_LLM_PROVIDERS } from '$lib/server/activity/gateway-providers';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const wallet = await getOrCreateWallet(event.locals.user.id);

	return {
		user: event.locals.user,
		walletAvailableCredits: wallet.availableCredits,
		gatewayProviders: [...ACTIVITY_PAGE_LLM_PROVIDERS],
		calls: [],
		groups: undefined,
		totals: { baseCostUsd: '0.000000', markupUsd: '0.000000', totalCostUsd: '0.000000' },
		overallTotals: { baseCostUsd: '0.000000', markupUsd: '0.000000', totalCostUsd: '0.000000' },
		spendSeries: null,
		from: null,
		to: null,
		pagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 1, hasPrev: false, hasNext: false }
	};
};
