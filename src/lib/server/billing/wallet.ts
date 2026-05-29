import { desc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	paymentOrder,
	userWallet,
	walletLedgerEntry,
	type WalletLedgerKind
} from '$lib/server/db/schema';
import { normalizeCurrencyCode, MICRO_USD_PER_CENT } from '$lib/server/billing/money';

export class InsufficientCreditsError extends Error {
	constructor(message = 'Insufficient Eigen credits. Top up in Settings or switch to BYOK mode.') {
		super(message);
		this.name = 'InsufficientCreditsError';
	}
}

export type WalletSnapshot = {
	availableCents: number;
	reservedCents: number;
	pendingBillingMicroUsd: number;
	currency: string;
};

export async function getOrCreateWallet(userId: string, currency = 'USD'): Promise<WalletSnapshot> {
	const db = getDb();
	const normalized = normalizeCurrencyCode(currency);
	const [existing] = await db.select().from(userWallet).where(eq(userWallet.userId, userId)).limit(1);
	if (existing) {
		return {
			availableCents: existing.availableCents,
			reservedCents: existing.reservedCents,
			pendingBillingMicroUsd: existing.pendingBillingMicroUsd,
			currency: existing.currency
		};
	}
	await db.insert(userWallet).values({
		userId,
		availableCents: 0,
		reservedCents: 0,
		pendingBillingMicroUsd: 0,
		currency: normalized
	});
	return { availableCents: 0, reservedCents: 0, pendingBillingMicroUsd: 0, currency: normalized };
}

function isWalletUnsettled(wallet: WalletSnapshot): boolean {
	return wallet.availableCents === 0 && wallet.reservedCents === 0;
}

/**
 * Aligns wallet currency with user preference when the wallet has no balance yet.
 * Once funds exist, currency is fixed until the balance is spent.
 */
export async function alignWalletCurrencyWithPreference(
	userId: string,
	preferredCurrency: string
): Promise<WalletSnapshot> {
	const normalized = normalizeCurrencyCode(preferredCurrency);
	let wallet = await getOrCreateWallet(userId, normalized);
	if (isWalletUnsettled(wallet) && wallet.currency !== normalized) {
		const db = getDb();
		await db
			.update(userWallet)
			.set({ currency: normalized, updatedAt: new Date() })
			.where(eq(userWallet.userId, userId));
		wallet = { ...wallet, currency: normalized };
	}
	return wallet;
}

export async function assertCanChangeWalletCurrency(
	userId: string,
	nextCurrency: string
): Promise<{ ok: true; wallet: WalletSnapshot } | { ok: false; message: string }> {
	const normalized = normalizeCurrencyCode(nextCurrency);
	const wallet = await getOrCreateWallet(userId, normalized);
	if (!isWalletUnsettled(wallet) && wallet.currency !== normalized) {
		return {
			ok: false,
			message: `Your balance is in ${wallet.currency}. Spend it before switching to ${normalized}.`
		};
	}
	return { ok: true, wallet };
}

async function insertLedger(
	tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
	input: {
		userId: string;
		kind: WalletLedgerKind;
		amountCents: number;
		currency: string;
		referenceType?: string;
		referenceId?: string;
		metadata?: Record<string, unknown>;
	}
) {
	await tx.insert(walletLedgerEntry).values({
		userId: input.userId,
		kind: input.kind,
		amountCents: input.amountCents,
		currency: input.currency,
		referenceType: input.referenceType ?? null,
		referenceId: input.referenceId ?? null,
		metadata: input.metadata ?? {}
	});
}

/**
 * Pre-call hold: moves `estimatedCents` from available to reserved.
 * Returns a reservation id (ledger row id) for release/settle.
 */
export async function reserveFunds(userId: string, estimatedCents: number): Promise<string> {
	if (!Number.isInteger(estimatedCents) || estimatedCents < 1) {
		throw new Error('estimatedCents must be a positive integer');
	}

	const db = getDb();
	return db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');

		if (!wallet) {
			throw new InsufficientCreditsError();
		}
		if (wallet.availableCents < estimatedCents) {
			throw new InsufficientCreditsError();
		}

		await tx
			.update(userWallet)
			.set({
				availableCents: wallet.availableCents - estimatedCents,
				reservedCents: wallet.reservedCents + estimatedCents,
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		const [ledger] = await tx
			.insert(walletLedgerEntry)
			.values({
				userId,
				kind: 'reservation_hold',
				amountCents: -estimatedCents,
				currency: wallet.currency,
				referenceType: 'reservation',
				metadata: { estimatedCents }
			})
			.returning({ id: walletLedgerEntry.id });

		return ledger.id;
	});
}

