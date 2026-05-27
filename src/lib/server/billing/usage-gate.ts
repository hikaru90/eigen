import { isByokBilling } from '$lib/server/billing/preferences';
import {
	InsufficientCreditsError,
	releaseReservation,
	reserveFunds,
	settleReservation
} from '$lib/server/billing/wallet';
import { baseUsdToBilledCents } from '$lib/server/billing/money';
import type { ChatMessage } from '$lib/server/llm/llm-client';
import { TOKEN_USD_PER_1K } from '$lib/server/llm/token-rates';

export { InsufficientCreditsError };

/** Conservative pre-call estimate for chat (includes markup), minimum 1 cent. */
export function estimateChatBilledCents(messages: ChatMessage[]): number {
	const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
	const estimatedPromptTokens = Math.max(1, Math.ceil(totalChars / 4));
	const estimatedCompletionTokens = Math.min(512, Math.ceil(estimatedPromptTokens / 2));
	const baseUsd =
		(estimatedPromptTokens / 1000) * TOKEN_USD_PER_1K.prompt +
		(estimatedCompletionTokens / 1000) * TOKEN_USD_PER_1K.completion;
	return Math.max(1, baseUsdToBilledCents(baseUsd));
}

export function estimateEmbeddingBilledCents(input: string | string[]): number {
	const text = Array.isArray(input) ? input.join(' ') : input;
	const estimatedTokens = Math.max(1, Math.ceil(text.length / 4));
	return Math.max(1, baseUsdToBilledCents((estimatedTokens / 1000) * TOKEN_USD_PER_1K.prompt));
}

export function billedCentsFromBaseUsd(baseCostUsd: number): number {
	if (baseCostUsd <= 0) return 0;
	return baseUsdToBilledCents(baseCostUsd);
}

export type PlatformBillingScope = {
	reservationId: string;
	heldCents: number;
};

/**
 * Runs `fn` with platform credit reservation when billing_mode is platform_credits.
 * BYOK mode runs `fn` directly with no wallet interaction.
 */
export async function withPlatformBilling<T>(
	userId: string,
	estimatedCents: number,
	settleFromBaseUsd: (result: T) => number,
	fn: () => Promise<T>
): Promise<T> {
	if (await isByokBilling(userId)) {
		return fn();
	}

	const heldCents = Math.max(1, estimatedCents);
	const reservationId = await reserveFunds(userId, heldCents);
	try {
		const result = await fn();
		const actualCents = billedCentsFromBaseUsd(settleFromBaseUsd(result));
		await settleReservation(userId, reservationId, heldCents, actualCents, {
			estimatedCents: heldCents,
			actualCents
		});
		return result;
	} catch (err) {
		await releaseReservation(userId, reservationId, heldCents);
		throw err;
	}
}
