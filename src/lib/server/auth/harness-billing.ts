/** Platform wallet debited for graph-scale benchmark harness tenants. */
export const GRAPH_SCALE_OPERATOR_USER_ID = 'graph-scale-runner'

/** Default eval CLI operator (see evals/harness/eval-config.ts). */
export const EVAL_OPERATOR_USER_ID = 'eval-runner-operator'

/** LongMemEval harness operator (see evals/longmemeval/run.ts and evals/public-bench/ensure-operator.ts). */
export const LONGMEMEVAL_OPERATOR_USER_ID = 'longmemeval-runner'

/** Public-benchmark harness operator (see evals/public-bench/ensure-operator.ts). */
export const PUBLIC_BENCH_OPERATOR_USER_ID = 'public-bench-runner'

/**
 * Dedicated tenant of `npm run capture-review:smoke` (evals/capture-review): a harness tenant that
 * captures a few real-shaped thoughts so the capture review can be read end to end. Matched by its
 * exact id, funded by the public-bench operator wallet.
 */
export const CAPTURE_REVIEW_SMOKE_TENANT_ID = 'capture-review-smoke'

/**
 * Map harness corpus tenant ids to the operator wallet that funds LLM usage.
 * Id rules only (prefixes and one exact tenant id) — not semantic classification.
 */
export function resolveHarnessBillingUserId(tenantUserId: string): string | undefined {
  const id = tenantUserId.trim()
  if (!id) return undefined

  if (
    id === GRAPH_SCALE_OPERATOR_USER_ID ||
    id === EVAL_OPERATOR_USER_ID ||
    id === LONGMEMEVAL_OPERATOR_USER_ID ||
    id === PUBLIC_BENCH_OPERATOR_USER_ID
  ) {
    return id
  }
  if (id.startsWith('graph-scale-corpus-')) {
    return GRAPH_SCALE_OPERATOR_USER_ID
  }
  if (id.startsWith('eval-corpus-')) {
    const operator = id.slice('eval-corpus-'.length)
    return operator.length > 0 ? operator : EVAL_OPERATOR_USER_ID
  }
  if (id.startsWith('longmemeval-corpus-')) {
    return LONGMEMEVAL_OPERATOR_USER_ID
  }
  if (id.startsWith('public-bench-') || id === CAPTURE_REVIEW_SMOKE_TENANT_ID) {
    return PUBLIC_BENCH_OPERATOR_USER_ID
  }
  return undefined
}

/** Playwright signups (`registerUser` in src/routes/e2e/test-helpers.ts): `e2e-…@test.eigen`. */
const E2E_HARNESS_EMAIL = /^e2e-[^@]+@test\.eigen$/

/**
 * Playwright harness accounts are fresh per test and start with 0 credits; their LLM
 * usage is debited from the eval operator service wallet instead (dev server only —
 * the caller gates on `dev`). Email-format rule only — not semantic classification.
 */
export function resolveE2eHarnessBillingUserId(
  email: string | null | undefined,
): string | undefined {
  const normalized = email?.trim().toLowerCase() ?? ''
  return E2E_HARNESS_EMAIL.test(normalized) ? EVAL_OPERATOR_USER_ID : undefined
}
