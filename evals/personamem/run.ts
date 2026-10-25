/**
 * PersonaMem-v2 x Eigen. `npm run eval:personamem -- --help` lists the flags.
 */
import { PERSONAMEM_USAGE, PersonaMemUsageError } from './cli'
import { main } from './main'

const argv = process.argv.slice(2)

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(PERSONAMEM_USAGE)
} else {
  // Awaited so module evaluation lasts for the whole run: vite-node closes its module server
  // when the entry module settles, and the live path is loaded by dynamic import.
  try {
    await main(argv)
  } catch (err: unknown) {
    if (err instanceof PersonaMemUsageError) {
      console.error(`${err.message}\n\n${PERSONAMEM_USAGE}`)
      process.exit(2)
    }
    console.error('[personamem] failed:', err instanceof Error ? (err.stack ?? err.message) : err)
    process.exit(1)
  }
}
