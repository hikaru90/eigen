import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { paymentOrder } from '$lib/server/db/schema';
import {
	capturePayPalOrder,
	getPayPalOrderCurrency
} from '$lib/server/billing/paypal';
import { getBillingPreferences, resolveCheckoutCurrency } from '$lib/server/billing/preferences';
import { creditFromPayment, getOrCreateWallet } from '$lib/server/billing/wallet';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await event.request.json().catch(() => null);
	const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
	if (!orderId) {
		return json({ error: 'orderId is required' }, { status: 400 });
	}

	const db = getDb();
	const [existing] = await db
		.select()
		.from(paymentOrder)
		.where(eq(paymentOrder.paypalOrderId, orderId))
		.limit(1);

	if (!existing || existing.userId !== user.id) {
		return json({ error: 'Order not found' }, { status: 404 });
	}

	if (existing.status === 'captured') {
		const wallet = await getOrCreateWallet(user.id, existing.currency);
		return json({
			status: 'captured',
			alreadyCaptured: true,
			availableCents: wallet.availableCents,
			currency: wallet.currency
		});
	}

	const paypalCurrency = await getPayPalOrderCurrency(orderId).catch(() => null);
	const prefs = await getBillingPreferences(user.id);
	const currency = resolveCheckoutCurrency(prefs, paypalCurrency ?? existing.currency);

	const capture = await capturePayPalOrder(orderId);

	if (capture.currency !== currency && capture.currency !== existing.currency) {
		return json(
			{
				error: `Capture currency ${capture.currency} does not match order currency ${existing.currency}`
			},
			{ status: 400 }
		);
	}

	if (capture.capturedCents !== existing.requestedCents) {
		return json(
			{
				error: `Captured amount (${capture.capturedCents} cents) does not match requested (${existing.requestedCents} cents)`
			},
			{ status: 400 }
		);
	}

	await db
		.update(paymentOrder)
		.set({
			status: 'approved',
			payerEmail: capture.payerEmail,
			rawCapture: capture.raw,
			updatedAt: new Date()
		})
		.where(eq(paymentOrder.id, existing.id));

	const result = await creditFromPayment({
		userId: user.id,
		paymentOrderId: existing.id,
		paypalOrderId: orderId,
		amountCents: capture.capturedCents,
		currency: existing.currency
	});

	return json({
		status: 'captured',
		credited: result.credited,
		availableCents: result.availableCents,
		currency: existing.currency,
		capturedCents: capture.capturedCents
	});
};
