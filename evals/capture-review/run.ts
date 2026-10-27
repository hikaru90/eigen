/**
 * `npm run capture-review:smoke -- --help` lists the flags. Captures a few real-shaped thoughts into
 * a harness tenant and prints their capture reviews (docs/planning/capture-feedback.md, phase C1).
 */
import '../../scripts/load-project-env'
import { SMOKE_USAGE, SmokeUsageError, parseSmokeArgs, type SmokeArgs } from './cli'

let args: SmokeArgs | null = null
try {
  args = parseSmokeArgs(process.argv.slice(2))
} catch (err: unknown) {
  if (!(err instanceof SmokeUsageError)) throw err
  console.error(`${err.message}\n\n${SMOKE_USAGE}`)
  process.exitCode = 2
}

if (args?.help) {
  console.log(SMOKE_USAGE)
} else if (args) {
  // Loaded only now, so --help and a usage error never touch the database modules. Awaited so
  // module evaluation lasts for the whole run: vite-node closes its module server when the entry
  // module settles. runEval closes the pool and exits with the run's exit code.
  const smokeArgs = args
  const { runEval } = await import('../harness/eval-context')
  const { runSmoke } = await import('./run-smoke')
  await runEval(() => runSmoke(smokeArgs))
}
