import { executeEvalRun } from '../../../evals/harness/run-entry'
import { expandQaEntries } from '../../../evals/harness/qa-run'
import { listEvalQa, loadEvalQa, type EvalQaRecord } from './qa-store'
import { createEvalRun, insertEvalEntries, appendEvalEvent } from './store'
import type { EvalEntrySummary } from './types'
import { loadEvalRunDetail } from './store'
import { recoverOrphanedEvalRun } from '../../../evals/harness/stale-recovery'
import { clearEvalRunStopRequest, isEvalRunStopRequested, requestEvalRunStop } from './run-cancel'

let activeRunId: string | null = null

export type EvalRunMode = 'smoke' | 'all' | 'qa'

export function getActiveEvalRunId(): string | null {
  return activeRunId
}

/** Request cooperative stop for the in-process eval runner. Returns false if run is not active here. */
export function stopActiveEvalRun(runId: string): boolean {
  if (activeRunId !== runId) return false
  requestEvalRunStop(runId)
  return true
}

export { clearEvalRunStopRequest, isEvalRunStopRequested }

export { recoverOrphanedEvalRun }

function isQaActive(item: EvalQaRecord): boolean {
  return !item.tags.includes('inactive')
}

function pickSmokeQa(items: EvalQaRecord[]): EvalQaRecord | null {
  if (items.length === 0) return null
  return items.find((q) => q.id === 'qa_smoke_dinner') ?? items[0]!
}

async function launchRun(input: {
  operatorUserId: string
  mode: EvalRunMode
  qas: EvalQaRecord[]
  freshCorpus?: boolean
}): Promise<{ runId: string; entries: EvalEntrySummary[] }> {
  const expanded = expandQaEntries(input.qas)
  const label =
    input.mode === 'qa'
      ? `qa:${input.qas[0]!.id}`
      : input.mode === 'smoke'
        ? `smoke:${input.qas[0]!.id}`
        : `all:${input.qas.length}-questions`

  const { runId } = await createEvalRun({
    operatorUserId: input.operatorUserId,
    label,
    scenarioId:
      input.mode === 'qa' ? input.qas[0]!.id : input.mode === 'smoke' ? input.qas[0]!.id : 'all',
    config: {
      freshCorpus: input.freshCorpus ?? false,
      mode: input.mode,
      qaIds: input.qas.map((q) => q.id),
    },
  })

  await insertEvalEntries(
    input.operatorUserId,
    runId,
    expanded.map((e) => ({
      ordinal: e.ordinal,
      kind: e.kind,
      fixtureRef: e.fixtureRef,
      inputJson: e.inputJson,
      expectedJson: e.expectedJson,
    })),
  )

  activeRunId = runId

  const detail = await loadEvalRunDetail(input.operatorUserId, runId)
  const entries = detail?.entries ?? []

  const scenarioGoal =
    input.mode === 'qa'
      ? `Q&A eval: ${input.qas[0]!.question}`
      : input.mode === 'smoke'
        ? `Smoke test: ${input.qas[0]!.question}`
        : `All questions (${input.qas.length}): ${input.qas.map((q) => q.question).join('; ')}`

  void executeEvalRun({
    operatorUserId: input.operatorUserId,
    runId,
    freshCorpus: input.freshCorpus,
    scenarioGoal,
  })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err)
      await appendEvalEvent({
        operatorUserId: input.operatorUserId,
        runId,
        level: 'error',
        message: `runner error: ${message}`,
      })
    })
    .finally(() => {
      clearEvalRunStopRequest(runId)
      activeRunId = null
    })

  return { runId, entries }
}

export async function startEvalRun(input: {
  operatorUserId: string
  mode: EvalRunMode
  qaId?: string
  freshCorpus?: boolean
}): Promise<{ runId: string; entries: EvalEntrySummary[] }> {
  if (activeRunId) {
    throw new Error('An eval run is already in progress')
  }

  if (input.mode === 'qa') {
    const qaId = input.qaId?.trim()
    if (!qaId) {
      throw new Error('qaId is required when mode is qa')
    }
    const qa = await loadEvalQa(qaId)
    if (!qa) {
      throw new Error(`QA not found: ${qaId}`)
    }
    if (!isQaActive(qa)) {
      throw new Error(`QA is inactive: ${qaId}`)
    }
    return launchRun({
      operatorUserId: input.operatorUserId,
      mode: 'qa',
      qas: [qa],
      freshCorpus: input.freshCorpus,
    })
  }

  const items = (await listEvalQa()).filter(isQaActive)
  if (items.length === 0) {
    throw new Error('No active questions in catalog — activate one under Questions & answers')
  }

  const qas = input.mode === 'smoke' ? [pickSmokeQa(items)!] : items
  return launchRun({ ...input, qas })
}
