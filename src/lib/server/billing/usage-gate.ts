import { isByokBilling } from '$lib/server/billing/preferences';
import {
	InsufficientCreditsError,
	assertHasPlatformCredits,
	chargePlatformUsageMicroUsd
} from '$lib/server/billing/wallet';
import { baseUsdToTotalMicroUsd } from '$lib/server/billing/money';

export { InsufficientCreditsError };

export function billedMicroUsdFromBaseUsd(baseCostUsd: number): number {
	if (baseCostUsd <= 0) return 0;
	return baseUsdToTotalMicroUsd(baseCostUsd);
}

/**
 * Runs `fn` under platform credits: requires a non-zero wallet balance, then debits
 * only the provider-reported cost returned by `settleFromBaseUsd` after the call succeeds.
 * No pre-call holds and no estimated charges.
 */
export async function withPlatformBilling<T>(
	userId: string,
	settleFromBaseUsd: (result: T) => number,
	fn: () => Promise<T>
): Promise<T> {
	if (await isByokBilling(userId)) {
		return fn();
	}

	await assertHasPlatformCredits(userId);

	const result = await fn();
	const baseUsd = settleFromBaseUsd(result);
	const actualMicroUsd = billedMicroUsdFromBaseUsd(baseUsd);
	await chargePlatformUsageMicroUsd(userId, actualMicroUsd, { baseUsd, actualMicroUsd });
	return result;
}
