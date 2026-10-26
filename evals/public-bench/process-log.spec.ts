import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendProcessCrash,
  appendProcessEnd,
  appendProcessStart,
  formatCounterLines,
  type ProcessCounters,
} from './process-log'
import { readJsonl } from './run-output'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'process-log-'))
  file = join(dir, 'processes.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const counters: ProcessCounters = {
  cache: { hits: 300, misses: 12, usdPaid: 0.051, usdAvoided: 0.43 },
  calls: {
    ingest: { paid: 7, hits: 250 },
    answer: { paid: 5, hits: 50 },
    other: { paid: 0, hits: 0 },
  },
  ingest: { skipped: 2, reenriched: 1, queued: 12 },
  answers: { alreadyComplete: 3, stagesReused: 4, answeredNow: 2 },
}

describe('processes.jsonl', () => {
  it('a start row, then an end row with the outcome and counters; a kill leaves only the start row', () => {
    appendProcessStart(file, {
      pid: 11,
      mode: 'resume',
      command: 'npm run eval:personamem -- --resume --run-id r1',
    })
    appendProcessEnd(file, { pid: 11, outcome: 'complete', counters })
    appendProcessStart(file, { pid: 12, mode: 'new', command: 'x' })
    const rows = readJsonl(file)
    expect(rows.map((r) => r.event)).toEqual(['start', 'end', 'start'])
    expect(rows[0]).toMatchObject({ pid: 11, mode: 'resume' })
    expect(rows[1]).toMatchObject({ pid: 11, outcome: 'complete', counters })
  })

  it('records the crash hook firing, with the counters at that moment', () => {
    appendProcessCrash(file, { pid: 13, phase: 'ingest', n: 15, calls: counters.calls })
    expect(readJsonl(file)[0]).toMatchObject({ event: 'crash-hook', phase: 'ingest', n: 15 })
  })
})

describe('formatCounterLines', () => {
  it('prints the cache totals, paid calls by phase and what the resume skipped', () => {
    expect(formatCounterLines(counters)).toEqual([
      'cache: 300 hit(s), 12 paid call(s); paid $0.0510, avoided $0.4300',
      'paid calls by phase: ingest 7, answer 5, other 0 (cache hits: ingest 250, answer 50, other 0)',
      'ingest resume: 2 capture(s) skipped (already enriched), 1 re-enriched (queued earlier, not re-queued), 12 queued now',
      'answer resume: 3 question(s) already complete, 4 stored stage(s) reused, 2 question(s) answered by this process',
    ])
  })
})
