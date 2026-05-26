import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { paymentOrder } from '$lib/server/db/schema';
import { getBillingPreferences, resolveCheckoutCurrency } from '$lib/server/billing/preferences';
import { createPayPalOrder } from '$lib/server/billing/paypal';
import { normalizeCurrencyCode } from '$lib/server/billing/money';
import { alignWalletCurrencyWithPreference } from '$lib/server/billing/wallet';

const MAX_TOP_UP_CENTS = 500_000; // 5000.00 major units

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await event.request.json().catch(() => null);
	const amountCents =
		typeof body?.amountCents === 'number'
			? body.amountCents
			: typeof body?.amountCents === 'string'
				? Number(body.amountCents)
				: NaN;

	if (!Number.isInteger(amountCents) || amountCents < 100) {
		return json({ error: 'amountCents must be an integer of at least 100 (1.00)' }, { status: 400 });
	}
	if (amountCents > MAX_TOP_UP_CENTS) {
		return json({ error: `amountCents cannot exceed ${MAX_TOP_UP_CENTS}` }, { status: 400 });
	}

	const prefs = await getBillingPreferences(user.id);
	let currency: string;
	try {
		const hint =
			typeof body?.currency === 'string' && body.currency.trim() ? body.currency : null;
		currency = resolveCheckoutCurrency(prefs, hint);
		normalizeCurrencyCode(currency);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Invalid currency';
		return json({ error: message }, { status: 400 });
	}

	await alignWalletCurrencyWithPreference(user.id, currency);

	const paypalOrder = await createPayPalOrder({ amountCents, currency });

	const db = getDb();
	const [row] = await db
		.insert(paymentOrder)
		.values({
			userId: user.id,
			paypalOrderId: paypalOrder.id,
			status: 'created',
			requestedCents: amountCents,
			currency
		})
		.returning({ id: paymentOrder.id });

	return json({
		orderId: paypalOrder.id,
		internalOrderId: row.id,
		status: paypalOrder.status,
		currency,
		amountCents
	});
};
