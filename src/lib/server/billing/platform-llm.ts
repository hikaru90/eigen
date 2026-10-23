import { env } from '$lib/server/env/private-env'
import type { ResolvedLlmConfig } from '$lib/server/llm/types'

/**
 * The models every platform (service-account) call uses. Pinned in code, not env, so a
 * deploy can never run with a missing or different model. The embedding model must keep
 * returning the 1536-dimension vectors stored in `thought.embedding` (EMBEDDING_DIMENSIONS)
 * — changing it means re-embedding every thought.
 */
export const PLATFORM_CHAT_MODEL = 'deepseek/deepseek-v4.1-flash-1017'
export const PLATFORM_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'

/**
 * Platform-managed gateway credentials (Eigen service account), used when billing_mode is
 * platform_credits. All platform inference goes through OpenRouter on the service key.
 */
export async function loadPlatformLlmConfig(_userId: string): Promise<ResolvedLlmConfig> {
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
    modelChat: PLATFORM_CHAT_MODEL,
    modelEmbedding: PLATFORM_EMBEDDING_MODEL,
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
