import { parsePersonaMemCli } from './cli'
import { buildPlan, formatPlan } from './plan'

/**
 * Entry logic. The dry run stays on pure modules only (no database, no LLM client, no harness);
 * the live path is loaded by dynamic import and only when a real run is requested.
 */
export async function main(
  argv: readonly string[],
  log: (line: string) => void = console.log,
): Promise<void> {
  const cli = parsePersonaMemCli(argv)

  if (cli.dryRun) {
    for (const line of formatPlan(buildPlan(cli), cli)) log(line)
    return
  }

  const { runLive } = await import('./run-live')
  await runLive(cli)
}
