import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { paymentOrder } from '$lib/server/db/schema';
import { capturePayPalOrder } from '$lib/server/billing/paypal';
import { creditFromPayment, getOrCreateWallet } from '$lib/server/billing/wallet';
import { CREDITS_PER_USD } from '$lib/server/billing/credits';
import { captureServerEvent } from '$lib/server/analytics/posthog-server';

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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
		captureServerEvent({
			distinctId: user.id,
			event: 'billing_order_capture_failed',
			properties: {
				paypal_order_id: orderId,
				error_message: 'Order not found'
			}
		});
		return json({ error: 'Order not found' }, { status: 404 });
	}

	if (existing.status === 'captured') {
		const wallet = await getOrCreateWallet(user.id);
		captureServerEvent({
			distinctId: user.id,
			event: 'billing_order_capture_replayed',
			properties: {
				paypal_order_id: orderId,
				internal_order_id: existing.id,
				amount_credits: existing.requestedCredits,
				available_credits: wallet.availableCredits
			}
		});
		return json({
			status: 'captured',
			alreadyCaptured: true,
			availableCredits: wallet.availableCredits,
			creditsPerUsd: CREDITS_PER_USD
		});
	}

	try {
		const capture = await capturePayPalOrder(orderId);

		if (capture.capturedCredits !== existing.requestedCredits) {
			const message = `Captured credits (${capture.capturedCredits}) do not match requested (${existing.requestedCredits})`;
			captureServerEvent({
				distinctId: user.id,
				event: 'billing_order_capture_failed',
				properties: {
					paypal_order_id: orderId,
					internal_order_id: existing.id,
					amount_credits: existing.requestedCredits,
					error_message: message
				}
			});
			return json({ error: message }, { status: 400 });
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
			amountCredits: capture.capturedCredits
		});

		captureServerEvent({
			distinctId: user.id,
			event: 'billing_order_captured',
			properties: {
				paypal_order_id: orderId,
				internal_order_id: existing.id,
				amount_credits: capture.capturedCredits,
				credited: result.credited,
				available_credits: result.availableCredits
			}
		});

		return json({
			status: 'captured',
			credited: result.credited,
			availableCredits: result.availableCredits,
			capturedCredits: capture.capturedCredits,
			creditsPerUsd: CREDITS_PER_USD
		});
	} catch (error) {
		captureServerEvent({
			distinctId: user.id,
			event: 'billing_order_capture_failed',
			properties: {
				paypal_order_id: orderId,
				internal_order_id: existing.id,
				amount_credits: existing.requestedCredits,
				error_message: errorMessage(error)
			}
		});
		throw error;
	}
};
