/**
 * One-shot verification for Eigen platform credits rollout.
 * Run: node scripts/verify-eigen-credits.mjs
 */
import 'dotenv/config';
import {
	creditsToPayPalUsdAmount,
	CREDITS_PER_USD,
	microUsdToWholeCredits,
	MIN_CAPTURE_PIPELINE_CREDITS
} from '../src/lib/server/billing/credits.ts';
import { createPayPalOrder } from '../src/lib/server/billing/paypal.ts';
import { getOrCreateWallet, creditFromPayment, assertCanAfford } from '../src/lib/server/billing/wallet.ts';
import { withEvalDb } from '../evals/harness/eval-context.ts';
import { EVAL_OPERATOR_USER_ID } from '../evals/harness/eval-config.ts';
import { authDb } from '../src/lib/server/db/auth-db.ts';
import { user } from '../src/lib/server/db/auth.schema.ts';
import { eq } from 'drizzle-orm';
import { paymentOrder } from '../src/lib/server/db/schema.ts';
const MAIN_USER = 'e1tyNF0tTYmwUsMAcIAwX0h3LLrcKPgd';

function ok(label) {
	console.log(`✓ ${label}`);
}

function fail(label, err) {
	console.error(`✗ ${label}:`, err instanceof Error ? err.message : err);
	process.exitCode = 1;
}

async function main() {
	// 1) Constants / PayPal mapping
	if (creditsToPayPalUsdAmount(10_000) !== '10.00') {
		fail('creditsToPayPalUsdAmount(10000)', 'expected 10.00');
	} else {
		ok(`10_000 credits → PayPal USD ${creditsToPayPalUsdAmount(10_000)}`);
	}

	if (microUsdToWholeCredits(50_000) !== 50) {
		fail('microUsdToWholeCredits', 'expected 50 credits from 50000 micro-USD');
	} else {
		ok('micro-USD debits map to whole credits');
	}

	// 2) Main user wallet (post-migration: old 1665 cents → 16650 credits)
	const mainWallet = await withEvalDb(MAIN_USER, () => getOrCreateWallet(MAIN_USER));
	if (mainWallet.availableCredits === 16650) {
		ok(`main user balance = 16,650 credits (migrated from 1665 cents × 10)`);
	} else {
		fail('main user balance', `expected 16650, got ${mainWallet.availableCredits}`);
	}

	// 3) PayPal sandbox create-order for 10_000 credits
	try {
		const order = await createPayPalOrder({ amountCredits: 10_000 });
		if (!order.id) throw new Error('missing order id');
		ok(`PayPal sandbox order created for 10_000 credits (id=${order.id.slice(0, 12)}…)`);
	} catch (e) {
		fail('PayPal create-order', e);
	}

	// 4) Ensure eval operator can afford capture minimum (seed if empty)
	const existingOp = await authDb.select().from(user).where(eq(user.id, EVAL_OPERATOR_USER_ID));
	if (existingOp.length === 0) {
		await authDb.insert(user).values({
			id: EVAL_OPERATOR_USER_ID,
			name: 'Eval Operator',
			email: `${EVAL_OPERATOR_USER_ID}@local.eval`,
			emailVerified: true,
			onboardingCompleted: true
		});
	}
	let operatorWallet = await withEvalDb(EVAL_OPERATOR_USER_ID, () =>
		getOrCreateWallet(EVAL_OPERATOR_USER_ID)
	);
	if (operatorWallet.availableCredits < MIN_CAPTURE_PIPELINE_CREDITS) {
		const paypalOrderId = `verify_credits_${Date.now()}`;
		await withEvalDb(EVAL_OPERATOR_USER_ID, async (scopedDb) => {
			const [row] = await scopedDb
				.insert(paymentOrder)
				.values({
					userId: EVAL_OPERATOR_USER_ID,
					paypalOrderId,
					status: 'created',
					requestedCredits: 50_000,
					currency: 'USD'
				})
				.returning({ id: paymentOrder.id });
			await creditFromPayment({
				userId: EVAL_OPERATOR_USER_ID,
				paymentOrderId: row.id,
				paypalOrderId,
				amountCredits: 50_000
			});
		});
		operatorWallet = await withEvalDb(EVAL_OPERATOR_USER_ID, () =>
			getOrCreateWallet(EVAL_OPERATOR_USER_ID)
		);
		ok(`seeded eval operator with ${operatorWallet.availableCredits} credits for smoke`);
	} else {
		ok(`eval operator already has ${operatorWallet.availableCredits} credits`);
	}

	await withEvalDb(EVAL_OPERATOR_USER_ID, () =>
		assertCanAfford(EVAL_OPERATOR_USER_ID, MIN_CAPTURE_PIPELINE_CREDITS)
	);
	ok(`operator passes MIN_CAPTURE_PIPELINE_CREDITS (${MIN_CAPTURE_PIPELINE_CREDITS})`);

	console.log(`\nAll automated checks done. creditsPerUsd=${CREDITS_PER_USD}`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		const { closeAppDbPool } = await import('../src/lib/server/db/index.ts');
		const { closeAuthDbPool } = await import('../src/lib/server/db/auth-db.ts');
		await closeAppDbPool().catch(() => {});
		await closeAuthDbPool().catch(() => {});
		process.exit(process.exitCode ?? 0);
	});
