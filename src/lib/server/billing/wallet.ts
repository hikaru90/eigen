import { and, desc, eq } from 'drizzle-orm';
import { getDb, withDbUser, type AppDatabase } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import {
	paymentOrder,
	userWallet,
	walletLedgerEntry,
	type WalletLedgerKind
} from '$lib/server/db/schema';
import {
	formatEigenCredits,
	MICRO_USD_PER_CREDIT,
	microUsdToWholeCredits,
	STARTING_FREE_CREDITS
} from '$lib/server/billing/credits';
import { isByokUiEnabled } from '$lib/server/billing/byok-ui';

/** Ledger / PayPal audit currency (not shown in UI). */
const WALLET_AUDIT_CURRENCY = 'USD';

export type InsufficientCreditsPhase = 'precheck' | 'settle';

export type InsufficientCreditsOptions = {
	availableCredits?: number;
	requiredCredits?: number;
	phase?: InsufficientCreditsPhase;
	message?: string;
	baseUsd?: number;
};

export class InsufficientCreditsError extends Error {
	readonly availableCredits?: number;
	readonly requiredCredits?: number;
	readonly phase: InsufficientCreditsPhase;

	constructor(options?: InsufficientCreditsOptions | string) {
		const opts = typeof options === 'string' ? { message: options } : (options ?? {});
		const phase = opts.phase ?? 'precheck';
		const message = opts.message ?? buildInsufficientCreditsMessage(opts);
		super(message);
		this.name = 'InsufficientCreditsError';
		this.phase = phase;
		this.availableCredits = opts.availableCredits;
		this.requiredCredits = opts.requiredCredits;
	}
}

function buildInsufficientCreditsMessage(opts: InsufficientCreditsOptions): string {
	const suffix = isByokUiEnabled()
		? ' Top up in Settings or switch to BYOK mode.'
		: ' Top up in Settings → Credits.';
	if (
		opts.availableCredits !== undefined &&
		opts.requiredCredits !== undefined &&
		opts.requiredCredits > 0
	) {
		const available = formatEigenCredits(opts.availableCredits);
		const need = formatEigenCredits(opts.requiredCredits);
		if (opts.phase === 'settle' && opts.baseUsd !== undefined && opts.baseUsd > 0) {
			return `Insufficient Eigen platform credits (available ${available}, need at least ${need} for this call at ~$${opts.baseUsd.toFixed(4)} USD gateway cost).${suffix}`;
		}
		return `Insufficient Eigen platform credits (available ${available}, need at least ${need}).${suffix}`;
	}
	if (opts.availableCredits !== undefined) {
		return `Insufficient Eigen platform credits (available ${formatEigenCredits(opts.availableCredits)}).${suffix}`;
	}
	return `Insufficient Eigen platform credits.${suffix}`;
}

function rowToSnapshot(row: {
	availableCredits: number;
	reservedCredits: number;
	pendingBillingMicroUsd: number;
}): WalletSnapshot {
	return {
		availableCredits: row.availableCredits,
		reservedCredits: row.reservedCredits,
		pendingBillingMicroUsd: row.pendingBillingMicroUsd
	};
}

export type WalletSnapshot = {
	availableCredits: number;
	reservedCredits: number;
	pendingBillingMicroUsd: number;
};

/** Read wallet without creating a row (diagnostics / API). */
export async function getWalletSnapshot(userId: string): Promise<WalletSnapshot | null> {
	const [existing] = await getDb()
		.select({
			availableCredits: userWallet.availableCredits,
			reservedCredits: userWallet.reservedCredits,
			pendingBillingMicroUsd: userWallet.pendingBillingMicroUsd
		})
		.from(userWallet)
		.where(eq(userWallet.userId, userId))
		.limit(1);
	return existing ? rowToSnapshot(existing) : null;
}

/** Wallet rows are RLS-scoped; always open a session for `userId`. */
export async function getOrCreateWallet(userId: string): Promise<WalletSnapshot> {
	return withDbUser(userId, async (db) => {
		await db
			.insert(userWallet)
			.values({
				userId,
				availableCredits: 0,
				reservedCredits: 0,
				pendingBillingMicroUsd: 0,
				currency: WALLET_AUDIT_CURRENCY
			})
			.onConflictDoNothing();

		const [row] = await db
			.select({
				availableCredits: userWallet.availableCredits,
				reservedCredits: userWallet.reservedCredits,
				pendingBillingMicroUsd: userWallet.pendingBillingMicroUsd
			})
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.limit(1);
		if (!row) {
			throw new Error(`Failed to load wallet for user ${userId}`);
		}
		return rowToSnapshot(row);
	});
}

