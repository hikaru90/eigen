import { env as kitEnv } from '$env/dynamic/private'

/**
 * Optional private env keys referenced in code but not always present in `.env`
 * when `svelte-kit sync` generates `$env/dynamic/private` types.
 */
export type ExtendedPrivateEnv = typeof kitEnv & {
  BILLING_BYOK_UI_ENABLED?: string
  CAPTURE_ENRICH_CONCURRENCY?: string
  CONSOLIDATION_CRON_TZ?: string
  DB_POOL_MAX?: string
  EVAL_ENRICHMENT_KICK_CONCURRENCY?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GRAPH_SCALE_QUIET?: string
  GRAPH_SCALE_SPEND?: string
  LLM_MODEL_CHAT?: string
  LLM_MODEL_EMBEDDING?: string
  LLM_MODEL_STT?: string
  LLM_ORCHESTRATION_CONCURRENCY?: string
  LLM_REQUEST_TIMEOUT_MS?: string
  LLM_SERIAL_REQUESTS?: string
  NODE_ENV?: string
  PAYPAL_CLIENT_SECRET?: string
  PAYPAL_URL?: string
  PAYPAL_USE_LIVE_SDK?: string
  PAYPAL_WEB_SDK_URL?: string
  TEMPORAL_ANCHOR_TZ?: string
}

export const env: ExtendedPrivateEnv = kitEnv
