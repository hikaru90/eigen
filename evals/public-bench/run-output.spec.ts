import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendJsonl,
  readJsonl,
  readJsonlIds,
  resolveRunDir,
  writeSummary,
  type RunSummary,
} from './run-output'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'public-bench-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveRunDir', () => {
  it('lays out <root>/<bench>/<runId>', () => {
    expect(resolveRunDir({ bench: 'personamem-v2', runId: 'pilot-1', reportsRoot: root })).toBe(
      join(root, 'personamem-v2', 'pilot-1'),
    )
  })

  it('rejects path-like or empty bench / run ids', () => {
    for (const bad of ['', '  ', '../x', 'a/b', 'a\\b', '.', '..']) {
      expect(() => resolveRunDir({ bench: 'b', runId: bad, reportsRoot: root })).toThrow(/runId/)
      expect(() => resolveRunDir({ bench: bad, runId: 'r', reportsRoot: root })).toThrow(/bench/)
    }
  })
})

describe('appendJsonl / readJsonlIds', () => {
  it('creates parent dirs and appends one line per row', () => {
    const file = join(root, 'nested', 'answers.jsonl')
    appendJsonl(file, { questionId: 'a', n: 1 })
    appendJsonl(file, { questionId: 'b', n: 2 })
    expect(readFileSync(file, 'utf8')).toBe('{"questionId":"a","n":1}\n{"questionId":"b","n":2}\n')
    expect(readJsonl(file)).toEqual([
      { questionId: 'a', n: 1 },
      { questionId: 'b', n: 2 },
    ])
  })

  it('returns the ids already written (resume skips them)', () => {
    const file = join(root, 'answers.jsonl')
    appendJsonl(file, { questionId: 'a' })
    appendJsonl(file, { questionId: 'b' })
    const done = readJsonlIds(file, 'questionId')
    expect([...done].sort()).toEqual(['a', 'b'])
    const todo = ['a', 'b', 'c'].filter((id) => !done.has(id))
    expect(todo).toEqual(['c'])
  })

  it('treats a missing file as nothing done yet', () => {
    expect(readJsonlIds(join(root, 'nope.jsonl'), 'questionId').size).toBe(0)
  })

  it('tolerates a trailing newline, blank lines and CRLF', () => {
    const file = join(root, 'a.jsonl')
    writeFileSync(file, '{"id":"x"}\r\n\n{"id":"y"}\n\n')
    expect([...readJsonlIds(file, 'id')]).toEqual(['x', 'y'])
  })

  it('throws on a corrupt line, naming file and line number', () => {
    const file = join(root, 'bad.jsonl')
    writeFileSync(file, '{"id":"x"}\n{"id":\n')
    expect(() => readJsonlIds(file, 'id')).toThrow(/bad\.jsonl.*line 2/s)
  })

  it('throws when a row has no usable id', () => {
    const file = join(root, 'noid.jsonl')
    writeFileSync(file, '{"id":"x"}\n{"other":1}\n')
    expect(() => readJsonlIds(file, 'id')).toThrow(/noid\.jsonl.*line 2.*id/s)
    writeFileSync(file, '{"id":""}\n')
    expect(() => readJsonlIds(file, 'id')).toThrow(/id/)
  })

  it('throws when a line is valid JSON but not an object', () => {
    const file = join(root, 'arr.jsonl')
    writeFileSync(file, '[1,2]\n')
    expect(() => readJsonl(file)).toThrow(/line 1/)
  })
})

describe('writeSummary', () => {
  const summary: RunSummary = {
    bench: 'personamem-v2',
    runId: 'pilot-1',
    title: 'PersonaMem-v2 pilot',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: '2026-10-25T11:00:00.000Z',
    config: { answerModel: 'openai/gpt-4o-mini', enrichConcurrency: 1 },
    metrics: { n: 6, accuracy: 0.5 },
    sections: [
      {
        heading: 'By pref_type',
        table: {
          columns: ['pref_type', 'n', 'accuracy'],
          rows: [
            ['neutral', 3, '0.667'],
            ['therapy', 3, '0.333'],
          ],
        },
      },
      { heading: 'Context', lines: ['Random: 25%'] },
    ],
  }

  it('writes summary.json and summary.md into the run dir', () => {
    const dir = join(root, 'run')
    writeSummary(dir, summary)
    expect(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))).toEqual(summary)
    const md = readFileSync(join(dir, 'summary.md'), 'utf8')
    expect(md).toContain('# PersonaMem-v2 pilot')
    expect(md).toContain('answerModel')
    expect(md).toContain('openai/gpt-4o-mini')
    expect(md).toContain('## By pref_type')
    expect(md).toContain('| pref_type | n | accuracy |')
    expect(md).toContain('| neutral | 3 | 0.667 |')
    expect(md).toContain('- Random: 25%')
  })

  it('rejects a table row whose width differs from its columns', () => {
    const bad: RunSummary = {
      ...summary,
      sections: [{ heading: 'x', table: { columns: ['a', 'b'], rows: [['only-one']] } }],
    }
    expect(() => writeSummary(join(root, 'run2'), bad)).toThrow(/row/)
  })
})