/**
 * Idempotent signup grant: production users receive {@link STARTING_FREE_CREDITS} once.
 * Uses RLS-scoped session (auth hook must not write wallets via authDb).
 */
export async function grantStartingFreeCredits(
	userId: string
): Promise<{ granted: boolean; availableCredits: number }> {
	return withDbUser(userId, async (db) => {
		const [account] = await db
			.select({ accountKind: user.accountKind })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		if (account?.accountKind === 'harness') {
			const wallet = await loadWalletRow(db, userId);
			return { granted: false, availableCredits: wallet?.availableCredits ?? 0 };
		}

		const [existingBonus] = await db
			.select({ id: walletLedgerEntry.id })
			.from(walletLedgerEntry)
			.where(
				and(
					eq(walletLedgerEntry.userId, userId),
					eq(walletLedgerEntry.referenceType, 'signup_bonus'),
					eq(walletLedgerEntry.referenceId, userId)
				)
			)
			.limit(1);
		if (existingBonus) {
			const wallet = await loadWalletRow(db, userId);
			return { granted: false, availableCredits: wallet?.availableCredits ?? 0 };
		}

		return db.transaction(async (tx) => {
			await tx
				.insert(userWallet)
				.values({
					userId,
					availableCredits: 0,
					reservedCredits: 0,
					pendingBillingMicroUsd: 0,
					currency: WALLET_AUDIT_CURRENCY
				})
				.onConflictDoNothing();

			const [wallet] = await tx
				.select()
				.from(userWallet)
				.where(eq(userWallet.userId, userId))
				.for('update');
			if (!wallet) {
				throw new Error(`Failed to load wallet for user ${userId}`);
			}

			const nextAvailable = wallet.availableCredits + STARTING_FREE_CREDITS;
			await tx
				.update(userWallet)
				.set({ availableCredits: nextAvailable, updatedAt: new Date() })
				.where(eq(userWallet.userId, userId));

			await insertLedger(tx, {
				userId,
				kind: 'adjustment',
				amountCredits: STARTING_FREE_CREDITS,
				referenceType: 'signup_bonus',
				referenceId: userId,
				metadata: { reason: 'starting_free_credits' }
			});

			return { granted: true, availableCredits: nextAvailable };
		});
	});
}

async function loadWalletRow(
	db: AppDatabase,
	userId: string
): Promise<{ availableCredits: number } | undefined> {
	const [row] = await db
		.select({ availableCredits: userWallet.availableCredits })
		.from(userWallet)
		.where(eq(userWallet.userId, userId))
		.limit(1);
	return row;
}

/** @deprecated Currency selection removed; use {@link getOrCreateWallet}. */
export async function alignWalletCurrencyWithPreference(
	userId: string,
	_preferredCurrency?: string
): Promise<WalletSnapshot> {
	return getOrCreateWallet(userId);
}

async function insertLedger(
	tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
	input: {
		userId: string;
		kind: WalletLedgerKind;
		amountCredits: number;
		referenceType?: string;
		referenceId?: string;
		metadata?: Record<string, unknown>;
	}
) {
	await tx.insert(walletLedgerEntry).values({
		userId: input.userId,
		kind: input.kind,
		amountCredits: input.amountCredits,
		currency: WALLET_AUDIT_CURRENCY,
		referenceType: input.referenceType ?? null,
		referenceId: input.referenceId ?? null,
		metadata: input.metadata ?? {}
	});
}

export async function reserveFunds(userId: string, estimatedCredits: number): Promise<string> {
	if (!Number.isInteger(estimatedCredits) || estimatedCredits < 1) {
		throw new Error('estimatedCredits must be a positive integer');
	}

	const db = getDb();
	return db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');

		if (!wallet) {
			throw new InsufficientCreditsError({ phase: 'precheck', requiredCredits: estimatedCredits });
		}
		if (wallet.availableCredits < estimatedCredits) {
			throw new InsufficientCreditsError({
				phase: 'precheck',
				availableCredits: wallet.availableCredits,
				requiredCredits: estimatedCredits
			});
		}

		await tx
			.update(userWallet)
			.set({
				availableCredits: wallet.availableCredits - estimatedCredits,
				reservedCredits: wallet.reservedCredits + estimatedCredits,
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		const [ledger] = await tx
			.insert(walletLedgerEntry)
			.values({
				userId,
				kind: 'reservation_hold',
				amountCredits: -estimatedCredits,
				currency: WALLET_AUDIT_CURRENCY,
				referenceType: 'reservation',
				metadata: { estimatedCredits }
			})
			.returning({ id: walletLedgerEntry.id });

		return ledger.id;
	});
}

