import type { PlannedPersona, PlannedQuestion } from './plan'
import { mapWithConcurrency } from '../harness/concurrency'
import { RunStopped, STOP_EXIT_CODE } from '../harness/stop-signal'
import { appendFailure, openFailures, runIsolated, type FailureRow } from '../public-bench/failures'

/**
 * The control flow of a PersonaMem run, separate from the database and the models so its
 * failure and stop behaviour is testable: each tenant (ingest) and each question (answer) runs
 * in its own error boundary - a failure is recorded in failures.jsonl and the run goes on with
 * the rest - and a stop request lets work in flight finish and starts nothing new.
 */
export async function runPersonas(input: {
  personas: readonly PlannedPersona[]
  tenantConcurrency: number
  failuresPath: string
  isAnswered: (questionId: string) => boolean
  isIngested: (tenant: string) => boolean
  /** Ingests (or verifies) the tenant; afterwards `isIngested(tenant)` must be true. */
  ingest: (persona: PlannedPersona) => Promise<void>
  answer: (persona: PlannedPersona, question: PlannedQuestion) => Promise<void>
  stop: { throwIfStopRequested(): void }
  log: (line: string) => void
}): Promise<{ stopped: boolean }> {
  let stopped = false

  const runOne = async (persona: PlannedPersona): Promise<void> => {
    const tenant = persona.tenantUserId
    const pending = persona.questions.filter((q) => !input.isAnswered(q.row.questionId))
    if (pending.length === 0) {
      input.log(`${tenant}: all ${persona.questions.length} question(s) answered, skipping`)
      return
    }
    if (!input.isIngested(tenant)) {
      input.stop.throwIfStopRequested()
      const ingest = await runIsolated(input.failuresPath, { tenant, phase: 'ingest' }, () =>
        input.ingest(persona),
      )
      if (!ingest.ok) {
        input.log(
          `${tenant}: INGEST FAILED, its ${pending.length} question(s) stay open (see failures.jsonl)`,
        )
        return
      }
    }
    for (const question of pending) {
      input.stop.throwIfStopRequested()
      await runIsolated(
        input.failuresPath,
        { tenant, questionId: question.row.questionId, phase: 'answer' },
        () => input.answer(persona, question),
      )
    }
  }

  // Never rejects: a stop is noted and every other tenant's work in flight is awaited.
  await mapWithConcurrency(input.personas, input.tenantConcurrency, async (persona) => {
    try {
      await runOne(persona)
    } catch (error) {
      if (error instanceof RunStopped) {
        stopped = true
        return
      }
      // a bug in the control flow itself: still isolated and recorded, not silently lost
      appendFailure(input.failuresPath, { tenant: persona.tenantUserId, phase: 'run', error })
    }
  })
  return { stopped }
}

export type RunStatus = {
  complete: boolean
  missingQuestions: string[]
  openFailures: FailureRow[]
  exitCode: 0 | 1 | typeof STOP_EXIT_CODE
}

/** Whether the run is complete, what is missing and what the process should exit with. */
export function summarizeRun(input: {
  plannedQuestionIds: readonly string[]
  answeredQuestionIds: ReadonlySet<string>
  ingestedTenants: ReadonlySet<string>
  failures: readonly FailureRow[]
  stopped: boolean
}): RunStatus {
  const missingQuestions = input.plannedQuestionIds.filter(
    (id) => !input.answeredQuestionIds.has(id),
  )
  const open = openFailures(input.failures, {
    ingestedTenants: input.ingestedTenants,
    answeredQuestionIds: input.answeredQuestionIds,
  })
  const complete = missingQuestions.length === 0
  return {
    complete,
    missingQuestions,
    openFailures: open,
    exitCode: input.stopped ? STOP_EXIT_CODE : complete ? 0 : 1,
  }
}
