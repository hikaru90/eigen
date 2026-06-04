import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBillingPreferences } from '$lib/server/billing/preferences';
import { alignWalletCurrencyWithPreference } from '$lib/server/billing/wallet';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const prefs = await getBillingPreferences(user.id);
	const wallet = await alignWalletCurrencyWithPreference(user.id, prefs.defaultBillingCurrency);

	return json({
		availableCents: wallet.availableCents,
		reservedCents: wallet.reservedCents,
		pendingBillingMicroUsd: wallet.pendingBillingMicroUsd,
		currency: wallet.currency,
		billingMode: prefs.billingMode
	});
};
