export type WalletApiResponse = {
	availableCredits: number;
	reservedCredits: number;
	pendingBillingMicroUsd: number;
	billingMode: 'platform_credits' | 'byok';
	creditsPerUsd: number;
};

/** Loads the authenticated user's wallet from `GET /api/billing/wallet`. */
export async function fetchWalletBalance(): Promise<WalletApiResponse | null> {
	const res = await fetch('/api/billing/wallet', { credentials: 'same-origin' });
	if (!res.ok) return null;
	const body = (await res.json()) as WalletApiResponse;
	if (typeof body.availableCredits !== 'number') return null;
	return body;
}
