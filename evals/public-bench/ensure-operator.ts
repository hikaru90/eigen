import { insertEvalUserRow } from '$lib/eval/store'
import { PLATFORM_CHAT_MODEL, PLATFORM_EMBEDDING_MODEL } from '$lib/server/billing/platform-llm'

/**
 * What `loadPlatformLlmConfig` needs. The product has no BYOK and no per-user model config
 * (removed in ecb31d6d): every call goes through OpenRouter on the service key, with models
 * pinned in code, and debits the billing user's platform-credit wallet.
 */
const REQUIRED_ENV = ['OPENROUTER_BASE_URL', 'SERVICE_API_KEY_OPENROUTER'] as const

/** Env that used to select models; the product ignores it, so a value that disagrees is an error. */
const PINNED_MODEL_ENV = [
  ['LLM_MODEL_CHAT', PLATFORM_CHAT_MODEL],
  ['LLM_MODEL_EMBEDDING', PLATFORM_EMBEDDING_MODEL],
] as const

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

/** Pure env validation: throws ONE error listing every missing or conflicting variable. */
export function resolvePublicBenchEnv(env: NodeJS.ProcessEnv): PublicBenchModels {
  const problems: string[] = []
  for (const name of REQUIRED_ENV) {
    if (!env[name]?.trim()) problems.push(`${name} is required and missing`)
  }
  for (const [name, pinned] of PINNED_MODEL_ENV) {
    const value = env[name]?.trim()
    if (value && value !== pinned) {
      problems.push(
        `${name}=${value} conflicts with the model pinned in the product (${pinned}); ` +
          'the product ignores this variable, so unset it or make it match',
      )
    }
  }
  if (problems.length > 0) throw new PublicBenchConfigError(problems)
  return { modelChat: PLATFORM_CHAT_MODEL, modelEmbedding: PLATFORM_EMBEDDING_MODEL }
}

/**
 * Ensure the benchmark operator exists with a funded platform-credit wallet. All LLM spend of
 * the run is billed to this operator (via `billingUserId`), never to the benchmark tenants.
 */
export async function ensurePublicBenchOperator(input: {
  operatorUserId: string
  displayName: string
}): Promise<PublicBenchModels> {
  const { operatorUserId, displayName } = input
  if (!operatorUserId.trim()) throw new Error('[public-bench] operatorUserId must be non-empty')
  if (!displayName.trim()) throw new Error('[public-bench] displayName must be non-empty')

  const models = resolvePublicBenchEnv(process.env)

  await insertEvalUserRow(operatorUserId, displayName)

  console.info(
    `[public-bench] operator ${operatorUserId} ready (platform credits via OpenRouter, ` +
      `chat=${models.modelChat}, embed=${models.modelEmbedding})`,
  )

  return models
}
