export type WalletApiResponse = {
	availableCents: number;
	reservedCents: number;
	pendingBillingMicroUsd: number;
	currency: string;
	billingMode: 'platform_credits' | 'byok';
};

/** Loads the authenticated user's wallet from `GET /api/billing/wallet`. */
export async function fetchWalletBalance(): Promise<WalletApiResponse | null> {
	const res = await fetch('/api/billing/wallet', { credentials: 'same-origin' });
	if (!res.ok) return null;
	const body = (await res.json()) as WalletApiResponse;
	if (typeof body.availableCents !== 'number') return null;
	return body;
}
