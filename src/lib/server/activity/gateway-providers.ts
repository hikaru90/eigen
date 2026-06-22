import type { LlmProviderKind } from '$lib/server/llm/types';

/**
 * Activity page lists billable LLM gateway traffic only (per requirements: transparent gateway usage).
 * New rows use {@link LLM_GATEWAY_ACTIVITY_PROVIDER} or {@link OPENROUTER_ACTIVITY_PROVIDER}; legacy rows may still use `llm`.
 */
export const LLM_GATEWAY_ACTIVITY_PROVIDER = 'eurouter' as const;

/** OpenRouter gateway (e.g. speech-to-text via `/audio/transcriptions`). */
export const OPENROUTER_ACTIVITY_PROVIDER = 'openrouter' as const;

export const AGENT_TOOL_ACTIVITY_PROVIDER = 'agent' as const;

export const ACTIVITY_PAGE_LLM_PROVIDERS = [
	LLM_GATEWAY_ACTIVITY_PROVIDER,
	OPENROUTER_ACTIVITY_PROVIDER,
	'llm'
] as const;

/** Map resolved LLM config to the activity_call_log provider label. */
export function activityProviderForLlmConfig(
	provider: LlmProviderKind
): typeof LLM_GATEWAY_ACTIVITY_PROVIDER | typeof OPENROUTER_ACTIVITY_PROVIDER {
	return provider === 'openrouter' ? OPENROUTER_ACTIVITY_PROVIDER : LLM_GATEWAY_ACTIVITY_PROVIDER;
}
