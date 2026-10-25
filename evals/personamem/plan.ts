import type { PersonaMemCli } from './cli'
import type { PreparedRow } from './types'
import { modelSlug } from '../public-bench/model-slug'
import { seededSample } from '../public-bench/seeded'
import { DAY_MS, historyToCaptures, type CaptureItem } from './history-to-captures'
import { groupByPersona, loadHistory, loadPreparedRows, type PersonaQueries } from './load-dataset'
import { buildOptions, type McqOptions } from './mcq'

const USD_PER_CAPTURE = 0.0015
const USD_PER_QUERY = 0.008

export type PlannedQuestion = McqOptions & { row: PreparedRow }

export type PlannedPersona = {
  personaId: number
  tenantUserId: string
  captures: CaptureItem[]
  /** The query is asked right after the conversation ended. */
  referenceTime: Date
  questions: PlannedQuestion[]
}

export type Plan = {
  personas: PlannedPersona[]
  totals: { personas: number; captures: number; queries: number; estimatedUsd: number }
}

export function tenantUserIdFor(chatModel: string, personaId: number): string {
  return `public-bench-personamem-v2-${modelSlug(chatModel)}-p${personaId}`
}

export function estimateUsd(captures: number, queries: number): number {
  return captures * USD_PER_CAPTURE + queries * USD_PER_QUERY
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
        tenantUserId: tenantUserIdFor(cli.chatModel, persona.personaId),
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
      estimatedUsd: estimateUsd(captures, queries),
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
  return [
    'PersonaMem-v2 dry run (nothing touched the database or an LLM)',
    `data dir: ${cli.dataDir}`,
    `chat model: ${cli.chatModel}`,
    `selection: ${describeSelection(cli)}`,
    `tenant concurrency: ${cli.tenantConcurrency}, enrich concurrency: ${cli.enrichConcurrency}`,
    `limit queries per persona: ${cli.limitQueries ?? 'none'}`,
    '',
    `personas: ${totals.personas}`,
    `captures: ${totals.captures} (user turns only; system persona dump and assistant turns excluded)`,
    `queries: ${totals.queries} (each answered twice: eigen, no-memory)`,
    `estimated USD: $${totals.estimatedUsd.toFixed(3)} (captures x $${USD_PER_CAPTURE} + queries x $${USD_PER_QUERY})`,
    '',
    'tenants:',
    ...plan.personas.map(
      (p) => `  ${p.tenantUserId}  captures=${p.captures.length}  queries=${p.questions.length}`,
    ),
  ]
}
