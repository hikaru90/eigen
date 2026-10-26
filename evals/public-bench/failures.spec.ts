import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunStopped } from '../harness/stop-signal'
import { appendFailure, openFailures, readFailures, runIsolated } from './failures'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'failures-'))
  file = join(dir, 'failures.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('failures.jsonl', () => {
  it('records tenant and question failures with phase, message and time', () => {
    appendFailure(file, { tenant: 't1', phase: 'ingest', error: new Error('boom') })
    appendFailure(file, {
      tenant: 't1',
      questionId: 'p1-aaaaaaaaaaaa',
      phase: 'answer',
      error: 'plain string',
    })
    const rows = readFailures(file)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ tenant: 't1', phase: 'ingest', error: 'boom' })
    expect(rows[0]).not.toHaveProperty('questionId')
    expect(rows[1]).toMatchObject({ questionId: 'p1-aaaaaaaaaaaa', error: 'plain string' })
    expect(Number.isNaN(Date.parse(rows[0]!.at))).toBe(false)
  })

  it('truncates a very long message', () => {
    appendFailure(file, { tenant: 't1', phase: 'ingest', error: new Error('x'.repeat(5000)) })
    expect(readFailures(file)[0]!.error.length).toBeLessThanOrEqual(2000)
  })

  it('openFailures drops failures of tenants / questions that completed afterwards', () => {
    const rows = [
      { at: 'a', tenant: 't1', phase: 'ingest', error: 'e1' },
      { at: 'b', tenant: 't2', questionId: 'q1', phase: 'answer', error: 'e2' },
      { at: 'c', tenant: 't2', questionId: 'q2', phase: 'answer', error: 'e3' },
    ]
    expect(
      openFailures(rows, {
        ingestedTenants: new Set(['t1']),
        answeredQuestionIds: new Set(['q1']),
      }),
    ).toEqual([rows[2]])
    expect(
      openFailures(rows, { ingestedTenants: new Set(), answeredQuestionIds: new Set() }),
    ).toEqual(rows)
  })

  it('openFailures keeps only the latest failure per item', () => {
    const rows = [
      { at: 'a', tenant: 't1', phase: 'ingest', error: 'first' },
      { at: 'b', tenant: 't1', phase: 'ingest', error: 'second' },
    ]
    const open = openFailures(rows, { ingestedTenants: new Set(), answeredQuestionIds: new Set() })
    expect(open).toEqual([rows[1]])
  })
})

describe('runIsolated', () => {
  it('returns the value and records nothing when the work succeeds', async () => {
    const result = await runIsolated(file, { tenant: 't1', phase: 'ingest' }, async () => 42)
    expect(result).toEqual({ ok: true, value: 42 })
    expect(readFailures(file)).toEqual([])
  })

  it('records the failure and returns it instead of throwing', async () => {
    const result = await runIsolated(file, { tenant: 't1', phase: 'ingest' }, async () => {
      throw new Error('tenant exploded')
    })
    expect(result).toMatchObject({ ok: false })
    expect(readFailures(file)).toMatchObject([
      { tenant: 't1', phase: 'ingest', error: 'tenant exploded' },
    ])
  })

  it('a clean stop is not a failure and propagates', async () => {
    await expect(
      runIsolated(file, { tenant: 't1', phase: 'ingest' }, async () => {
        throw new RunStopped()
      }),
    ).rejects.toBeInstanceOf(RunStopped)
    expect(readFailures(file)).toEqual([])
  })
})
