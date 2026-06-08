import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate';

const { isByokBillingMock, getOrCreateWalletMock, loadGroundingProfileRowMock } = vi.hoisted(() => ({
	isByokBillingMock: vi.fn(),
	getOrCreateWalletMock: vi.fn(),
	loadGroundingProfileRowMock: vi.fn()
}));

vi.mock('$lib/server/billing/preferences', () => ({
	isByokBilling: isByokBillingMock
}));

vi.mock('$lib/server/billing/wallet', () => ({
	getOrCreateWallet: getOrCreateWalletMock
}));

vi.mock('$lib/server/grounding/profile', () => ({
	loadGroundingProfileRow: loadGroundingProfileRowMock,
	isInitialGroundingComplete: (snapshot: { initialCompletedAt?: Date | null } | null) =>
		snapshot?.initialCompletedAt != null
}));

describe('checkCaptureAllowed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadGroundingProfileRowMock.mockResolvedValue({
			initialCompletedAt: new Date('2026-01-01'),
			facets: {}
		});
		isByokBillingMock.mockResolvedValue(false);
		getOrCreateWalletMock.mockResolvedValue({ availableCredits: 100 });
	});

	it('blocks when grounding is incomplete', async () => {
		loadGroundingProfileRowMock.mockResolvedValue({ initialCompletedAt: null });
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: false, reason: 'grounding_required' });
	});

	it('blocks platform users with low credits', async () => {
		getOrCreateWalletMock.mockResolvedValue({ availableCredits: 10 });
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: false, reason: 'insufficient_credits' });
	});

	it('allows BYOK users with grounding complete regardless of wallet', async () => {
		isByokBillingMock.mockResolvedValue(true);
		getOrCreateWalletMock.mockResolvedValue({ availableCredits: 0 });
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: true });
	});

	it('allows when both gates pass', async () => {
		const gate = await checkCaptureAllowed('u1');
		expect(gate).toEqual({ allowed: true });
	});
});
