import { z } from 'zod'
import { RunStopped } from '../harness/stop-signal'
import { appendJsonl, readJsonl } from './run-output'

/**
 * `failures.jsonl`: every isolated failure of a run. One tenant's ingest or one question's
 * answer failing does not interrupt the others; it is recorded here, reported loudly at the end,
 * makes the process exit non-zero and keeps the summary marked incomplete. `--resume` retries
 * failed and unfinished items only. Not a fallback: nothing is hidden, nothing counts as done.
 */

const MAX_ERROR_CHARS = 2000

const failureRowSchema = z
  .object({
    at: z.string(),
    tenant: z.string().min(1),
    /** Set for a question's failure; absent for a tenant's (ingest) failure. */
    questionId: z.string().min(1).optional(),
    phase: z.string().min(1),
    error: z.string(),
  })
  .strict()
export type FailureRow = z.infer<typeof failureRowSchema>

export function appendFailure(
  path: string,
  failure: { tenant: string; questionId?: string; phase: string; error: unknown },
): void {
  const message = failure.error instanceof Error ? failure.error.message : String(failure.error)
  appendJsonl(
    path,
    failureRowSchema.parse({
      at: new Date().toISOString(),
      tenant: failure.tenant,
      ...(failure.questionId === undefined ? {} : { questionId: failure.questionId }),
      phase: failure.phase,
      error: message.slice(0, MAX_ERROR_CHARS),
    }),
  )
}

export function readFailures(path: string): FailureRow[] {
  return readJsonl(path).map((raw, i) => {
    const parsed = failureRowSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`[public-bench] ${path} row ${i + 1} is invalid: ${parsed.error.message}`)
    }
    return parsed.data
  })
}

/** The latest failure of each item that has not completed since (earlier ones were retried). */
export function openFailures(
  rows: readonly FailureRow[],
  completed: { ingestedTenants: ReadonlySet<string>; answeredQuestionIds: ReadonlySet<string> },
): FailureRow[] {
  const latest = new Map<string, FailureRow>()
  for (const row of rows) {
    latest.set(
      row.questionId === undefined ? `tenant:${row.tenant}` : `question:${row.questionId}`,
      row,
    )
  }
  return [...latest.values()].filter((row) =>
    row.questionId === undefined
      ? !completed.ingestedTenants.has(row.tenant)
      : !completed.answeredQuestionIds.has(row.questionId),
  )
}

/**
 * The error boundary of one tenant or question: a thrown error is recorded in failures.jsonl and
 * returned as `{ ok: false }` so the caller continues with the rest. A clean stop (`RunStopped`)
 * is not a failure and propagates.
 */
export async function runIsolated<T>(
  failuresPath: string,
  scope: { tenant: string; questionId?: string; phase: string },
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    if (error instanceof RunStopped) throw error
    appendFailure(failuresPath, { ...scope, error })
    return { ok: false, error }
  }
}
