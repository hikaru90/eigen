import type { InsufficientCreditsError } from '$lib/server/billing/wallet';

export const INSUFFICIENT_CREDITS_CODE = 'insufficient_credits' as const;

export type InsufficientCreditsPayload = {
	error: string;
	code: typeof INSUFFICIENT_CREDITS_CODE;
	availableCents: number;
	currency: string;
	requiredCents?: number;
	phase?: 'precheck' | 'settle';
};

export function insufficientCreditsPayload(err: InsufficientCreditsError): InsufficientCreditsPayload {
	return {
		error: err.message,
		code: INSUFFICIENT_CREDITS_CODE,
		availableCents: err.availableCents ?? 0,
		currency: err.currency ?? 'USD',
		...(err.requiredCents !== undefined ? { requiredCents: err.requiredCents } : {}),
		phase: err.phase
	};
}

export function isInsufficientCreditsError(err: unknown): err is InsufficientCreditsError {
	return err instanceof Error && err.name === 'InsufficientCreditsError';
}

export function billingErrorHttpStatus(err: unknown): number {
	return isInsufficientCreditsError(err) ? 402 : 500;
}

export function billingErrorJsonBody(
	err: unknown,
	fallbackMessage: string
): Record<string, unknown> {
	if (isInsufficientCreditsError(err)) {
		return insufficientCreditsPayload(err);
	}
	const message = err instanceof Error ? err.message : fallbackMessage;
	return { error: message };
}