export async function releaseReservation(
	userId: string,
	reservationId: string,
	heldCredits: number
): Promise<void> {
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
				availableCredits: wallet.availableCredits + heldCredits,
				reservedCredits: Math.max(0, wallet.reservedCredits - heldCredits),
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		await insertLedger(tx, {
			userId,
			kind: 'reservation_release',
			amountCredits: heldCredits,
			referenceType: 'reservation',
			referenceId: reservationId,
			metadata: { heldCredits }
		});
	});
}

/**
 * Accumulates micro-USD usage and debits whole Eigen credits when pending crosses one credit.
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

	return withDbUser(userId, (db) =>
		db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');
		if (!wallet) {
			throw new InsufficientCreditsError({ phase: 'settle' });
		}

		const pending = wallet.pendingBillingMicroUsd + actualMicroUsd;
		const debitedCredits = microUsdToWholeCredits(pending);
		const newPending = pending - debitedCredits * MICRO_USD_PER_CREDIT;

		if (debitedCredits > 0 && wallet.availableCredits < debitedCredits) {
			const baseUsd =
				typeof metadata?.baseUsd === 'number' && Number.isFinite(metadata.baseUsd)
					? metadata.baseUsd
					: undefined;
			throw new InsufficientCreditsError({
				phase: 'settle',
				availableCredits: wallet.availableCredits,
				requiredCredits: debitedCredits,
				baseUsd
			});
		}

		await tx
			.update(userWallet)
			.set({
				availableCredits: wallet.availableCredits - debitedCredits,
				pendingBillingMicroUsd: newPending,
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		if (debitedCredits > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'usage_debit',
				amountCredits: -debitedCredits,
				referenceType: 'usage',
				metadata: { ...metadata, actualMicroUsd, debitedCredits, pendingMicroUsd: newPending }
			});
		}

		return debitedCredits;
		})
	);
}

export async function settleReservationWithMicroCharge(
	userId: string,
	reservationId: string,
	heldCredits: number,
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

		const availableAfterRelease = wallet.availableCredits + heldCredits;
		const pending = wallet.pendingBillingMicroUsd + actualMicroUsd;
		const debitedCredits = microUsdToWholeCredits(pending);
		const newPending = pending - debitedCredits * MICRO_USD_PER_CREDIT;

		if (debitedCredits > 0 && availableAfterRelease < debitedCredits) {
			const baseUsd =
				typeof metadata?.baseUsd === 'number' && Number.isFinite(metadata.baseUsd)
					? metadata.baseUsd
					: undefined;
			throw new InsufficientCreditsError({
				phase: 'settle',
				availableCredits: availableAfterRelease,
				requiredCredits: debitedCredits,
				baseUsd
			});
		}

		await tx
			.update(userWallet)
			.set({
				availableCredits: availableAfterRelease - debitedCredits,
				reservedCredits: Math.max(0, wallet.reservedCredits - heldCredits),
				pendingBillingMicroUsd: newPending,
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		if (heldCredits > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'reservation_release',
				amountCredits: heldCredits,
				referenceType: 'reservation',
				referenceId: reservationId,
				metadata: { heldCredits }
			});
		}

		if (debitedCredits > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'usage_debit',
				amountCredits: -debitedCredits,
				referenceType: 'usage',
				referenceId: reservationId,
				metadata: { ...metadata, actualMicroUsd, debitedCredits, pendingMicroUsd: newPending }
			});
		}

		return debitedCredits;
	});
}

/** @deprecated Prefer {@link settleReservationWithMicroCharge}. */
export async function settleReservation(
	userId: string,
	reservationId: string,
	heldCredits: number,
	actualCredits: number,
	metadata?: Record<string, unknown>
): Promise<void> {
	if (!Number.isInteger(actualCredits) || actualCredits < 0) {
		throw new Error('actualCredits must be a non-negative integer');
	}
	if (actualCredits > heldCredits) {
		throw new Error('actualCredits cannot exceed held reservation');
	}

	const db = getDb();
	await db.transaction(async (tx) => {
		const [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, userId))
			.for('update');
		if (!wallet) return;

		const releaseCredits = heldCredits - actualCredits;
		await tx
			.update(userWallet)
			.set({
				availableCredits: wallet.availableCredits + releaseCredits,
				reservedCredits: Math.max(0, wallet.reservedCredits - heldCredits),
				updatedAt: new Date()
			})
			.where(eq(userWallet.userId, userId));

		if (actualCredits > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'usage_debit',
				amountCredits: -actualCredits,
				referenceType: 'usage',
				referenceId: reservationId,
				metadata: metadata ?? {}
			});
		}

		if (releaseCredits > 0) {
			await insertLedger(tx, {
				userId,
				kind: 'reservation_release',
				amountCredits: releaseCredits,
				referenceType: 'reservation',
				referenceId: reservationId,
				metadata: { releaseCredits, actualCredits }
			});
		}
	});
}

