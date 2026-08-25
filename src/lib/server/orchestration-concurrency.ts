import { env } from '$lib/server/env/private-env'

/** Default parallel workers for enrich drain and eval entry waves. */
export const DEFAULT_ORCHESTRATION_CONCURRENCY = 8

function readEnv(name: string): string | undefined {
  const fromPrivate = env[name as keyof typeof env]
  if (typeof fromPrivate === 'string' && fromPrivate.trim()) return fromPrivate.trim()
  const fromProcess = process.env[name]?.trim()
  return fromProcess || undefined
}

function parsePositiveInt(raw: string, label: string): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a positive integer, got: ${raw}`)
  }
  return parsed
}

export type ResolveOrchestrationConcurrencyOptions = {
  explicit?: number
  envKeys: readonly string[]
  fallback?: number
}

/**
 * Bounded parallelism for orchestration pools (enrich workers, eval waves).
 * Checks env keys in order.
 */
export function resolveOrchestrationConcurrency(
  options: ResolveOrchestrationConcurrencyOptions,
): number {
  const { explicit, envKeys, fallback = DEFAULT_ORCHESTRATION_CONCURRENCY } = options
  if (explicit != null) {
    return parsePositiveInt(String(explicit), 'orchestration concurrency')
  }
  for (const key of envKeys) {
    const raw = readEnv(key)
    if (raw) return parsePositiveInt(raw, key)
  }
  return fallback
}

const CAPTURE_ENRICH_ENV_KEYS = [
  'CAPTURE_ENRICH_CONCURRENCY',
  'LLM_ORCHESTRATION_CONCURRENCY',
] as const

const EVAL_ENTRY_ENV_KEYS = [
  'EVAL_ENTRY_CONCURRENCY',
  'LLM_ORCHESTRATION_CONCURRENCY',
  ...CAPTURE_ENRICH_ENV_KEYS,
] as const

/** Parallel enrich-queue workers (background worker and inline drain). */
export function resolveCaptureEnrichConcurrency(explicit?: number): number {
  return resolveOrchestrationConcurrency({
    explicit,
    envKeys: CAPTURE_ENRICH_ENV_KEYS,
  })
}

/** Parallel eval harness entry waves (check / retrieval / answer). */
export function resolveEvalEntryConcurrency(explicit?: number): number {
  return resolveOrchestrationConcurrency({
    explicit,
    envKeys: EVAL_ENTRY_ENV_KEYS,
  })
}

/** Parallel re-enrich kicks while waiting for entity resolution (eval harness). */
export function resolveEnrichmentKickConcurrency(explicit?: number): number {
  return resolveOrchestrationConcurrency({
    explicit,
    envKeys: ['EVAL_ENRICHMENT_KICK_CONCURRENCY', ...CAPTURE_ENRICH_ENV_KEYS],
  })
}
