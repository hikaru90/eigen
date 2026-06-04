import { describe, expect, it, vi } from 'vitest';
import { billedMicroUsdFromBaseUsd, MIN_CAPTURE_PIPELINE_CENTS } from './usage-gate';
import { MICRO_USD_PER_CENT } from './money';

vi.mock('$lib/server/billing/preferences', () => ({
	isByokBilling: vi.fn(async () => false)
}));

vi.mock('$lib/server/billing/wallet', () => ({
	assertCanAfford: vi.fn(async () => undefined),
	assertHasPlatformCredits: vi.fn(async () => ({
		availableCents: 100,
		reservedCents: 0,
		pendingBillingMicroUsd: 0,
		currency: 'USD'
	})),
	chargePlatformUsageMicroUsd: vi.fn(async () => 0),
	InsufficientCreditsError: class InsufficientCreditsError extends Error {
		name = 'InsufficientCreditsError';
	}
}));

describe('usage-gate billing', () => {
	it('MIN_CAPTURE_PIPELINE_CENTS is a positive integer', () => {
		expect(MIN_CAPTURE_PIPELINE_CENTS).toBeGreaterThan(0);
		expect(Number.isInteger(MIN_CAPTURE_PIPELINE_CENTS)).toBe(true);
	});
	it('accumulates sub-cent settled costs instead of rounding up to 1 cent', () => {
		const micro = billedMicroUsdFromBaseUsd(0.0001);
		expect(micro).toBeGreaterThan(0);
		expect(micro).toBeLessThan(MICRO_USD_PER_CENT);
	});

	it('returns 0 micro-USD for zero base cost', () => {
		expect(billedMicroUsdFromBaseUsd(0)).toBe(0);
	});

	it('assertCapturePipelineAffordable calls assertCanAfford for platform credits', async () => {
		const { assertCapturePipelineAffordable } = await import('./usage-gate');
		const { assertCanAfford } = await import('./wallet');
		await assertCapturePipelineAffordable('user-1');
		expect(assertCanAfford).toHaveBeenCalledWith('user-1', MIN_CAPTURE_PIPELINE_CENTS);
	});
});
