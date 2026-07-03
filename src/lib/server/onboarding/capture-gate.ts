import { MIN_CAPTURE_PIPELINE_CREDITS, CREDITS_PER_USD } from '$lib/server/billing/credits';
import { isByokBilling } from '$lib/server/billing/preferences';
import { getOrCreateWallet, InsufficientCreditsError } from '$lib/server/billing/wallet';
import { isHarnessUser } from '$lib/server/auth/harness-account';

export type CaptureGateReason = 'insufficient_credits';

export type CaptureGateResult =
	| { allowed: true }
	| { allowed: false; reason: CaptureGateReason };

export async function checkCaptureAllowed(userId: string): Promise<CaptureGateResult> {
	if (await isHarnessUser(userId)) {
		return { allowed: true };
	}

	if (!(await isByokBilling(userId))) {
		const wallet = await getOrCreateWallet(userId);
		if (wallet.availableCredits < MIN_CAPTURE_PIPELINE_CREDITS) {
			return { allowed: false, reason: 'insufficient_credits' };
		}
	}

	return { allowed: true };
}

export async function assertCaptureAllowed(userId: string): Promise<void> {
	const gate = await checkCaptureAllowed(userId);
	if (!gate.allowed) {
		const wallet = await getOrCreateWallet(userId);
		throw new InsufficientCreditsError({
			message: `Insufficient credits: need at least ${MIN_CAPTURE_PIPELINE_CREDITS} to capture.`,
			availableCredits: wallet.availableCredits,
			requiredCredits: MIN_CAPTURE_PIPELINE_CREDITS,
			phase: 'precheck'
		});
	}
}

export function captureGateHttpStatus(err: unknown): number {
	if (err instanceof InsufficientCreditsError) return 402;
	return 500;
}

export function captureGateJsonBody(err: unknown, fallbackMessage: string): Record<string, unknown> {
	if (err instanceof InsufficientCreditsError) {
		return {
			error: err.message,
			code: 'insufficient_credits',
			availableCredits: err.availableCredits ?? 0,
			requiredCredits: err.requiredCredits,
			phase: err.phase,
			creditsPerUsd: CREDITS_PER_USD
		};
	}
	const message = err instanceof Error ? err.message : fallbackMessage;
	return { error: message };
}
