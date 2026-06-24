import { insertEvalUserRow } from '$lib/eval/store';
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits';
import { creditFromPayment, getOrCreateWallet } from '$lib/server/billing/wallet';
import { paymentOrder } from '$lib/server/db/schema';
import { withEvalDb } from '../harness/eval-context';

export const GRAPH_SCALE_OPERATOR_USER_ID = 'graph-scale-runner';

const TOP_UP_CREDITS = 500_000;

/** Ensure operator exists with enough platform credits for benchmark LLM spend. */
export async function ensureGraphScaleOperatorReady(): Promise<void> {
	await insertEvalUserRow(GRAPH_SCALE_OPERATOR_USER_ID, 'Graph scale benchmark operator');

	let wallet = await withEvalDb(GRAPH_SCALE_OPERATOR_USER_ID, () =>
		getOrCreateWallet(GRAPH_SCALE_OPERATOR_USER_ID)
	);

	if (wallet.availableCredits < MIN_CAPTURE_PIPELINE_CREDITS) {
		const paypalOrderId = `graph_scale_${Date.now()}`;
		await withEvalDb(GRAPH_SCALE_OPERATOR_USER_ID, async (db) => {
			const [row] = await db
				.insert(paymentOrder)
				.values({
					userId: GRAPH_SCALE_OPERATOR_USER_ID,
					paypalOrderId,
					status: 'created',
					requestedCredits: TOP_UP_CREDITS,
					currency: 'USD'
				})
				.returning({ id: paymentOrder.id });
			await creditFromPayment({
				userId: GRAPH_SCALE_OPERATOR_USER_ID,
				paymentOrderId: row.id,
				paypalOrderId,
				amountCredits: TOP_UP_CREDITS
			});
		});
		wallet = await withEvalDb(GRAPH_SCALE_OPERATOR_USER_ID, () =>
			getOrCreateWallet(GRAPH_SCALE_OPERATOR_USER_ID)
		);
	}

	console.info('[graph-scale] operator wallet', {
		availableCredits: wallet.availableCredits
	});
}
