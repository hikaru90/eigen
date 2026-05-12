/**
 * Activity page lists billable LLM gateway traffic only (per requirements: transparent gateway usage).
 * New rows use {@link LLM_GATEWAY_ACTIVITY_PROVIDER}; legacy rows may still use `llm`.
 */
export const LLM_GATEWAY_ACTIVITY_PROVIDER = 'eurouter' as const;

export const AGENT_TOOL_ACTIVITY_PROVIDER = 'agent' as const;

export const ACTIVITY_PAGE_LLM_PROVIDERS = [LLM_GATEWAY_ACTIVITY_PROVIDER, 'llm'] as const;
