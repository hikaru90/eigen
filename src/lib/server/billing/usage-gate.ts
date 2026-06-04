import { resolveBillingUserId } from '$lib/server/billing/context';
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits';
import { isByokBilling } from '$lib/server/billing/preferences';
import {
	InsufficientCreditsError,
	assertCanAfford,
	assertHasPlatformCredits,
	chargePlatformUsageMicroUsd
} from '$lib/server/billing/wallet';
import { baseUsdToTotalMicroUsd } from '$lib/server/billing/money';

export { InsufficientCreditsError };
export { MIN_CAPTURE_PIPELINE_CREDITS };

export function billedMicroUsdFromBaseUsd(baseCostUsd: number): number {
	if (baseCostUsd <= 0) return 0;
	return baseUsdToTotalMicroUsd(baseCostUsd);
}

export async function assertCapturePipelineAffordable(userId: string): Promise<void> {
	const billingUserId = resolveBillingUserId(userId);
	if (await isByokBilling(billingUserId)) {
		return;
	}
	await assertCanAfford(billingUserId, MIN_CAPTURE_PIPELINE_CREDITS);
}

export async function withPlatformBilling<T>(
	userId: string,
	settleFromBaseUsd: (result: T) => number,
	fn: () => Promise<T>
): Promise<T> {
	const billingUserId = resolveBillingUserId(userId);
	if (await isByokBilling(billingUserId)) {
		return fn();
	}

	await assertHasPlatformCredits(billingUserId);

	const result = await fn();
	const baseUsd = settleFromBaseUsd(result);
	const actualMicroUsd = billedMicroUsdFromBaseUsd(baseUsd);
	await chargePlatformUsageMicroUsd(billingUserId, actualMicroUsd, { baseUsd, actualMicroUsd });
	return result;
}
