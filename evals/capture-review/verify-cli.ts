import { parseSmokeArgs, SmokeUsageError, type SmokeArgs } from './cli'

export const VERIFY_USAGE = `Usage: npm run capture-review:verify -- [options]

Proves the capture review does its job, on real data. Captures the made-up cases in
evals/capture-review/verify-cases.json one by one into the harness tenant "capture-review-verify"
through the real capture path and scores each review. Clean cases must score at or above the
threshold. For each mistake case a known mistake is then injected into the stored data at the source
the audit reads (a date, a name, the wording, the split pieces), the audit is re-run directly, and the
targeted part must carry the negative label with a score below the threshold. Then it casts votes
through voteOnCapture (thumbs up, thumbs down with no reason, thumbs down with a reason, a re-vote)
and checks the operator counts (loadCaptureQuality) move by the expected amounts.
Prints a table, one row per case, then the vote checks, the operator deltas and the total USD.
Real behaviour: no eval LLM cache, the platform default chat model. Needs the database,
OPENROUTER_BASE_URL, SERVICE_API_KEY_OPENROUTER and the Jev decision-model config
(DECISION_SHADOW_ENABLED=true, OPENROUTER_API_KEY, DECISION_SHADOW_MODEL).

Options:
  --keep    Keep the tenant's existing data instead of resetting it first
  --help    This text

Exit code: 1 when any case, vote check or operator delta fails, 2 for a usage error, else 0.`

export type VerifyArgs = SmokeArgs
export { SmokeUsageError as VerifyUsageError }

/** Same flags as the smoke: --keep and --help. */
export function parseVerifyArgs(argv: string[]): VerifyArgs {
  return parseSmokeArgs(argv)
}
