import { describe, expect, it, vi, beforeEach } from 'vitest';
import { billingUserAsyncLocal } from './context';
import { MIN_CAPTURE_PIPELINE_CREDITS } from './usage-gate';

const { isByokBillingMock, assertCanAffordMock } = vi.hoisted(() => ({
	isByokBillingMock: vi.fn(async () => false),
	assertCanAffordMock: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/billing/preferences', () => ({
	isByokBilling: isByokBillingMock
}));

vi.mock('$lib/server/billing/wallet', () => ({
	assertCanAfford: assertCanAffordMock,
	assertHasPlatformCredits: vi.fn(),
	chargePlatformUsageMicroUsd: vi.fn(),
	InsufficientCreditsError: class extends Error {
		name = 'InsufficientCreditsError';
	}
}));

describe('assertCapturePipelineAffordable billing user', () => {
	beforeEach(() => {
		isByokBillingMock.mockReset();
		assertCanAffordMock.mockReset();
		isByokBillingMock.mockResolvedValue(false);
	});

	it('checks wallet for billing override user, not eval tenant', async () => {
		const { assertCapturePipelineAffordable } = await import('./usage-gate');
		await billingUserAsyncLocal.run('operator-99', async () => {
			await assertCapturePipelineAffordable('eval-run-user');
		});
		expect(assertCanAffordMock).toHaveBeenCalledWith('operator-99', MIN_CAPTURE_PIPELINE_CREDITS);
		expect(isByokBillingMock).toHaveBeenCalledWith('operator-99');
	});
});
