import type { PersonaMemCli } from './cli'
import type { PreparedRow } from './types'
import type { IngestMode } from './types'
import { modelSlug } from '../public-bench/model-slug'
import { seededSample } from '../public-bench/seeded'
import { DAY_MS, historyToCaptures, type CaptureItem } from './history-to-captures'
import { groupByPersona, loadHistory, loadPreparedRows, type PersonaQueries } from './load-dataset'
import { buildOptions, type McqOptions } from './mcq'

const USD_PER_CAPTURE = 0.0015
const USD_PER_ASK_TURN_FLOOR = 0.003
const USD_PER_QUERY = 0.008

export type PlannedQuestion = McqOptions & { row: PreparedRow }

export type PlannedPersona = {
  personaId: number
  tenantUserId: string
  /** The user turns in history order: queued as captures (`capture`) or replayed through Ask (`ask`). */
  captures: CaptureItem[]
  /** The query is asked right after the conversation ended. */
  referenceTime: Date
  questions: PlannedQuestion[]
}

export type Plan = {
  personas: PlannedPersona[]
  totals: { personas: number; captures: number; queries: number; estimatedUsd: number }
}

export function tenantUserIdFor(ingest: IngestMode, chatModel: string, personaId: number): string {
  return `public-bench-personamem-v2-${ingest}-${modelSlug(chatModel)}-p${personaId}`
}

export function estimateUsd(captures: number, queries: number): number {
  return captures * USD_PER_CAPTURE + queries * USD_PER_QUERY
}

/**
 * Floor only: an Ask turn costs about USD 0.003 before it captures anything; what Ask chooses to
 * capture, and the enrich of those captures, are unknown until the run.
 */
export function estimateAskFloorUsd(turns: number, queries: number): number {
  return turns * USD_PER_ASK_TURN_FLOOR + queries * USD_PER_QUERY
}

function selectPersonas(all: PersonaQueries[], cli: PersonaMemCli): PersonaQueries[] {
  const { selection } = cli
  if (selection.kind === 'all') return all
  if (selection.kind === 'ids') {
    const byId = new Map(all.map((p) => [p.personaId, p]))
    return selection.ids.map((id) => {
      const persona = byId.get(id)
      if (!persona) throw new Error(`[personamem] persona ${id} is not in the dataset`)
      return persona
    })
  }
  return seededSample(all, selection.count, selection.seed)
}

/** Pure and offline: loads prepared data and histories, builds captures and options. */
export function buildPlan(cli: PersonaMemCli): Plan {
  const personas = selectPersonas(groupByPersona(loadPreparedRows(cli.dataDir)), cli).map(
    (persona): PlannedPersona => {
      const captures = historyToCaptures(loadHistory(persona.historyPath))
      const rows =
        cli.limitQueries === null ? persona.queries : persona.queries.slice(0, cli.limitQueries)
      return {
        personaId: persona.personaId,
        tenantUserId: tenantUserIdFor(cli.ingest, cli.chatModel, persona.personaId),
        captures,
        referenceTime: new Date(captures[captures.length - 1]!.capturedAt.getTime() + DAY_MS),
        questions: rows.map((row) => ({ row, ...buildOptions(row) })),
      }
    },
  )
  const captures = personas.reduce((n, p) => n + p.captures.length, 0)
  const queries = personas.reduce((n, p) => n + p.questions.length, 0)
  return {
    personas,
    totals: {
      personas: personas.length,
      captures,
      queries,
      estimatedUsd:
        cli.ingest === 'ask'
          ? estimateAskFloorUsd(captures, queries)
          : estimateUsd(captures, queries),
    },
  }
}

function describeSelection(cli: PersonaMemCli): string {
  const { selection } = cli
  if (selection.kind === 'all') return 'all personas'
  if (selection.kind === 'ids') return `persona ids ${selection.ids.join(',')}`
  return `${selection.count} personas, seed ${JSON.stringify(selection.seed)}`
}

export function formatPlan(plan: Plan, cli: PersonaMemCli): string[] {
  const { totals } = plan
  const ask = cli.ingest === 'ask'
  return [
    'PersonaMem-v2 dry run (nothing touched the database or an LLM)',
    `data dir: ${cli.dataDir}`,
    `chat model: ${cli.chatModel}`,
    `ingest: ${cli.ingest}`,
    `selection: ${describeSelection(cli)}`,
    `tenant concurrency: ${cli.tenantConcurrency}, enrich concurrency: ${cli.enrichConcurrency}`,
    `limit queries per persona: ${cli.limitQueries ?? 'none'}`,
    '',
    `personas: ${totals.personas}`,
    ask
      ? `Ask turns: ${totals.captures} (one Ask message per user turn; system persona dump and assistant turns are not replayed; what Ask captures is unknown until the run)`
      : `captures: ${totals.captures} (user turns only; system persona dump and assistant turns excluded)`,
    `queries: ${totals.queries} (each answered twice: eigen, no-memory)`,
    ask
      ? `estimated USD: at least $${totals.estimatedUsd.toFixed(3)} (floor: turns x $${USD_PER_ASK_TURN_FLOOR} + queries x $${USD_PER_QUERY}; Ask captures and their enrich are not included)`
      : `estimated USD: $${totals.estimatedUsd.toFixed(3)} (captures x $${USD_PER_CAPTURE} + queries x $${USD_PER_QUERY})`,
    '',
    'tenants:',
    ...plan.personas.map(
      (p) =>
        `  ${p.tenantUserId}  ${ask ? 'turns' : 'captures'}=${p.captures.length}  queries=${p.questions.length}`,
    ),
  ]
}
