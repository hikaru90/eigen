import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendEnriched, appendQueued, loadIngestProgress } from './ingest-progress'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ingest-progress-'))
  file = join(dir, 'ingest-progress.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ingest-progress.jsonl', () => {
  it('a missing file is no progress', () => {
    expect(loadIngestProgress(file).size).toBe(0)
  })

  it('records queued then enriched per capture and reads them back per tenant', () => {
    appendQueued(file, { tenant: 't1', index: 0, thoughtId: 'a' })
    appendQueued(file, { tenant: 't1', index: 1, thoughtId: 'b' })
    appendQueued(file, { tenant: 't2', index: 0, thoughtId: 'x' })
    appendEnriched(file, { tenant: 't1', index: 0, thoughtIds: ['a', 'a-child'] })

    const progress = loadIngestProgress(file)
    expect(progress.get('t1')).toEqual({
      queued: ['a', 'b'],
      enriched: new Map([[0, ['a', 'a-child']]]),
    })
    expect(progress.get('t2')).toEqual({ queued: ['x'], enriched: new Map() })
  })

  it('rows are the documented shape', () => {
    appendQueued(file, { tenant: 't1', index: 0, thoughtId: 'a' })
    appendEnriched(file, { tenant: 't1', index: 0, thoughtIds: ['a'] })
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line: string) => JSON.parse(line))
    expect(lines[0]).toMatchObject({ type: 'queued', tenant: 't1', index: 0, thoughtId: 'a' })
    expect(lines[1]).toMatchObject({ type: 'enriched', tenant: 't1', index: 0, thoughtIds: ['a'] })
    expect(typeof lines[0].at).toBe('string')
  })

  it.each([
    [
      'a queued index that skips ahead',
      [{ type: 'queued', tenant: 't', index: 1, thoughtId: 'a' }],
    ],
    [
      'a queued index repeated',
      [
        { type: 'queued', tenant: 't', index: 0, thoughtId: 'a' },
        { type: 'queued', tenant: 't', index: 0, thoughtId: 'b' },
      ],
    ],
    ['enriched before queued', [{ type: 'enriched', tenant: 't', index: 0, thoughtIds: ['a'] }]],
    [
      'enriched twice',
      [
        { type: 'queued', tenant: 't', index: 0, thoughtId: 'a' },
        { type: 'enriched', tenant: 't', index: 0, thoughtIds: ['a'] },
        { type: 'enriched', tenant: 't', index: 0, thoughtIds: ['a'] },
      ],
    ],
    [
      'an enriched family that does not start with the queued thought',
      [
        { type: 'queued', tenant: 't', index: 0, thoughtId: 'a' },
        { type: 'enriched', tenant: 't', index: 0, thoughtIds: ['other'] },
      ],
    ],
    [
      'a queued thought id used twice in a tenant',
      [
        { type: 'queued', tenant: 't', index: 0, thoughtId: 'a' },
        { type: 'queued', tenant: 't', index: 1, thoughtId: 'a' },
      ],
    ],
    ['an unknown row type', [{ type: 'weird', tenant: 't' }]],
  ])('fails loud on %s', (_name, rows) => {
    writeFileSync(file, rows.map((r) => `${JSON.stringify({ at: 'x', ...r })}\n`).join(''))
    expect(() => loadIngestProgress(file)).toThrow(/ingest-progress\.jsonl|damaged|invalid/)
  })
})
