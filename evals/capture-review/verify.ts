/**
 * `npm run capture-review:verify -- --help` lists the flags. Captures made-up thoughts into a harness
 * tenant, injects known mistakes into their stored data and checks the capture review catches them
 * (docs/planning/capture-feedback.md, phase C5).
 */
import '../../scripts/load-project-env'
import { VERIFY_USAGE, VerifyUsageError, parseVerifyArgs, type VerifyArgs } from './verify-cli'

let args: VerifyArgs | null = null
try {
  args = parseVerifyArgs(process.argv.slice(2))
} catch (err: unknown) {
  if (!(err instanceof VerifyUsageError)) throw err
  console.error(`${err.message}\n\n${VERIFY_USAGE}`)
  process.exitCode = 2
}

if (args?.help) {
  console.log(VERIFY_USAGE)
} else if (args) {
  // Loaded only now, so --help and a usage error never touch the database modules (see run.ts).
  const verifyArgs = args
  const { runEval } = await import('../harness/eval-context')
  const { runVerify } = await import('./run-verify')
  await runEval(() => runVerify(verifyArgs))
}
