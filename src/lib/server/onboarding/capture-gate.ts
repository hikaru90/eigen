import { MIN_CAPTURE_PIPELINE_CREDITS, CREDITS_PER_USD } from '$lib/server/billing/credits';
import { isByokBilling } from '$lib/server/billing/preferences';
import { getOrCreateWallet, InsufficientCreditsError } from '$lib/server/billing/wallet';
import {
	isInitialGroundingComplete,
	loadGroundingProfileRow
} from '$lib/server/grounding/profile';

export type CaptureGateReason = 'insufficient_credits' | 'grounding_required';

export type CaptureGateResult =
	| { allowed: true }
	| { allowed: false; reason: CaptureGateReason };

export class CaptureGateError extends Error {
	constructor(public readonly reason: CaptureGateReason) {
		super(reason === 'grounding_required' ? 'Grounding conversation required' : 'Insufficient credits');
		this.name = 'CaptureGateError';
	}
}

export async function checkCaptureAllowed(userId: string): Promise<CaptureGateResult> {
	const grounding = await loadGroundingProfileRow(userId);
	if (!isInitialGroundingComplete(grounding)) {
		return { allowed: false, reason: 'grounding_required' };
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
		if (gate.reason === 'insufficient_credits') {
			const wallet = await getOrCreateWallet(userId);
			throw new InsufficientCreditsError({
				message: `Insufficient credits: need at least ${MIN_CAPTURE_PIPELINE_CREDITS} to capture.`,
				availableCredits: wallet.availableCredits,
				requiredCredits: MIN_CAPTURE_PIPELINE_CREDITS,
				phase: 'precheck'
			});
		}
		throw new CaptureGateError(gate.reason);
	}
}

export function isCaptureGateError(err: unknown): err is CaptureGateError {
	return err instanceof CaptureGateError;
}

export const GROUNDING_REQUIRED_CODE = 'grounding_required' as const;

export function captureGateHttpStatus(err: unknown): number {
	if (isCaptureGateError(err)) return 403;
	if (err instanceof InsufficientCreditsError) return 402;
	return 500;
}

export function captureGateJsonBody(err: unknown, fallbackMessage: string): Record<string, unknown> {
	if (isCaptureGateError(err)) {
		return {
			error: err.message,
			code: GROUNDING_REQUIRED_CODE
		};
	}
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
