import type { PersonaMemCli, PersonaSelection } from './cli'
import type { PreparedRow, Split } from './types'
import { existsSync } from 'node:fs'
import { modelSlug } from '../public-bench/model-slug'
import { seededSample } from '../public-bench/seeded'
import { loadDevSet } from './dev-set'
import {
  alignEvidenceToCaptures,
  EvidenceNotInHistoryError,
  PREF_TYPES_WITHOUT_HISTORY_EVIDENCE,
} from './evidence-alignment'
import {
  DAY_MS,
  evidenceToCaptures,
  historyToCaptures,
  type CaptureItem,
} from './history-to-captures'
import { groupByPersona, loadHistory, loadPreparedRows, type PersonaQueries } from './load-dataset'
import { buildOptions, type McqOptions } from './mcq'
import { selectValPersonas } from './val-personas'

const USD_PER_CAPTURE = 0.0015
const USD_PER_QUERY = 0.008

/**
 * Which stored items are this question's evidence. `aligned`: the history captures (indexes into
 * the persona's `captures`) its evidence turns are quoted from. `not-in-history`: a pref_type
 * whose evidence the dataset does not put in the history. `evidence-only`: the tenant holds
 * nothing but the evidence, so every stored item is evidence.
 */
export type QuestionEvidence =
  | { kind: 'aligned'; captureIndexes: number[] }
  | { kind: 'not-in-history' }
  | { kind: 'evidence-only' }

export type PlannedQuestion = McqOptions & { row: PreparedRow; evidence: QuestionEvidence }

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
  /** Full-history runs: how the questions' evidence maps onto the history. null for --evidence-only. */
  alignment: {
    questions: number
    aligned: number
    notInHistory: number
    /** Distinct history captures that are evidence of at least one question. */
    evidenceCaptures: number
  } | null
}

/**
 * `questionId` (evidence-only) gives each question its own tenant: `…-p<persona>-q<id suffix>`.
 * `val` tenants carry `-val` because persona 78 is in both splits; benchmark tenants keep the
 * ids of earlier runs.
 */
export function tenantUserIdFor(
  chatModel: string,
  split: Split,
  personaId: number,
  questionId?: string,
): string {
  const splitPart = split === 'val' ? '-val' : ''
  const base = `public-bench-personamem-v2-capture-${modelSlug(chatModel)}${splitPart}-p${personaId}`
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
  if (selection.kind === 'questions' || selection.kind === 'devSet') {
    throw new Error('[personamem] --question-ids and --dev-set select questions, not personas')
  }
  if (cli.split === 'val') {
    // tuning never replays a reported persona: a val sample excludes the benchmark personas
    const benchmark = new Set(loadPreparedRows(cli.dataDir, 'benchmark').map((r) => r.personaId))
    return selectValPersonas(all, benchmark, selection.count, selection.seed)
  }
  return seededSample(all, selection.count, selection.seed)
}

function plannedQuestion(row: PreparedRow, evidence: QuestionEvidence): PlannedQuestion {
  return { row, ...buildOptions(row), evidence }
}

function limitedQueries(persona: PersonaQueries, cli: PersonaMemCli): PreparedRow[] {
  return cli.limitQueries === null ? persona.queries : persona.queries.slice(0, cli.limitQueries)
}

function questionIdsOf(
  selection: Extract<PersonaSelection, { kind: 'questions' | 'devSet' }>,
  split: Split,
): string[] {
  if (selection.kind === 'questions') return selection.ids
  const devSet = loadDevSet(selection.path)
  if (devSet.split !== split) {
    throw new Error(
      `[personamem] dev set ${selection.path} was made for the ${devSet.split} split, this run says --split ${split}`,
    )
  }
  return devSet.questionIds
}

/** Full-history mode needs the history files; `val` ships without them until downloaded. */
function assertHistoriesPresent(personas: PersonaQueries[], cli: PersonaMemCli): void {
  if (cli.split !== 'val') return
  const missing = personas.filter((p) => !existsSync(p.historyPath))
  if (missing.length === 0) return
  const ids = missing.map((p) => p.personaId).join(',')
  throw new Error(
    `[personamem] val histories not downloaded: ${missing.length} of ${personas.length} history file(s) are missing, e.g. ${missing[0]!.historyPath}. ` +
      `Full-history runs on val need them: python3 -I evals/personamem/prepare.py --data-dir ${cli.dataDir} --split val --print-history-urls --persona-ids ${ids} lists the URLs of just these personas; --evidence-only runs do not need them.`,
  )
}

/** --evidence-only: one tenant per question, holding only that question's evidence user turns. */
function planEvidenceOnly(rows: PreparedRow[], cli: PersonaMemCli): PlannedPersona[] {
  const { selection } = cli
  let questions: PreparedRow[]
  if (selection.kind === 'questions' || selection.kind === 'devSet') {
    const byId = new Map(rows.map((r) => [r.questionId, r]))
    questions = questionIdsOf(selection, cli.split).map((id) => {
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
      tenantUserId: tenantUserIdFor(cli.chatModel, cli.split, row.personaId, row.questionId),
      captures,
      referenceTime: new Date(captures[captures.length - 1]!.capturedAt.getTime() + DAY_MS),
      questions: [plannedQuestion(row, { kind: 'evidence-only' })],
    }
  })
}

