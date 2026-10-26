import type { PlannedPersona } from './plan'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunStopped } from '../harness/stop-signal'
import { readFailures, type FailureRow } from '../public-bench/failures'
import { runPersonas, summarizeRun } from './run-orchestrator'

let dir: string
let failuresPath: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orchestrator-'))
  failuresPath = join(dir, 'failures.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const persona = (id: number, questions: string[]): PlannedPersona =>
  ({
    personaId: id,
    tenantUserId: `t${id}`,
    captures: [],
    referenceTime: new Date(0),
    questions: questions.map((q) => ({ row: { questionId: q } })),
  }) as unknown as PlannedPersona

const personas = [persona(1, ['q1a', 'q1b']), persona(2, ['q2a', 'q2b'])]

function harness(overrides: Partial<Parameters<typeof runPersonas>[0]> = {}) {
  const ingested = new Set<string>()
  const answered = new Set<string>()
  const calls: string[] = []
  const input: Parameters<typeof runPersonas>[0] = {
    personas,
    tenantConcurrency: 2,
    failuresPath,
    isAnswered: (id) => answered.has(id),
    isIngested: (tenant) => ingested.has(tenant),
    ingest: vi.fn(async (p: PlannedPersona) => {
      calls.push(`ingest:${p.tenantUserId}`)
      ingested.add(p.tenantUserId)
    }),
    answer: vi.fn(async (_p: PlannedPersona, q) => {
      calls.push(`answer:${q.row.questionId}`)
      answered.add(q.row.questionId)
    }),
    stop: { throwIfStopRequested: () => {} },
    log: () => {},
    ...overrides,
  }
  return { input, calls, answered, ingested }
}

describe('runPersonas', () => {
  it('ingests every tenant and answers every question', async () => {
    const h = harness()
    const result = await runPersonas(h.input)
    expect(result).toEqual({ stopped: false })
    expect([...h.answered].sort()).toEqual(['q1a', 'q1b', 'q2a', 'q2b'])
    expect(readFailures(failuresPath)).toEqual([])
  })

  it('one tenant failing to ingest does not stop the others; it is recorded and its questions stay open', async () => {
    const h = harness()
    vi.mocked(h.input.ingest).mockImplementation(async (p) => {
      if (p.tenantUserId === 't1') throw new Error('tenant 1 exploded')
      h.ingested.add(p.tenantUserId)
    })
    const result = await runPersonas(h.input)

    expect(result).toEqual({ stopped: false })
    expect([...h.answered].sort()).toEqual(['q2a', 'q2b'])
    expect(readFailures(failuresPath)).toMatchObject([
      { tenant: 't1', phase: 'ingest', error: 'tenant 1 exploded' },
    ])
    expect(readFailures(failuresPath)[0]).not.toHaveProperty('questionId')
  })

  it('one question failing does not stop the rest of its tenant or the other tenants', async () => {
    const h = harness()
    vi.mocked(h.input.answer).mockImplementation(async (_p, q) => {
      if (q.row.questionId === 'q1a') throw new Error('question exploded')
      h.answered.add(q.row.questionId)
    })
    await runPersonas(h.input)

    expect([...h.answered].sort()).toEqual(['q1b', 'q2a', 'q2b'])
    expect(readFailures(failuresPath)).toMatchObject([
      { tenant: 't1', questionId: 'q1a', phase: 'answer', error: 'question exploded' },
    ])
  })

  it('skips answered questions, and a tenant with nothing left is not ingested', async () => {
    const h = harness()
    h.answered.add('q1a')
    h.answered.add('q1b')
    await runPersonas(h.input)
    expect(h.input.ingest).toHaveBeenCalledTimes(1)
    expect(h.calls.filter((c) => c.startsWith('ingest:'))).toEqual(['ingest:t2'])
  })

  it('does not ingest a tenant that is already ingested', async () => {
    const h = harness()
    h.ingested.add('t1')
    await runPersonas(h.input)
    expect(h.calls).not.toContain('ingest:t1')
    expect(h.answered.has('q1a')).toBe(true)
  })

  it('a stop request starts no new question, lets the one in flight finish and reports stopped', async () => {
    let stop = false
    const h = harness({
      tenantConcurrency: 1,
      stop: {
        throwIfStopRequested: () => {
          if (stop) throw new RunStopped()
        },
      },
    })
    vi.mocked(h.input.answer).mockImplementation(async (_p, q) => {
      h.answered.add(q.row.questionId)
      stop = true // the signal arrives while q1a is being answered
    })
    const result = await runPersonas(h.input)

    expect(result).toEqual({ stopped: true })
    expect([...h.answered]).toEqual(['q1a'])
    expect(readFailures(failuresPath)).toEqual([])
  })

  it("a stop in one tenant waits for the other tenants' calls in flight", async () => {
    let stop = false
    const h = harness({
      stop: {
        throwIfStopRequested: () => {
          if (stop) throw new RunStopped()
        },
      },
    })
    let finished = false
    vi.mocked(h.input.ingest).mockImplementation(async (p) => {
      if (p.tenantUserId === 't2') {
        await new Promise((r) => setTimeout(r, 20))
        finished = true
      } else {
        await Promise.resolve()
        stop = true // the signal arrives while tenant 2's ingest is still running
      }
      h.ingested.add(p.tenantUserId)
    })
    const result = await runPersonas(h.input)
    expect(result).toEqual({ stopped: true })
    expect(finished).toBe(true)
    expect(h.answered.size).toBe(0)
  })
})

describe('summarizeRun', () => {
  const failure = (over: Partial<FailureRow> = {}): FailureRow => ({
    at: 'x',
    tenant: 't1',
    phase: 'ingest',
    error: 'boom',
    ...over,
  })

  it('is complete (exit 0) when every planned question is answered', () => {
    const status = summarizeRun({
      plannedQuestionIds: ['a', 'b'],
      answeredQuestionIds: new Set(['a', 'b']),
      ingestedTenants: new Set(['t1']),
      failures: [failure()], // an earlier failure that was retried and succeeded
      stopped: false,
    })
    expect(status).toMatchObject({
      complete: true,
      exitCode: 0,
      missingQuestions: [],
      openFailures: [],
    })
  })

  it('is incomplete (exit 1) with open failures and missing questions listed', () => {
    const status = summarizeRun({
      plannedQuestionIds: ['a', 'b', 'c'],
      answeredQuestionIds: new Set(['a']),
      ingestedTenants: new Set(),
      failures: [failure(), failure({ questionId: 'b', phase: 'answer', error: 'bad' })],
      stopped: false,
    })
    expect(status.complete).toBe(false)
    expect(status.exitCode).toBe(1)
    expect(status.missingQuestions).toEqual(['b', 'c'])
    expect(status.openFailures).toHaveLength(2)
  })

  it('a stopped run exits 130, complete or not', () => {
    expect(
      summarizeRun({
        plannedQuestionIds: ['a'],
        answeredQuestionIds: new Set(),
        ingestedTenants: new Set(),
        failures: [],
        stopped: true,
      }),
    ).toMatchObject({ complete: false, exitCode: 130 })
  })

  it('missing questions without any recorded failure still make the run incomplete', () => {
    expect(
      summarizeRun({
        plannedQuestionIds: ['a'],
        answeredQuestionIds: new Set(),
        ingestedTenants: new Set(),
        failures: [],
        stopped: false,
      }),
    ).toMatchObject({ complete: false, exitCode: 1 })
  })
})