/** Idempotent credit after verified PayPal capture. */
export async function creditFromPayment(input: {
	userId: string;
	paymentOrderId: string;
	paypalOrderId: string;
	amountCredits: number;
	audit?: {
		grossUsd: string;
		netUsd: string;
		paypalFeeUsd: string;
		platformSubtotalUsd: string;
	};
}): Promise<{ credited: boolean; availableCredits: number }> {
	const db = getDb();
	if (!Number.isInteger(input.amountCredits) || input.amountCredits < 1) {
		throw new Error('amountCredits must be a positive integer');
	}

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
			const wallet = await getOrCreateWalletInTx(tx, input.userId);
			return { credited: false, availableCredits: wallet.availableCredits };
		}

		if (input.amountCredits !== order.requestedCredits) {
			throw new Error(
				`Capture credits (${input.amountCredits}) do not match order (${order.requestedCredits})`
			);
		}

		let [wallet] = await tx
			.select()
			.from(userWallet)
			.where(eq(userWallet.userId, input.userId))
			.for('update');

		if (!wallet) {
			wallet = await getOrCreateWalletInTx(tx, input.userId);
		}

		const nextAvailable = wallet.availableCredits + input.amountCredits;
		await tx
			.update(userWallet)
			.set({ availableCredits: nextAvailable, updatedAt: new Date() })
			.where(eq(userWallet.userId, input.userId));

		await insertLedger(tx, {
			userId: input.userId,
			kind: 'top_up',
			amountCredits: input.amountCredits,
			referenceType: 'payment_order',
			referenceId: input.paymentOrderId,
			metadata: {
				paypalOrderId: input.paypalOrderId,
				requestedCredits: input.amountCredits,
				...(input.audit ?? {})
			}
		});

		await tx
			.update(paymentOrder)
			.set({
				status: 'captured',
				capturedCredits: input.amountCredits,
				updatedAt: new Date()
			})
			.where(eq(paymentOrder.id, order.id));

		return { credited: true, availableCredits: nextAvailable };
	});
}

async function getOrCreateWalletInTx(
	tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
	userId: string
) {
	await tx
		.insert(userWallet)
		.values({
			userId,
			availableCredits: 0,
			reservedCredits: 0,
			pendingBillingMicroUsd: 0,
			currency: WALLET_AUDIT_CURRENCY
		})
		.onConflictDoNothing();
	const [wallet] = await tx.select().from(userWallet).where(eq(userWallet.userId, userId)).limit(1);
	if (!wallet) {
		throw new Error(`Failed to load wallet for user ${userId}`);
	}
	return wallet;
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

export async function assertHasPlatformCredits(userId: string): Promise<WalletSnapshot> {
	const wallet = await getOrCreateWallet(userId);
	if (wallet.availableCredits < 1) {
		throw new InsufficientCreditsError({
			phase: 'precheck',
			availableCredits: wallet.availableCredits,
			requiredCredits: 1
		});
	}
	return wallet;
}

export async function assertCanAfford(userId: string, requiredCredits: number): Promise<void> {
	const wallet = await getOrCreateWallet(userId);
	console.log('[billing] assertCanAfford', {
		userId,
		availableCredits: wallet.availableCredits,
		requiredCredits,
		canAfford: wallet.availableCredits >= requiredCredits
	});
	if (wallet.availableCredits < requiredCredits) {
		throw new InsufficientCreditsError({
			phase: 'precheck',
			availableCredits: wallet.availableCredits,
			requiredCredits
		});
	}
}
