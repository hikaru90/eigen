import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { paymentOrder } from '$lib/server/db/schema';
import { createPayPalOrder } from '$lib/server/billing/paypal';
import { MIN_TOP_UP_CREDITS } from '$lib/server/billing/credits';

const MAX_TOP_UP_CREDITS = 5_000_000; // $5000 USD at 1000 credits per dollar

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await event.request.json().catch(() => null);
	const amountCredits =
		typeof body?.amountCredits === 'number'
			? body.amountCredits
			: typeof body?.amountCredits === 'string'
				? Number(body.amountCredits)
				: NaN;

	if (!Number.isInteger(amountCredits) || amountCredits < MIN_TOP_UP_CREDITS) {
		return json(
			{ error: `amountCredits must be an integer of at least ${MIN_TOP_UP_CREDITS}` },
			{ status: 400 }
		);
	}
	if (amountCredits > MAX_TOP_UP_CREDITS) {
		return json({ error: `amountCredits cannot exceed ${MAX_TOP_UP_CREDITS}` }, { status: 400 });
	}

	const paypalOrder = await createPayPalOrder({ amountCredits });

	const db = getDb();
	const [row] = await db
		.insert(paymentOrder)
		.values({
			userId: user.id,
			paypalOrderId: paypalOrder.id,
			status: 'created',
			requestedCredits: amountCredits,
			currency: 'USD'
		})
		.returning({ id: paymentOrder.id });

	return json({
		orderId: paypalOrder.id,
		internalOrderId: row.id,
		status: paypalOrder.status,
		amountCredits
	});
};
