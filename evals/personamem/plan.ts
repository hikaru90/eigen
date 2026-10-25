import type { PersonaMemCli } from './cli'
import type { PreparedRow } from './types'
import { modelSlug } from '../public-bench/model-slug'
import { seededSample } from '../public-bench/seeded'
import {
  DAY_MS,
  evidenceToCaptures,
  historyToCaptures,
  type CaptureItem,
} from './history-to-captures'
import { groupByPersona, loadHistory, loadPreparedRows, type PersonaQueries } from './load-dataset'
import { buildOptions, type McqOptions } from './mcq'

const USD_PER_CAPTURE = 0.0015
const USD_PER_QUERY = 0.008

export type PlannedQuestion = McqOptions & { row: PreparedRow }

export type PlannedPersona = {
  personaId: number
  tenantUserId: string
  /** The user turns to queue as captures: the whole history, or (--evidence-only) the question's evidence. */
  captures: CaptureItem[]
  /** The query is asked right after the conversation ended. */
  referenceTime: Date
  questions: PlannedQuestion[]
}

export type Plan = {
  personas: PlannedPersona[]
  totals: { personas: number; captures: number; queries: number; estimatedUsd: number }
}

/** `questionId` (evidence-only) gives each question its own tenant: `…-p<persona>-q<id suffix>`. */
export function tenantUserIdFor(chatModel: string, personaId: number, questionId?: string): string {
  const base = `public-bench-personamem-v2-capture-${modelSlug(chatModel)}-p${personaId}`
  return questionId === undefined
    ? base
    : `${base}-q${questionId.slice(questionId.indexOf('-') + 1)}`
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
  if (selection.kind === 'questions') {
    throw new Error('[personamem] --question-ids selects questions, not personas')
  }
  return seededSample(all, selection.count, selection.seed)
}

function plannedQuestion(row: PreparedRow): PlannedQuestion {
  return { row, ...buildOptions(row) }
}

function limitedQueries(persona: PersonaQueries, cli: PersonaMemCli): PreparedRow[] {
  return cli.limitQueries === null ? persona.queries : persona.queries.slice(0, cli.limitQueries)
}

/** --evidence-only: one tenant per question, holding only that question's evidence user turns. */
function planEvidenceOnly(rows: PreparedRow[], cli: PersonaMemCli): PlannedPersona[] {
  const { selection } = cli
  let questions: PreparedRow[]
  if (selection.kind === 'questions') {
    const byId = new Map(rows.map((r) => [r.questionId, r]))
    questions = selection.ids.map((id) => {
      const row = byId.get(id)
      if (!row) throw new Error(`[personamem] question ${id} is not in the dataset`)
      return row
    })
  } else {
    questions = selectPersonas(groupByPersona(rows), cli).flatMap((p) => limitedQueries(p, cli))
  }
  return questions.map((row) => {
    const captures = evidenceToCaptures(row.evidenceTurns)
    return {
      personaId: row.personaId,
      tenantUserId: tenantUserIdFor(cli.chatModel, row.personaId, row.questionId),
      captures,
      referenceTime: new Date(captures[captures.length - 1]!.capturedAt.getTime() + DAY_MS),
      questions: [plannedQuestion(row)],
    }
  })
}

/** Pure and offline: loads prepared data and histories, builds captures and options. */
export function buildPlan(cli: PersonaMemCli): Plan {
  const rows = loadPreparedRows(cli.dataDir)
  const personas = cli.evidenceOnly
    ? planEvidenceOnly(rows, cli)
    : selectPersonas(groupByPersona(rows), cli).map((persona): PlannedPersona => {
        const captures = historyToCaptures(loadHistory(persona.historyPath))
        return {
          personaId: persona.personaId,
          tenantUserId: tenantUserIdFor(cli.chatModel, persona.personaId),
          captures,
          referenceTime: new Date(captures[captures.length - 1]!.capturedAt.getTime() + DAY_MS),
          questions: limitedQueries(persona, cli).map(plannedQuestion),
        }
      })
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
  if (selection.kind === 'questions') return `question ids ${selection.ids.join(',')}`
  return `${selection.count} personas, seed ${JSON.stringify(selection.seed)}`
}

export function formatPlan(plan: Plan, cli: PersonaMemCli): string[] {
  const { totals } = plan
  const evidence = cli.evidenceOnly
  return [
    'PersonaMem-v2 dry run (nothing touched the database or an LLM)',
    ...(evidence ? ['SMOKE (evidence-only) - not a benchmark score'] : []),
    `data dir: ${cli.dataDir}`,
    `chat model: ${cli.chatModel}`,
    `ingest: capture${evidence ? ' (evidence user turns only, one tenant per question)' : ''}`,
    `answer: ${cli.answer}`,
    `selection: ${describeSelection(cli)}`,
    `tenant concurrency: ${cli.tenantConcurrency}, enrich concurrency: ${cli.enrichConcurrency}`,
    `limit queries per persona: ${cli.limitQueries ?? 'none'}`,
    '',
    `${evidence ? 'tenants' : 'personas'}: ${totals.personas}`,
    `${evidence ? 'evidence turns' : 'captures'}: ${totals.captures} (user turns only; ${evidence ? 'assistant turns and the rest of the history excluded' : 'system persona dump and assistant turns excluded'})`,
    `queries: ${totals.queries} (each answered twice: eigen, no-memory)`,
    `estimated USD: $${totals.estimatedUsd.toFixed(3)} (captures x $${USD_PER_CAPTURE} + queries x $${USD_PER_QUERY}${cli.answer === 'ask' ? '; the Ask agent loop answering each query is not included' : ''})`,
    '',
    'tenants:',
    ...plan.personas.map((p) =>
      evidence
        ? `  ${p.tenantUserId}  question=${p.questions[0]!.row.questionId}  evidence turns=${p.captures.length}  estimate=$${estimateUsd(p.captures.length, 1).toFixed(3)}`
        : `  ${p.tenantUserId}  captures=${p.captures.length}  queries=${p.questions.length}`,
    ),
  ]
}
