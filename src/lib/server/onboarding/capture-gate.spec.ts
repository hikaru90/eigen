import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate';

const { isByokBillingMock, getOrCreateWalletMock } = vi.hoisted(() => ({
	isByokBillingMock: vi.fn(),
	getOrCreateWalletMock: vi.fn()
}));

vi.mock('$lib/server/billing/preferences', () => ({
	isByokBilling: isByokBillingMock
}));

vi.mock('$lib/server/billing/wallet', () => ({
	getOrCreateWallet: getOrCreateWalletMock
}));

describe('checkCaptureAllowed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isByokBillingMock.mockResolvedValue(false);
		getOrCreateWalletMock.mockResolvedValue({ availableCredits: 100 });
	});

	it('allows capture without any grounding profile', async () => {
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: true });
	});

	it('blocks platform users with low credits', async () => {
		getOrCreateWalletMock.mockResolvedValue({ availableCredits: 10 });
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: false, reason: 'insufficient_credits' });
	});

	it('allows BYOK users regardless of wallet', async () => {
		isByokBillingMock.mockResolvedValue(true);
		getOrCreateWalletMock.mockResolvedValue({ availableCredits: 0 });
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: true });
	});

	it('allows platform users with enough credits', async () => {
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: true });
	});
});
