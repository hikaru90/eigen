import { env } from '$lib/server/env/private-env'
import { resolveDecisionShadowConfig } from '$lib/server/llm/decision-client'

const PREFIX = '[ops] Jev decision model is not configured'

/**
 * Startup check: the Jev decision model is required by voice transcription (stt-judge),
 * Ask message judging and capture review. A server without it is misconfigured and must
 * refuse to start. Never prints key values.
 */
export function assertDecisionModelConfigured(
  source: Record<string, string | undefined> = env,
): void {
  let config
  try {
    config = resolveDecisionShadowConfig(source)
  } catch (e) {
    throw new Error(`${PREFIX}: ${(e as Error).message}`, { cause: e })
  }
  if (config === null) {
    throw new Error(
      `${PREFIX} — it is required for voice transcription, Ask and capture review. ` +
        'Set DECISION_SHADOW_ENABLED=true, DECISION_SHADOW_MODEL (e.g. typesafe/jev-1.13) and OPENROUTER_API_KEY.',
    )
  }
}
