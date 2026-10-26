import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendJsonl,
  appendJsonlRows,
  writeFileAtomic,
  removeJsonlRows,
  readJsonl,
  readJsonlIds,
  resolveRunDir,
  writeSummary,
  type RunSummary,
} from './run-output'

const fsyncSpy = vi.hoisted(() => vi.fn())
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      fsyncSpy(fd)
      actual.fsyncSync(fd)
    },
  }
})

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

describe('removeJsonlRows', () => {
  it('drops matching rows, keeps the rest in order, and is a no-op for a missing file', () => {
    const path = join(root, 'turns.jsonl')
    removeJsonlRows(path, () => true)
    appendJsonl(path, { personaId: 1, n: 0 })
    appendJsonl(path, { personaId: 2, n: 0 })
    appendJsonl(path, { personaId: 1, n: 1 })
    removeJsonlRows(path, (row) => row.personaId === 1)
    expect(readJsonl(path)).toEqual([{ personaId: 2, n: 0 }])
  })
})

describe('crash-safe appends', () => {
  it('fsyncs every appended record', () => {
    const file = join(root, 'a.jsonl')
    fsyncSpy.mockClear()
    appendJsonl(file, { id: 'a' })
    const afterFirst = fsyncSpy.mock.calls.length
    expect(afterFirst).toBeGreaterThanOrEqual(1)
    appendJsonl(file, { id: 'b' })
    expect(fsyncSpy.mock.calls.length).toBeGreaterThan(afterFirst)
  })

  it('appendJsonlRows writes several records in one fsynced write', () => {
    const file = join(root, 'pairs.jsonl')
    fsyncSpy.mockClear()
    appendJsonlRows(file, [{ id: 'a', v: 'eigen' }, { id: 'a', v: 'no-memory' }])
    expect(readJsonl(file)).toEqual([
      { id: 'a', v: 'eigen' },
      { id: 'a', v: 'no-memory' },
    ])
    expect(fsyncSpy.mock.calls.length).toBeLessThanOrEqual(2) // the file (and its directory when created)
  })

  it('moves a torn last line (no newline, unparseable) to <file>.torn-<timestamp> and keeps the rest', () => {
    const file = join(root, 'answers.jsonl')
    writeFileSync(file, '{"id":"a"}\n{"id":"b"}\n{"id":"c","tex')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(readJsonl(file)).toEqual([{ id: 'a' }, { id: 'b' }])

    const torn = readdirSync(root).filter((name) => name.startsWith('answers.jsonl.torn-'))
    expect(torn).toHaveLength(1)
    expect(readFileSync(join(root, torn[0]!), 'utf8')).toBe('{"id":"c","tex')
    expect(readFileSync(file, 'utf8')).toBe('{"id":"a"}\n{"id":"b"}\n')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('torn last line'))
    // the next append starts on a clean line
    appendJsonl(file, { id: 'c' })
    expect(readJsonl(file)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    warn.mockRestore()
  })

  it('a complete last record that lost only its newline is kept and the newline restored', () => {
    const file = join(root, 'answers.jsonl')
    writeFileSync(file, '{"id":"a"}\n{"id":"b"}')
    expect(readJsonl(file)).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(readFileSync(file, 'utf8')).toBe('{"id":"a"}\n{"id":"b"}\n')
    appendJsonl(file, { id: 'c' })
    expect(readJsonl(file)).toHaveLength(3)
  })

  it('an unparseable last line WITH a trailing newline is corruption, not a torn write', () => {
    const file = join(root, 'answers.jsonl')
    writeFileSync(file, '{"id":"a"}\n{"id":\n')
    expect(() => readJsonl(file)).toThrow(/line 2/)
    expect(readdirSync(root).filter((name) => name.includes('.torn-'))).toEqual([])
  })

  it('a bad line in the middle still fails loud even when the last line is torn', () => {
    const file = join(root, 'answers.jsonl')
    writeFileSync(file, '{"id":"a"}\n{"bad\n{"id":"c","t')
    expect(() => readJsonl(file)).toThrow(/line 2/)
  })

  it('readJsonlIds recovers a torn last line the same way', () => {
    const file = join(root, 'answers.jsonl')
    writeFileSync(file, '{"id":"a"}\n{"id":"b","t')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect([...readJsonlIds(file, 'id')]).toEqual(['a'])
    warn.mockRestore()
  })
})

describe('writeFileAtomic', () => {
  it('writes the full content through a temp file that is renamed into place', () => {
    const file = join(root, 'dir', 'run.json')
    writeFileAtomic(file, '{"a":1}\n')
    writeFileAtomic(file, '{"a":2}\n')
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}\n')
    expect(readdirSync(join(root, 'dir'))).toEqual(['run.json'])
    expect(existsSync(join(root, 'dir', 'run.json'))).toBe(true)
  })
})
