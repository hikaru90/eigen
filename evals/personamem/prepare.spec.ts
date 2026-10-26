import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURE_EVIDENCE, FIXTURE_ROWS, writeFixtureDataDir, type CsvRow } from './test-fixtures'

const PREPARE_PY = resolve(import.meta.dirname, 'prepare.py')

function runPrepare(dataDir: string, extra: string[] = [], split = 'benchmark') {
  return spawnSync(
    'python3',
    ['-I', PREPARE_PY, '--data-dir', dataDir, '--split', split, ...extra],
    {
      encoding: 'utf8',
    },
  )
}

function readPrepared(dataDir: string, split = 'benchmark'): Record<string, unknown>[] {
  return readFileSync(join(dataDir, `personamem.${split}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function withRow(index: number, patch: Partial<CsvRow>): CsvRow[] {
  return FIXTURE_ROWS.map((r, i) => (i === index ? { ...r, ...patch } : r))
}

describe('prepare.py', () => {
  it('parses the Python-repr user_query and writes one clean row per CSV row', () => {
    const dir = writeFixtureDataDir()
    const res = runPrepare(dir)
    expect(res.status, res.stderr).toBe(0)

    const rows = readPrepared(dir)
    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({
      personaId: 7,
      query: 'Suggest a drink for tonight.',
      correctAnswer: 'A calming cup of green tea suits your evenings.',
      prefType: 'neutral',
      who: 'self',
      updated: false,
      prevPref: null,
      distance32k: 4000,
    })
    expect(rows[0]!.incorrectAnswers).toHaveLength(3)
    expect(rows[0]!.historyPath).toBe(
      join(dir, 'data/chat_history_32k/chat_history_fixture_persona7.json'),
    )
    expect(rows[1]!.query).toBe("What's a snack that fits me?")
    expect(rows[2]!.query).toBe('Plan my "garden" week.\nKeep it short, don\'t overdo it.')
    expect(rows[3]).toMatchObject({
      personaId: 9,
      updated: true,
      prevPref: 'Rides a road bike to work',
    })
  })

  it('keeps preference and the evidence turns (all roles, snippet order)', () => {
    const dir = writeFixtureDataDir()
    expect(runPrepare(dir).status).toBe(0)
    expect(readPrepared(dir)[0]).toMatchObject({
      preference: 'Prefers calm evenings',
      evidenceTurns: FIXTURE_EVIDENCE.tea,
    })
  })

  it.each([
    ['not JSON', 'not json'],
    ['not a list of turns', JSON.stringify({ role: 'user' })],
    ['empty', '[]'],
    ['turn without content', JSON.stringify([{ role: 'user' }])],
    ['no user turn', JSON.stringify([{ role: 'assistant', content: 'x' }])],
  ])('refuses a related_conversation_snippet that is %s', (_label, snippet) => {
    const dir = writeFixtureDataDir({ rows: withRow(1, { related_conversation_snippet: snippet }) })
    const res = runPrepare(dir)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/row 2/)
    expect(res.stderr).toMatch(/related_conversation_snippet/)
  })

  it('refuses an empty preference', () => {
    const dir = writeFixtureDataDir({ rows: withRow(0, { preference: ' ' }) })
    const res = runPrepare(dir)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/preference/)
  })

  it('derives questionId as p<personaId>-<first 12 hex of sha256(query)>', () => {
    const dir = writeFixtureDataDir()
    expect(runPrepare(dir).status).toBe(0)
    const ids = readPrepared(dir).map((r) => r.questionId as string)
    expect(ids[0]).toMatch(/^p7-[0-9a-f]{12}$/)
    expect(ids[3]).toMatch(/^p9-[0-9a-f]{12}$/)
    expect(new Set(ids).size).toBe(6)
  })

  it('refuses a user_query that is not a Python dict repr', () => {
    const dir = writeFixtureDataDir({ rows: withRow(1, { user_query: 'just a plain string' }) })
    const res = runPrepare(dir)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/row 2/)
    expect(res.stderr).toMatch(/user_query/)
    expect(existsSync(join(dir, 'personamem.benchmark.jsonl'))).toBe(false)
  })

  it('refuses a row whose incorrect_answers is not exactly three strings', () => {
    const dir = writeFixtureDataDir({
      rows: withRow(4, { incorrect_answers: JSON.stringify(['one', 'two']) }),
    })
    const res = runPrepare(dir)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/row 5/)
    expect(res.stderr).toMatch(/incorrect_answers/)
  })

  it('refuses a correct answer that also appears among the incorrect ones', () => {
    const dir = writeFixtureDataDir({
      rows: withRow(0, {
        incorrect_answers: JSON.stringify([
          'x',
          'y',
          'A calming cup of green tea suits your evenings.',
        ]),
      }),
    })
    const res = runPrepare(dir)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/incorrect_answers/)
  })

  it('fails naming a history file that is missing locally', () => {
    const dir = writeFixtureDataDir({ skipHistoryFor: 'persona9' })
    const res = runPrepare(dir)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('chat_history_fixture_persona9.json')
  })

  it('--print-history-urls lists each distinct history once as a HF resolve URL, without needing the files', () => {
    const dir = writeFixtureDataDir({ skipHistoryFor: 'persona9' })
    const res = runPrepare(dir, ['--print-history-urls'])
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout.trim().split('\n')).toEqual([
      'https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2/resolve/main/data/chat_history_32k/chat_history_fixture_persona7.json',
      'https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2/resolve/main/data/chat_history_32k/chat_history_fixture_persona9.json',
    ])
  })

  it('--print-history-urls --persona-ids lists only those personas, in the order given', () => {
    const dir = writeFixtureDataDir({ skipHistoryFor: 'all' })
    const res = runPrepare(dir, ['--print-history-urls', '--persona-ids', '9'])
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout.trim().split('\n')).toEqual([
      'https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2/resolve/main/data/chat_history_32k/chat_history_fixture_persona9.json',
    ])
    const both = runPrepare(dir, ['--print-history-urls', '--persona-ids', '9,7'])
    expect(both.stdout.trim().split('\n')).toEqual([
      expect.stringContaining('persona9.json'),
      expect.stringContaining('persona7.json'),
    ])
  })

  it('--persona-ids fails loud on an id the split does not have, a bad list, or without --print-history-urls', () => {
    const dir = writeFixtureDataDir()
    const unknown = runPrepare(dir, ['--print-history-urls', '--persona-ids', '7,8'])
    expect(unknown.status).not.toBe(0)
    expect(unknown.stderr).toMatch(/persona 8/)
    const bad = runPrepare(dir, ['--print-history-urls', '--persona-ids', '7,x'])
    expect(bad.status).not.toBe(0)
    expect(bad.stderr).toMatch(/--persona-ids/)
    const alone = runPrepare(dir, ['--persona-ids', '7'])
    expect(alone.status).not.toBe(0)
    expect(alone.stderr).toMatch(/--print-history-urls/)
  })

  it('fails without --data-dir', () => {
    const res = spawnSync('python3', ['-I', PREPARE_PY, '--split', 'benchmark'], {
      encoding: 'utf8',
    })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/--data-dir/)
  })

  describe('--split', () => {
    it('is required, with no default', () => {
      const dir = writeFixtureDataDir()
      const res = spawnSync('python3', ['-I', PREPARE_PY, '--data-dir', dir], { encoding: 'utf8' })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toMatch(/--split/)
      expect(existsSync(join(dir, 'personamem.benchmark.jsonl'))).toBe(false)
    })

    it('accepts only benchmark or val', () => {
      const dir = writeFixtureDataDir()
      const res = runPrepare(dir, [], 'test')
      expect(res.status).not.toBe(0)
      expect(res.stderr).toMatch(/--split/)
      expect(res.stderr).toMatch(/benchmark/)
      expect(res.stderr).toMatch(/val/)
    })

    it('benchmark reads benchmark.csv and writes personamem.benchmark.jsonl only', () => {
      const dir = writeFixtureDataDir()
      expect(runPrepare(dir).status).toBe(0)
      expect(readPrepared(dir)).toHaveLength(6)
      expect(existsSync(join(dir, 'personamem.val.jsonl'))).toBe(false)
    })

    it('val reads val.csv and writes personamem.val.jsonl, never touching the benchmark file', () => {
      const dir = writeFixtureDataDir({ split: 'val', skipHistoryFor: 'all' })
      const res = runPrepare(dir, [], 'val')
      expect(res.status, res.stderr).toBe(0)
      const rows = readPrepared(dir, 'val')
      expect(rows).toHaveLength(6)
      expect(rows[0]).toMatchObject({ personaId: 7, prefType: 'neutral' })
      expect(rows[0]!.historyPath).toBe(
        join(dir, 'data/chat_history_32k/chat_history_fixture_persona7.json'),
      )
      expect(existsSync(join(dir, 'personamem.benchmark.jsonl'))).toBe(false)
    })

    it('val does not need the history files (evidence-only runs read none)', () => {
      const dir = writeFixtureDataDir({ split: 'val', skipHistoryFor: 'all' })
      expect(runPrepare(dir, [], 'val').status).toBe(0)
    })

    it('benchmark still refuses when its history files are missing', () => {
      const dir = writeFixtureDataDir({ skipHistoryFor: 'all' })
      const res = runPrepare(dir)
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('history file(s) missing')
    })

    it('names the missing split CSV', () => {
      const dir = writeFixtureDataDir()
      const res = runPrepare(dir, [], 'val')
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain(join(dir, 'benchmark/text/val.csv'))
    })

    it('--print-history-urls works for val without any history file', () => {
      const dir = writeFixtureDataDir({ split: 'val', skipHistoryFor: 'all' })
      const res = runPrepare(dir, ['--print-history-urls'], 'val')
      expect(res.status, res.stderr).toBe(0)
      expect(res.stdout.trim().split('\n')).toHaveLength(2)
    })
  })
})
