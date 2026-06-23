import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InsufficientCreditsError, chargePlatformUsageMicroUsd } from './wallet';

const { mockEnv, withDbUserMock } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	withDbUserMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(),
	withDbUser: withDbUserMock
}));

function makeWalletRow(overrides: Partial<{
	availableCredits: number;
	reservedCredits: number;
	pendingBillingMicroUsd: number;
}> = {}) {
	return {
		userId: 'u1',
		availableCredits: 1000,
		reservedCredits: 0,
		pendingBillingMicroUsd: 0,
		currency: 'USD',
		updatedAt: new Date(),
		...overrides
	};
}

function mockChargeTransaction(wallet: ReturnType<typeof makeWalletRow>) {
	const ledgerValues = vi.fn().mockResolvedValue(undefined);
	const updateSet = vi.fn().mockReturnValue({
		where: vi.fn().mockResolvedValue(undefined)
	});
	const update = vi.fn().mockReturnValue({ set: updateSet });
	const insert = vi.fn().mockReturnValue({ values: ledgerValues });
	const selectLimit = vi.fn().mockResolvedValue([wallet]);
	const selectFor = vi.fn().mockResolvedValue([wallet]);
	const selectWhere = vi.fn().mockReturnValue({
		for: selectFor,
		limit: selectLimit
	});
	const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
	const select = vi.fn().mockReturnValue({ from: selectFrom });
	const tx = {
		select,
		update,
		insert
	};
	const transaction = vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx));
	withDbUserMock.mockImplementation(async (_userId: string, fn: (db: { transaction: typeof transaction }) => Promise<unknown>) =>
		fn({ transaction })
	);
	return { ledgerValues, updateSet, wallet };
}

describe('InsufficientCreditsError', () => {
	beforeEach(() => {
		for (const key of Object.keys(mockEnv)) {
			delete mockEnv[key];
		}
	});

	it('includes available and required amounts in the message', () => {
		const err = new InsufficientCreditsError({
			phase: 'precheck',
			availableCredits: 100,
			requiredCredits: 500
		});
		expect(err.message).toContain('100 credits');
		expect(err.message).toContain('500 credits');
		expect(err.availableCredits).toBe(100);
		expect(err.requiredCredits).toBe(500);
		expect(err.phase).toBe('precheck');
	});

	it('includes gateway cost hint on settle failures', () => {
		const err = new InsufficientCreditsError({
			phase: 'settle',
			availableCredits: 50,
			requiredCredits: 200,
			baseUsd: 1.5
		});
		expect(err.message).toContain('$1.5000');
		expect(err.phase).toBe('settle');
	});

	it('omits BYOK hint when BYOK UI is hidden', () => {
		const err = new InsufficientCreditsError({
			phase: 'precheck',
			availableCredits: 0,
			requiredCredits: 50
		});
		expect(err.message).toContain('Settings → Credits');
		expect(err.message).not.toContain('BYOK');
	});

	it('mentions BYOK when BYOK UI is enabled', () => {
		mockEnv.BILLING_BYOK_UI_ENABLED = 'true';
		const err = new InsufficientCreditsError({
			phase: 'precheck',
			availableCredits: 0,
			requiredCredits: 50
		});
		expect(err.message).toContain('BYOK');
	});
});

describe('chargePlatformUsageMicroUsd', () => {
	beforeEach(() => {
		withDbUserMock.mockReset();
	});

	it('debits whole credits and writes usage_debit ledger row', async () => {
		const wallet = makeWalletRow({ availableCredits: 100, pendingBillingMicroUsd: 0 });
		const { ledgerValues, updateSet } = mockChargeTransaction(wallet);

		const debited = await chargePlatformUsageMicroUsd('u1', 12000, { baseUsd: 0.01 });

		expect(debited).toBe(12);
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				availableCredits: 88,
				pendingBillingMicroUsd: 0
			})
		);
		expect(ledgerValues).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'usage_debit',
				amountCredits: -12
			})
		);
	});

	it('accumulates sub-credit pending without debiting until threshold', async () => {
		const wallet = makeWalletRow({ availableCredits: 100, pendingBillingMicroUsd: 500 });
		const { ledgerValues, updateSet } = mockChargeTransaction(wallet);

		const debited = await chargePlatformUsageMicroUsd('u1', 400, { baseUsd: 0.0004 });

		expect(debited).toBe(0);
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				availableCredits: 100,
				pendingBillingMicroUsd: 900
			})
		);
		expect(ledgerValues).not.toHaveBeenCalled();
	});

	it('throws InsufficientCreditsError at settle when balance is too low', async () => {
		const wallet = makeWalletRow({ availableCredits: 5, pendingBillingMicroUsd: 0 });
		mockChargeTransaction(wallet);

		await expect(chargePlatformUsageMicroUsd('u1', 12000, { baseUsd: 0.01 })).rejects.toBeInstanceOf(
			InsufficientCreditsError
		);
	});
});
