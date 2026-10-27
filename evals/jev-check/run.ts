/**
 * `npm run jev:check -- --help` lists the flags. Asks Jev the labelled capture-review examples and
 * prints where it disagrees (docs/planning/capture-feedback.md, phase C0).
 */
import '../../scripts/load-project-env'
import { fileURLToPath } from 'node:url'
import { JEV_CHECK_USAGE, JevCheckUsageError, runJevCheck } from './cli'

const outDir = fileURLToPath(new URL('../.data/jev-check', import.meta.url))

// Awaited so module evaluation lasts for the whole run: vite-node closes its module server when the
// entry module settles.
try {
  const { exitCode } = await runJevCheck(process.argv.slice(2), {
    env: process.env,
    log: (line) => console.log(line),
    outDir,
    now: () => new Date(),
  })
  process.exitCode = exitCode
} catch (err: unknown) {
  if (err instanceof JevCheckUsageError) {
    console.error(`${err.message}\n\n${JEV_CHECK_USAGE}`)
    process.exit(2)
  }
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
