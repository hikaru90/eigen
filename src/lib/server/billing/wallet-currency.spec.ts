import { describe, expect, it, vi, beforeEach } from 'vitest';
import { alignWalletCurrencyWithPreference } from './wallet';

const { selectMock, updateMock, insertMock } = vi.hoisted(() => ({
	selectMock: vi.fn(),
	updateMock: vi.fn(),
	insertMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		select: selectMock,
		update: updateMock,
		insert: insertMock
	})
}));

describe('alignWalletCurrencyWithPreference', () => {
	beforeEach(() => {
		selectMock.mockReset();
		updateMock.mockReset();
		insertMock.mockReset();
	});

	it('updates wallet currency when balance is zero', async () => {
		const chain = {
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([
				{ availableCents: 0, reservedCents: 0, currency: 'USD' }
			])
		};
		selectMock.mockReturnValue(chain);
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		});

		const wallet = await alignWalletCurrencyWithPreference('user-1', 'EUR');
		expect(wallet.currency).toBe('EUR');
		expect(updateMock).toHaveBeenCalled();
	});
});
