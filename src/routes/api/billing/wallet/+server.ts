import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CREDITS_PER_USD } from '$lib/server/billing/credits';
import { getBillingPreferences } from '$lib/server/billing/preferences';
import { getOrCreateWallet } from '$lib/server/billing/wallet';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const prefs = await getBillingPreferences(user.id);
	const wallet = await getOrCreateWallet(user.id);

	return json({
		availableCredits: wallet.availableCredits,
		reservedCredits: wallet.reservedCredits,
		pendingBillingMicroUsd: wallet.pendingBillingMicroUsd,
		billingMode: prefs.billingMode,
		creditsPerUsd: CREDITS_PER_USD
	});
};
