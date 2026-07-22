/**
 * Shared eval config: stable user ids and other constants imported by both
 * the seed harness and the runners. Kept tiny so importing it never triggers
 * any eval-side effects.
 */
export const EVAL_JUDGE_USER_ID = 'eval-runner-judge'

/** Default operator for CLI eval runs (owns eval_run rows under RLS). */
export const EVAL_OPERATOR_USER_ID = 'eval-runner-operator'

/** Stable brain tenant for eval captures — one corpus per operator, reused across runs. */
export function evalCorpusUserId(operatorUserId: string): string {
  return `eval-corpus-${operatorUserId}`
}

/** Max wait for entity kick+poll when enrich was not awaited inline. Override via env. */
export const EVAL_ENRICHMENT_TIMEOUT_MS_DEFAULT = 10 * 60 * 1000

/** Wall clock per capture/edit step (inline enrich + judge). Override via EVAL_ENTRY_TIMEOUT_MS. */
export const EVAL_ENTRY_TIMEOUT_MS_DEFAULT = 20 * 60 * 1000

/** Same-run re-capture after ingest failure (corpus purge always runs at least once per run). */
export const EVAL_INGEST_RETRY_MAX_DEFAULT = 1
