import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'
import { env } from '$lib/server/env/private-env'
import { currentEvalChatModel } from '$lib/server/llm/eval-chat-model'
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
 * Platform-managed gateway credentials (Eigen service account). Every AI call goes through
 * OpenRouter on the service key and bills the user's Eigen credits.
 */
export async function loadPlatformLlmConfig(userId: string): Promise<ResolvedLlmConfig> {
  const baseUrl = env.OPENROUTER_BASE_URL?.trim()
  const apiKey = env.SERVICE_API_KEY_OPENROUTER?.trim()
  if (!baseUrl) {
    throw new Error('Platform OpenRouter not configured: set OPENROUTER_BASE_URL')
  }
  if (!apiKey) {
    throw new Error('Platform OpenRouter not configured: set SERVICE_API_KEY_OPENROUTER')
  }
  const evalChatModel = currentEvalChatModel()
  if (evalChatModel !== undefined && resolveHarnessBillingUserId(userId) === undefined) {
    throw new Error(
      `Eval chat model override "${evalChatModel}" is only allowed for harness billing users, not "${userId}"`,
    )
  }
  return {
    provider: 'openrouter',
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    modelChat: evalChatModel ?? PLATFORM_CHAT_MODEL,
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
    modelChat: null,
    modelEmbedding: null,
  }
}
