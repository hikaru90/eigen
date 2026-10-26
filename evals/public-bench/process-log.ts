import type { PhaseCounters } from '../harness/crash-hook'
import type { IngestCounters } from './ingest-tenant'
import type { EvalLlmCacheStats } from '$lib/server/llm/eval-llm-cache'
import { appendJsonl } from './run-output'

/**
 * `processes.jsonl`: one `start` row when a process begins working on a run and one `end` row
 * when it finishes, stops or fails, with its counters. A process that was killed leaves a
 * `start` without an `end` (and, for the rehearsal, a `crash-hook` row). Reading the `end` rows
 * of the resumes is how the kill rehearsal is judged: what they paid for, what they skipped.
 */

export type ProcessCounters = {
  cache: EvalLlmCacheStats
  calls: PhaseCounters
  ingest: IngestCounters
  answers: {
    /** Questions with final rows before this process started. */
    alreadyComplete: number
    /** Stored answer stages this process reused instead of recomputing. */
    stagesReused: number
    /** Questions this process wrote final rows for. */
    answeredNow: number
  }
}

export type ProcessOutcome = 'complete' | 'incomplete' | 'stopped' | 'failed'

export function appendProcessStart(
  path: string,
  row: { pid: number; mode: 'new' | 'resume'; command: string },
): void {
  appendJsonl(path, { event: 'start', at: new Date().toISOString(), ...row })
}

export function appendProcessEnd(
  path: string,
  row: { pid: number; outcome: ProcessOutcome; counters: ProcessCounters },
): void {
  appendJsonl(path, { event: 'end', at: new Date().toISOString(), ...row })
}

export function appendProcessCrash(
  path: string,
  row: { pid: number; phase: string; n: number; calls: PhaseCounters },
): void {
  appendJsonl(path, { event: 'crash-hook', at: new Date().toISOString(), ...row })
}

const usd = (x: number) => `$${x.toFixed(4)}`

/** The console lines the kill rehearsal is judged by (see evals/personamem/REHEARSAL.md). */
export function formatCounterLines(c: ProcessCounters): string[] {
  const { ingest, answer, other } = c.calls
  return [
    `cache: ${c.cache.hits} hit(s), ${c.cache.misses} paid call(s); paid ${usd(c.cache.usdPaid)}, avoided ${usd(c.cache.usdAvoided)}`,
    `paid calls by phase: ingest ${ingest.paid}, answer ${answer.paid}, other ${other.paid} (cache hits: ingest ${ingest.hits}, answer ${answer.hits}, other ${other.hits})`,
    `ingest resume: ${c.ingest.skipped} capture(s) skipped (already enriched), ${c.ingest.reenriched} re-enriched (queued earlier, not re-queued), ${c.ingest.queued} queued now`,
    `answer resume: ${c.answers.alreadyComplete} question(s) already complete, ${c.answers.stagesReused} stored stage(s) reused, ${c.answers.answeredNow} question(s) answered by this process`,
  ]
}
