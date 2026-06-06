import { insertEvalUserRow } from '$lib/eval/store';
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits';
import {
	assertCanAfford,
	creditFromPayment,
	getOrCreateWallet
} from '$lib/server/billing/wallet';
import { paymentOrder } from '$lib/server/db/schema';
import { withEvalDb } from '../harness/eval-context';

export const LONGMEMEVAL_OPERATOR_USER_ID = 'longmemeval-runner';

/** Minimum credits to seed when the operator wallet is empty (local dev). */
const SEED_CREDITS = 50_000;

/**
 * Ensure the LongMemEval operator exists and can afford at least one capture pipeline.
 * Mirrors scripts/verify-eigen-credits.mjs eval-operator seeding for local runs.
 */
export async function ensureLongMemEvalOperatorReady(): Promise<void> {
	await insertEvalUserRow(LONGMEMEVAL_OPERATOR_USER_ID, 'LongMemEval Runner');

	let wallet = await withEvalDb(LONGMEMEVAL_OPERATOR_USER_ID, () =>
		getOrCreateWallet(LONGMEMEVAL_OPERATOR_USER_ID)
	);

	if (wallet.availableCredits < MIN_CAPTURE_PIPELINE_CREDITS) {
		const paypalOrderId = `longmemeval_seed_${Date.now()}`;
		await withEvalDb(LONGMEMEVAL_OPERATOR_USER_ID, async (db) => {
			const [row] = await db
				.insert(paymentOrder)
				.values({
					userId: LONGMEMEVAL_OPERATOR_USER_ID,
					paypalOrderId,
					status: 'created',
					requestedCredits: SEED_CREDITS,
					currency: 'USD'
				})
				.returning({ id: paymentOrder.id });
			await creditFromPayment({
				userId: LONGMEMEVAL_OPERATOR_USER_ID,
				paymentOrderId: row.id,
				paypalOrderId,
				amountCredits: SEED_CREDITS
			});
		});
		wallet = await withEvalDb(LONGMEMEVAL_OPERATOR_USER_ID, () =>
			getOrCreateWallet(LONGMEMEVAL_OPERATOR_USER_ID)
		);
	}

	await withEvalDb(LONGMEMEVAL_OPERATOR_USER_ID, () =>
		assertCanAfford(LONGMEMEVAL_OPERATOR_USER_ID, MIN_CAPTURE_PIPELINE_CREDITS)
	);

	console.info(
		`[longmemeval] operator wallet ready (${wallet.availableCredits} credits available)`
	);
}