export async function releaseReservation(userId: string, reservationId: string, heldCents: number): Promise<void> {
	const db = getDb();
	await db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');
		if (!wallet) return;

		await tx
			.update(userWallet)
			.set({
				availableCents: wallet.availableCents + heldCents,
				reservedCents: Math.max(0, wallet.reservedCents - heldCents),
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		await insertLedger(tx, {
			userId,
			kind: 'reservation_release',
			amountCents: heldCents,
			currency: wallet.currency,
			referenceType: 'reservation',
			referenceId: reservationId,
			metadata: { heldCents }
		});
	});
}

/**
 * Accumulates micro-USD usage and debits whole wallet cents when the sub-cent balance crosses $0.01.
 * Returns cents debited on this call (often 0 for sub-cent gateway costs).
 */
export async function chargePlatformUsageMicroUsd(
	userId: string,
	actualMicroUsd: number,
	metadata?: Record<string, unknown>
): Promise<number> {
	if (!Number.isInteger(actualMicroUsd) || actualMicroUsd < 0) {
		throw new Error('actualMicroUsd must be a non-negative integer');
	}
	if (actualMicroUsd === 0) return 0;

	const db = getDb();
	return db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');
		if (!wallet) {
			throw new InsufficientCreditsError();
		}

		const pending = wallet.pendingBillingMicroUsd + actualMicroUsd;
		const debitedCents = Math.floor(pending / MICRO_USD_PER_CENT);
		const newPending = pending - debitedCents * MICRO_USD_PER_CENT;

		if (debitedCents > 0 && wallet.availableCents < debitedCents) {
			throw new InsufficientCreditsError();
		}

		await tx
			.update(userWallet)
			.set({
				availableCents: wallet.availableCents - debitedCents,
				pendingBillingMicroUsd: newPending,
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		if (debitedCents > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'usage_debit',
				amountCents: -debitedCents,
				currency: wallet.currency,
				referenceType: 'usage',
				metadata: { ...metadata, actualMicroUsd, debitedCents, pendingMicroUsd: newPending }
			});
		}

		return debitedCents;
	});
}

/**
 * Releases a pre-call hold, then applies accumulated micro-USD billing.
 */
export async function settleReservationWithMicroCharge(
	userId: string,
	reservationId: string,
	heldCents: number,
	actualMicroUsd: number,
	metadata?: Record<string, unknown>
): Promise<number> {
	if (!Number.isInteger(actualMicroUsd) || actualMicroUsd < 0) {
		throw new Error('actualMicroUsd must be a non-negative integer');
	}

	const db = getDb();
	return db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');
		if (!wallet) return 0;

		const availableAfterRelease = wallet.availableCents + heldCents;
		const pending = wallet.pendingBillingMicroUsd + actualMicroUsd;
		const debitedCents = Math.floor(pending / MICRO_USD_PER_CENT);
		const newPending = pending - debitedCents * MICRO_USD_PER_CENT;

		if (debitedCents > 0 && availableAfterRelease < debitedCents) {
			throw new InsufficientCreditsError();
		}

		await tx
			.update(userWallet)
			.set({
				availableCents: availableAfterRelease - debitedCents,
				reservedCents: Math.max(0, wallet.reservedCents - heldCents),
				pendingBillingMicroUsd: newPending,
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		if (heldCents > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'reservation_release',
				amountCents: heldCents,
				currency: wallet.currency,
				referenceType: 'reservation',
				referenceId: reservationId,
				metadata: { heldCents }
			});
		}

		if (debitedCents > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'usage_debit',
				amountCents: -debitedCents,
				currency: wallet.currency,
				referenceType: 'usage',
				referenceId: reservationId,
				metadata: { ...metadata, actualMicroUsd, debitedCents, pendingMicroUsd: newPending }
			});
		}

		return debitedCents;
	});
}

/**
 * Settle a reservation: debit `actualCents` from reserved, return unused hold to available.
 * @deprecated Prefer {@link settleReservationWithMicroCharge} for platform LLM billing.
 */
