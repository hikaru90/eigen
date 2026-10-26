import { parsePersonaMemCli } from './cli'
import { buildPlan, formatPlan } from './plan'
import { loadIngestSource, verifyIngestRecords } from './reuse-ingest'

/**
 * Entry logic. The dry run stays on pure modules only (no database, no LLM client, no harness);
 * the live path is loaded by dynamic import and only when a real run is requested.
 * `reportsRoot` is where earlier runs live (tests inject a temp dir).
 */
export async function main(
  argv: readonly string[],
  log: (line: string) => void = console.log,
  reportsRoot?: string,
): Promise<void> {
  const cli = parsePersonaMemCli(argv)

  if (cli.dryRun) {
    const plan = buildPlan(cli)
    for (const line of formatPlan(plan, cli)) log(line)
    if (cli.reuseIngest !== null) {
      // everything that can be checked without the database: the source run's identity and records
      const verified = verifyIngestRecords({
        sourceRunId: cli.reuseIngest,
        source: loadIngestSource(cli.reuseIngest, reportsRoot),
        current: cli,
        planned: plan.personas,
        requireAll: true,
      })
      const captures = [...verified.values()].reduce((n, r) => n + r.captures, 0)
      log('')
      log(
        `ingest reuse: run ${cli.reuseIngest} verified offline: ${verified.size} tenant(s), ${captures} capture(s); the tenants' thoughts are checked in the database at run time`,
      )
    }
    return
  }

  const { runLive } = await import('./run-live')
  await runLive(cli)
}
