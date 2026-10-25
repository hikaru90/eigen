import { insertEvalUserRow } from '$lib/eval/store'
import { PLATFORM_EMBEDDING_MODEL } from '$lib/server/billing/platform-llm'
import { assertEvalChatModel } from '$lib/server/llm/eval-chat-model'

/**
 * What `loadPlatformLlmConfig` needs. The product has no BYOK and no per-user model config
 * (removed in ecb31d6d): every call goes through OpenRouter on the service key and debits the
 * billing user's platform-credit wallet. The chat model comes from the run's `--chat-model`
 * flag (eval-only override); the embedding model stays pinned in the product.
 */
const REQUIRED_ENV = ['OPENROUTER_BASE_URL', 'SERVICE_API_KEY_OPENROUTER'] as const

export type PublicBenchModels = {
  modelChat: string
  modelEmbedding: string
}

export class PublicBenchConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`[public-bench] invalid configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'PublicBenchConfigError'
  }
}

/** Pure env validation: throws ONE error listing every missing variable. */
export function assertPublicBenchGatewayEnv(env: NodeJS.ProcessEnv): void {
  const problems: string[] = []
  for (const name of REQUIRED_ENV) {
    if (!env[name]?.trim()) problems.push(`${name} is required and missing`)
  }
  if (problems.length > 0) throw new PublicBenchConfigError(problems)
}

/**
 * Ensure the benchmark operator exists with a funded platform-credit wallet. All LLM spend of
 * the run is billed to this operator (via `billingUserId`), never to the benchmark tenants.
 */
export async function ensurePublicBenchOperator(input: {
  operatorUserId: string
  displayName: string
  chatModel: string
}): Promise<PublicBenchModels> {
  const { operatorUserId, displayName } = input
  if (!operatorUserId.trim()) throw new Error('[public-bench] operatorUserId must be non-empty')
  if (!displayName.trim()) throw new Error('[public-bench] displayName must be non-empty')
  const chatModel = assertEvalChatModel(input.chatModel)

  assertPublicBenchGatewayEnv(process.env)

  await insertEvalUserRow(operatorUserId, displayName)

  const models = { modelChat: chatModel, modelEmbedding: PLATFORM_EMBEDDING_MODEL }
  console.info(
    `[public-bench] operator ${operatorUserId} ready (platform credits via OpenRouter, ` +
      `chat=${models.modelChat}, embed=${models.modelEmbedding})`,
  )

  return models
}