/** One tenant per persona holding the whole history, then every (limited) query of that persona. */
function planFullHistory(rows: PreparedRow[], cli: PersonaMemCli): PlannedPersona[] {
  const selected = selectPersonas(groupByPersona(rows), cli)
  assertHistoriesPresent(selected, cli)
  const unaligned: string[] = []
  const personas = selected.map((persona): PlannedPersona => {
    const captures = historyToCaptures(loadHistory(persona.historyPath))
    const questions = limitedQueries(persona, cli).flatMap((row) => {
      try {
        const captureIndexes = alignEvidenceToCaptures(captures, row.evidenceTurns, row)
        return [
          plannedQuestion(
            row,
            captureIndexes === null
              ? { kind: 'not-in-history' }
              : { kind: 'aligned', captureIndexes },
          ),
        ]
      } catch (err) {
        if (!(err instanceof EvidenceNotInHistoryError)) throw err
        unaligned.push(err.message)
        return []
      }
    })
    return {
      personaId: persona.personaId,
      tenantUserId: tenantUserIdFor(cli.chatModel, cli.split, persona.personaId),
      captures,
      referenceTime: new Date(captures[captures.length - 1]!.capturedAt.getTime() + DAY_MS),
      questions,
    }
  })
  if (unaligned.length > 0) {
    const shown = unaligned.slice(0, 10)
    throw new Error(
      `[personamem] ${unaligned.length} question(s) have evidence that is not in their history:\n  ${shown.join('\n  ')}` +
        (unaligned.length > shown.length
          ? `\n  ... and ${unaligned.length - shown.length} more`
          : ''),
    )
  }
  return personas
}

function alignmentTotals(personas: readonly PlannedPersona[]): Plan['alignment'] {
  let questions = 0
  let notInHistory = 0
  const evidenceCaptures = new Set<string>()
  for (const persona of personas) {
    for (const question of persona.questions) {
      questions++
      if (question.evidence.kind === 'not-in-history') notInHistory++
      if (question.evidence.kind === 'aligned') {
        for (const i of question.evidence.captureIndexes) {
          evidenceCaptures.add(`${persona.tenantUserId}#${i}`)
        }
      }
    }
  }
  return {
    questions,
    aligned: questions - notInHistory,
    notInHistory,
    evidenceCaptures: evidenceCaptures.size,
  }
}

/** Pure and offline: loads prepared data and histories, builds captures and options. */
export function buildPlan(cli: PersonaMemCli): Plan {
  const rows = loadPreparedRows(cli.dataDir, cli.split)
  const personas = cli.evidenceOnly ? planEvidenceOnly(rows, cli) : planFullHistory(rows, cli)
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
    alignment: cli.evidenceOnly ? null : alignmentTotals(personas),
  }
}

function describeSelection(cli: PersonaMemCli): string {
  const { selection } = cli
  if (selection.kind === 'all') return 'all personas'
  if (selection.kind === 'ids') return `persona ids ${selection.ids.join(',')}`
  if (selection.kind === 'questions') return `question ids ${selection.ids.join(',')}`
  if (selection.kind === 'devSet') return `dev set ${selection.path}`
  return `${selection.count} personas, seed ${JSON.stringify(selection.seed)}`
}

export function formatPlan(plan: Plan, cli: PersonaMemCli): string[] {
  const { totals } = plan
  const evidence = cli.evidenceOnly
  return [
    'PersonaMem-v2 dry run (nothing touched the database or an LLM)',
    ...(evidence ? ['SMOKE (evidence-only) - not a benchmark score'] : []),
    `data dir: ${cli.dataDir}`,
    `split: ${cli.split}${cli.split === 'val' ? ' (tuning data, not a reported score)' : ''}`,
    `chat model: ${cli.chatModel}`,
    `ingest: capture${evidence ? ' (evidence user turns only, one tenant per question)' : ''}`,
    `answer: ${cli.answer}`,
    `selection: ${describeSelection(cli)}`,
    `tenant concurrency: ${cli.tenantConcurrency}, enrich concurrency: ${cli.enrichConcurrency}`,
    `relevance floor: ${cli.relevanceFloor === 'product' ? 'product (the constant real users get)' : `${cli.relevanceFloor} (eval-only override of the product floor)`}`,
    `ingest source: ${cli.reuseIngest === null ? 'this run ingests the tenants' : `run ${cli.reuseIngest} (--reuse-ingest; nothing is ingested)`}`,
    `limit queries per persona: ${cli.limitQueries ?? 'none'}`,
    '',
    `${evidence ? 'tenants' : 'personas'}: ${totals.personas}`,
    `${evidence ? 'evidence turns' : 'captures'}: ${totals.captures} (user turns only; ${evidence ? 'assistant turns and the rest of the history excluded' : 'system persona dump and assistant turns excluded'})`,
    `queries: ${totals.queries} (each answered twice: eigen, no-memory)`,
    ...(plan.alignment === null
      ? []
      : [
          `evidence alignment: ${plan.alignment.aligned} of ${plan.alignment.questions} question(s) aligned to ${plan.alignment.evidenceCaptures} history capture(s) by exact text` +
            (plan.alignment.notInHistory > 0
              ? `; ${plan.alignment.notInHistory} question(s) without history evidence (${PREF_TYPES_WITHOUT_HISTORY_EVIDENCE.join(', ')}), scored for accuracy and left out of evidence-hit - the dataset keeps that evidence out of the history`
              : ''),
        ]),
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
