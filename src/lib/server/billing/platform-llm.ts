import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { llmActiveProvider } from '$lib/server/db/schema';
import type { LlmProviderKind, ResolvedLlmConfig } from '$lib/server/llm/types';

/**
 * Platform-managed gateway credentials (Eigen pays via env keys).
 * Used when billing_mode is platform_credits.
 */
export async function loadPlatformLlmConfig(userId: string): Promise<ResolvedLlmConfig> {
	const db = getDb();
	const [activeRow] = await db
		.select()
		.from(llmActiveProvider)
		.where(eq(llmActiveProvider.userId, userId))
		.limit(1);
	const provider = (activeRow?.provider ?? 'eurouter') as LlmProviderKind;

	if (provider === 'openrouter') {
		const baseUrl = env.OPENROUTER_BASE_URL?.trim();
		const apiKey = env.OPENROUTER_API_KEY?.trim();
		if (!baseUrl) {
			throw new Error('Platform OpenRouter not configured: set OPENROUTER_BASE_URL');
		}
		if (!apiKey) {
			throw new Error('Platform OpenRouter not configured: set OPENROUTER_API_KEY');
		}
		return {
			provider: 'openrouter',
			baseUrl: baseUrl.replace(/\/$/, ''),
			apiKey,
			ruleChat: null,
			ruleEmbedding: null,
			modelChat: env.LLM_MODEL_CHAT?.trim() || null,
			modelEmbedding: env.LLM_MODEL_EMBEDDING?.trim() || null
		};
	}

	const baseUrl = env.LLM_BASE_URL?.trim();
	const apiKey = env.LLM_API_KEY?.trim();
	if (!baseUrl) {
		throw new Error('Platform EUrouter not configured: set LLM_BASE_URL');
	}
	if (!apiKey) {
		throw new Error('Platform EUrouter not configured: set LLM_API_KEY');
	}
	return {
		provider: 'eurouter',
		baseUrl: baseUrl.replace(/\/$/, ''),
		apiKey,
		ruleChat: env.LLM_RULE_CHAT?.trim() || null,
		ruleEmbedding: env.LLM_RULE_EMBEDDING?.trim() || null,
		modelChat: null,
		modelEmbedding: null
	};
}

export async function loadPlatformOpenRouterSttConfig(): Promise<ResolvedLlmConfig> {
	const baseUrl = env.OPENROUTER_BASE_URL?.trim();
	const apiKey = env.OPENROUTER_API_KEY?.trim();
	if (!baseUrl) {
		throw new Error('Platform OpenRouter STT not configured: set OPENROUTER_BASE_URL');
	}
	if (!apiKey) {
		throw new Error('Platform OpenRouter STT not configured: set OPENROUTER_API_KEY');
	}
	return {
		provider: 'openrouter',
		baseUrl: baseUrl.replace(/\/$/, ''),
		apiKey,
		ruleChat: null,
		ruleEmbedding: null,
		modelChat: null,
		modelEmbedding: null
	};
}
