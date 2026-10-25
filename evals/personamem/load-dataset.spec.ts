import type { Split } from './types'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { groupByPersona, loadHistory, loadPreparedRows, preparedFilename } from './load-dataset'
import { FIXTURES_DIR } from './test-fixtures'

const HISTORY_7 = join(FIXTURES_DIR, 'chat_history_fixture_persona7.json')
const HISTORY_9 = join(FIXTURES_DIR, 'chat_history_fixture_persona9.json')

function preparedRow(overrides: Record<string, unknown> = {}) {
  return {
    personaId: 7,
    historyPath: HISTORY_7,
    query: 'Suggest a drink for tonight.',
    correctAnswer: 'Green tea.',
    incorrectAnswers: ['Black tea.', 'Espresso.', 'Milk shake.'],
    prefType: 'neutral',
    who: 'self',
    updated: false,
    prevPref: null,
    scenario: 'personal_email',
    topicQuery: 'Food',
    distance32k: 4000,
    questionId: 'p7-aaaaaaaaaaaa',
    preference: 'Drinks green tea in the evening',
    evidenceTurns: [{ role: 'user', content: 'I only drink green tea in the evening.' }],
    ...overrides,
  }
}

function writePrepared(rows: unknown[], split: Split = 'benchmark', into?: string): string {
  const dir = into ?? mkdtempSync(join(tmpdir(), 'personamem-load-'))
  writeFileSync(
    join(dir, preparedFilename(split)),
    `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
  )
  return dir
}

describe('loadPreparedRows', () => {
  it('reads and validates every row', () => {
    const dir = writePrepared([preparedRow(), preparedRow({ questionId: 'p7-bbbbbbbbbbbb' })])
    expect(loadPreparedRows(dir, 'benchmark')).toHaveLength(2)
  })

  it('rejects a row with two incorrect answers, naming file and line', () => {
    const dir = writePrepared([preparedRow(), preparedRow({ incorrectAnswers: ['one', 'two'] })])
    expect(() => loadPreparedRows(dir, 'benchmark')).toThrow(/line 2/)
    expect(() => loadPreparedRows(dir, 'benchmark')).toThrow(/incorrectAnswers/)
  })

  it('rejects options that are not four distinct strings', () => {
    const dir = writePrepared([preparedRow({ incorrectAnswers: ['Green tea.', 'x', 'y'] })])
    expect(() => loadPreparedRows(dir, 'benchmark')).toThrow(/distinct/)
  })

  it('tells the operator to re-run prepare.py when evidenceTurns/preference are missing', () => {
    const { evidenceTurns: _e, preference: _p, ...old } = preparedRow()
    const dir = writePrepared([old])
    expect(() => loadPreparedRows(dir, 'benchmark')).toThrow(/re-run.*prepare\.py/)
  })

  it('rejects empty evidenceTurns', () => {
    const dir = writePrepared([preparedRow({ evidenceTurns: [] })])
    expect(() => loadPreparedRows(dir, 'benchmark')).toThrow(/evidenceTurns/)
  })

  it('rejects duplicate question ids', () => {
    const dir = writePrepared([preparedRow(), preparedRow()])
    expect(() => loadPreparedRows(dir, 'benchmark')).toThrow(/duplicate questionId/)
  })

  it('tells the operator to run prepare.py when the prepared file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'personamem-empty-'))
    expect(() => loadPreparedRows(dir, 'benchmark')).toThrow(/prepare\.py/)
  })
})

describe('loadPreparedRows --split', () => {
  it('names the prepared file per split', () => {
    expect(preparedFilename('benchmark')).toBe('personamem.benchmark.jsonl')
    expect(preparedFilename('val')).toBe('personamem.val.jsonl')
  })

  it('reads the file of the requested split only', () => {
    const dir = writePrepared([preparedRow({ questionId: 'p7-aaaaaaaaaaaa' })], 'benchmark')
    writePrepared(
      [
        preparedRow({ questionId: 'p7-bbbbbbbbbbbb' }),
        preparedRow({ questionId: 'p7-cccccccccccc' }),
      ],
      'val',
      dir,
    )
    expect(loadPreparedRows(dir, 'benchmark').map((r) => r.questionId)).toEqual(['p7-aaaaaaaaaaaa'])
    expect(loadPreparedRows(dir, 'val').map((r) => r.questionId)).toEqual([
      'p7-bbbbbbbbbbbb',
      'p7-cccccccccccc',
    ])
  })

  it('names the missing split file and the prepare.py call that writes it', () => {
    const dir = writePrepared([preparedRow()], 'benchmark')
    expect(() => loadPreparedRows(dir, 'val')).toThrow(/personamem\.val\.jsonl/)
    expect(() => loadPreparedRows(dir, 'val')).toThrow(/--split val/)
  })

  it('names the split in a row error', () => {
    const dir = writePrepared([preparedRow({ incorrectAnswers: ['one', 'two'] })], 'val')
    expect(() => loadPreparedRows(dir, 'val')).toThrow(/personamem\.val\.jsonl line 1/)
  })
})

describe('groupByPersona', () => {
  it('groups rows by persona in ascending persona id, keeping query order', () => {
    const rows = [
      preparedRow({ personaId: 9, historyPath: HISTORY_9, questionId: 'p9-aaaaaaaaaaaa' }),
      preparedRow({ questionId: 'p7-aaaaaaaaaaaa' }),
      preparedRow({ query: 'second', questionId: 'p7-bbbbbbbbbbbb' }),
    ]
    const dir = writePrepared(rows)
    const groups = groupByPersona(loadPreparedRows(dir, 'benchmark'))
    expect(groups.map((g) => g.personaId)).toEqual([7, 9])
    expect(groups[0]!.queries.map((q) => q.questionId)).toEqual([
      'p7-aaaaaaaaaaaa',
      'p7-bbbbbbbbbbbb',
    ])
    expect(groups[0]!.historyPath).toBe(HISTORY_7)
  })

  it('refuses a persona whose rows point at different history files', () => {
    const dir = writePrepared([
      preparedRow(),
      preparedRow({ historyPath: HISTORY_9, questionId: 'p7-bbbbbbbbbbbb' }),
    ])
    expect(() => groupByPersona(loadPreparedRows(dir, 'benchmark'))).toThrow(/persona 7.*history/)
  })
})

describe('loadHistory', () => {
  it('loads a history file', () => {
    const history = loadHistory(HISTORY_7)
    expect(history.chat_history).toHaveLength(10)
    expect(history.chat_history[0]!.role).toBe('system')
  })

  it('names the path when the file is missing', () => {
    const missing = join(FIXTURES_DIR, 'nope.json')
    expect(() => loadHistory(missing)).toThrow(missing)
  })

  it('rejects a history with an unknown role', () => {
    const dir = mkdtempSync(join(tmpdir(), 'personamem-hist-'))
    const path = join(dir, 'h.json')
    writeFileSync(path, JSON.stringify({ chat_history: [{ role: 'tool', content: 'x' }] }))
    expect(() => loadHistory(path)).toThrow(path)
  })
})
