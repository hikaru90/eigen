import { eq } from 'drizzle-orm'
import { env } from '$lib/server/env/private-env'
import { withBillingUserDbRead } from '$lib/server/db/billing-db-read'
import { llmActiveProvider } from '$lib/server/db/schema'
import { assertEurouterGatewayConfigured } from '$lib/server/llm/llm-config-guard'
import type { LlmProviderKind, ResolvedLlmConfig } from '$lib/server/llm/types'

/**
 * Platform-managed gateway credentials (Eigen service account).
 * Used when billing_mode is platform_credits.
 */
export async function loadPlatformLlmConfig(userId: string): Promise<ResolvedLlmConfig> {
  const [activeRow] = await withBillingUserDbRead(userId, (db) =>
    db.select().from(llmActiveProvider).where(eq(llmActiveProvider.userId, userId)).limit(1),
  )
  const provider = (activeRow?.provider ?? 'eurouter') as LlmProviderKind

  if (provider === 'openrouter') {
    const baseUrl = env.OPENROUTER_BASE_URL?.trim()
    const apiKey = env.SERVICE_API_KEY_OPENROUTER?.trim()
    if (!baseUrl) {
      throw new Error('Platform OpenRouter not configured: set OPENROUTER_BASE_URL')
    }
    if (!apiKey) {
      throw new Error('Platform OpenRouter not configured: set SERVICE_API_KEY_OPENROUTER')
    }
    return {
      provider: 'openrouter',
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKey,
      ruleChat: null,
      ruleEmbedding: null,
      modelChat: env.LLM_MODEL_CHAT?.trim() || null,
      modelEmbedding: env.LLM_MODEL_EMBEDDING?.trim() || null,
    }
  }

  const baseUrl = env.LLM_BASE_URL?.trim()
  const apiKey = env.SERVICE_API_KEY_EUROUTER?.trim()
  if (!baseUrl) {
    throw new Error('Platform EUrouter not configured: set LLM_BASE_URL')
  }
  if (!apiKey) {
    throw new Error('Platform EUrouter not configured: set SERVICE_API_KEY_EUROUTER')
  }
  const ruleChat = env.LLM_RULE_CHAT?.trim() || null
  const ruleEmbedding = env.LLM_RULE_EMBEDDING?.trim() || null
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  assertEurouterGatewayConfigured({
    baseUrl: normalizedBaseUrl,
    ruleChat,
    ruleEmbedding,
    context: 'platform',
  })
  return {
    provider: 'eurouter',
    baseUrl: normalizedBaseUrl,
    apiKey,
    ruleChat,
    ruleEmbedding,
    modelChat: null,
    modelEmbedding: null,
  }
}

export async function loadPlatformOpenRouterSttConfig(): Promise<ResolvedLlmConfig> {
  const baseUrl = env.OPENROUTER_BASE_URL?.trim()
  const apiKey = env.SERVICE_API_KEY_OPENROUTER?.trim()
  if (!baseUrl) {
    throw new Error('Platform OpenRouter STT not configured: set OPENROUTER_BASE_URL')
  }
  if (!apiKey) {
    throw new Error('Platform OpenRouter STT not configured: set SERVICE_API_KEY_OPENROUTER')
  }
  return {
    provider: 'openrouter',
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    ruleChat: null,
    ruleEmbedding: null,
    modelChat: null,
    modelEmbedding: null,
  }
}
