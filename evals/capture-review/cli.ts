export const SMOKE_USAGE = `Usage: npm run capture-review:smoke -- [options]

Captures the examples in evals/capture-review/smoke.json one by one into the harness tenant
"capture-review-smoke" through the real capture path (eval clock = each capture time), drains the
tenant's enrichment, then drains its job queue so the capture_review_audit jobs run. Prints, per
capture and split child: the stored text, category, review status and score, the review parts and
the audit input, then totals. Real behaviour: no eval LLM cache, the platform default chat model.
Needs the database, OPENROUTER_BASE_URL, SERVICE_API_KEY_OPENROUTER and the Jev decision-model
config (DECISION_SHADOW_ENABLED=true, OPENROUTER_API_KEY, DECISION_SHADOW_MODEL).

Options:
  --keep    Keep the tenant's existing data instead of resetting it first
  --help    This text

Exit code: 1 when any review is not "scored" (or a thought has none), 2 for a usage error, else 0.`

export class SmokeUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmokeUsageError'
  }
}

export type SmokeArgs = { keep: boolean; help: boolean }

export function parseSmokeArgs(argv: string[]): SmokeArgs {
  const args: SmokeArgs = { keep: false, help: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--keep') {
      if (args.keep) throw new SmokeUsageError('--keep given more than once')
      args.keep = true
    } else {
      throw new SmokeUsageError(`unknown argument "${arg}"`)
    }
  }
  return args
}