export async function settleReservation(
	userId: string,
	reservationId: string,
	heldCents: number,
	actualCents: number,
	metadata?: Record<string, unknown>
): Promise<void> {
	if (!Number.isInteger(actualCents) || actualCents < 0) {
		throw new Error('actualCents must be a non-negative integer');
	}
	if (actualCents > heldCents) {
		throw new Error('actualCents cannot exceed held reservation');
	}

	const db = getDb();
	await db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');
		if (!wallet) return;

		const releaseCents = heldCents - actualCents;
		await tx
			.update(userWallet)
			.set({
				availableCents: wallet.availableCents + releaseCents,
				reservedCents: Math.max(0, wallet.reservedCents - heldCents),
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		if (actualCents > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'usage_debit',
				amountCents: -actualCents,
				currency: wallet.currency,
				referenceType: 'usage',
				referenceId: reservationId,
				metadata: metadata ?? {}
			});
		}

		if (releaseCents > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'reservation_release',
				amountCents: releaseCents,
				currency: wallet.currency,
				referenceType: 'reservation',
				referenceId: reservationId,
				metadata: { releaseCents, actualCents }
			});
		}
	});
}

/** Idempotent credit after verified PayPal capture. */
export async function creditFromPayment(input: {
	userId: string;
	paymentOrderId: string;
	paypalOrderId: string;
	amountCents: number;
	currency: string;
}): Promise<{ credited: boolean; availableCents: number }> {
	const db = getDb();
	const normalized = normalizeCurrencyCode(input.currency);

	return db.transaction(async (tx) => {
		const [order] = await tx
			.select()
			.from(paymentOrder)
			.where(eq(paymentOrder.paypalOrderId, input.paypalOrderId))
			.for('update');

		if (!order || order.userId !== input.userId) {
			throw new Error('Payment order not found');
		}
		if (order.status === 'captured') {
			const wallet = await getOrCreateWalletInTx(tx, input.userId, normalized);
			return { credited: false, availableCents: wallet.availableCents };
		}

		let [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, input.userId))
			.for('update');

		if (!wallet) {
			await tx.insert(userWallet).values({
				userId: input.userId,
				availableCents: 0,
				reservedCents: 0,
				pendingBillingMicroUsd: 0,
				currency: normalized
			});
			wallet = {
				userId: input.userId,
				availableCents: 0,
				reservedCents: 0,
				pendingBillingMicroUsd: 0,
				currency: normalized,
				updatedAt: new Date()
			};
		} else if (wallet.currency !== normalized) {
			throw new Error(
				`Wallet currency is ${wallet.currency}; cannot credit ${normalized}. Change your default billing currency or use the same currency.`
			);
		}

		const nextAvailable = wallet.availableCents + input.amountCents;
		await tx
			.update(userWallet)
			.set({ availableCents: nextAvailable, updatedAt: new Date() })
			.where(eq(userWallet.userId, input.userId));

		await insertLedger(tx, {
			userId: input.userId,
			kind: 'top_up',
			amountCents: input.amountCents,
			currency: normalized,
			referenceType: 'payment_order',
			referenceId: input.paymentOrderId,
			metadata: { paypalOrderId: input.paypalOrderId }
		});

		await tx
			.update(paymentOrder)
			.set({
				status: 'captured',
				capturedCents: input.amountCents,
				updatedAt: new Date()
			})
			.where(eq(paymentOrder.id, order.id));

		return { credited: true, availableCents: nextAvailable };
	});
}

async function getOrCreateWalletInTx(
	tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
	userId: string,
	currency: string
) {
	const [wallet] = await tx.select().from(userWallet).where(eq(userWallet.userId, userId)).limit(1);
	if (wallet) return wallet;
	await tx.insert(userWallet).values({
		userId,
		availableCents: 0,
		reservedCents: 0,
		pendingBillingMicroUsd: 0,
		currency
	});
	return {
		userId,
		availableCents: 0,
		reservedCents: 0,
		pendingBillingMicroUsd: 0,
		currency,
		updatedAt: new Date()
	};
}

export async function listRecentLedger(userId: string, limit = 20) {
	return getDb()
		.select()
		.from(walletLedgerEntry)
		.where(eq(walletLedgerEntry.userId, userId))
		.orderBy(desc(walletLedgerEntry.createdAt))
		.limit(limit);
}

export async function listRecentPayments(userId: string, limit = 10) {
	return getDb()
		.select()
		.from(paymentOrder)
		.where(eq(paymentOrder.userId, userId))
		.orderBy(desc(paymentOrder.createdAt))
		.limit(limit);
}

/** Platform LLM calls require a positive wallet balance; actual cost is debited after the call. */
export async function assertHasPlatformCredits(userId: string): Promise<void> {
	const wallet = await getOrCreateWallet(userId);
	if (wallet.availableCents < 1) {
		throw new InsufficientCreditsError();
	}
}

/** Minimum balance check without reservation (read-only). */
export async function assertCanAfford(userId: string, requiredCents: number): Promise<void> {
	const wallet = await getOrCreateWallet(userId);
	if (wallet.availableCents < requiredCents) {
		throw new InsufficientCreditsError();
	}
}
