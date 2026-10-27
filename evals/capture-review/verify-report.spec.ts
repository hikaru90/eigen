import { describe, expect, it } from 'vitest'
import { evaluateCase, type ReviewSnapshot, type VerifyPart } from './verify-judge'
import {
  formatVerifyReport,
  verifyExitCode,
  type VerifyCaseRow,
  type VerifyReportInput,
} from './verify-report'

const part = (p: string, ref: string, label: string, probability: number): VerifyPart => ({
  part: p,
  ref,
  engine: 'jev_audit',
  label,
  probability,
})
const snap = (score: number, parts: VerifyPart[]): ReviewSnapshot => ({
  status: 'scored',
  score,
  parts,
})

const cleanBefore = snap(0.9, [
  part('wording', 'wording', 'right', 0.97),
  part('date', 'date:d1', 'right', 0.9),
])
const cleanRow: VerifyCaseRow = {
  id: 'clean_a',
  kind: 'clean',
  mutation: null,
  target: null,
  before: cleanBefore,
  after: null,
  outcome: evaluateCase({ kind: 'clean', target: null, before: cleanBefore, after: null }),
}

const target = { part: 'date', ref: 'date:d1', negativeLabel: 'wrong' }
const afterWrong = snap(0.04, [
  part('wording', 'wording', 'right', 0.97),
  part('date', 'date:d1', 'wrong', 0.04),
])
const mistakeRow = (after: ReviewSnapshot): VerifyCaseRow => ({
  id: 'wrong_date',
  kind: 'mistake',
  mutation: 'date +1 day',
  target,
  before: cleanBefore,
  after,
  outcome: evaluateCase({ kind: 'mistake', target, before: cleanBefore, after }),
})

const input = (
  cases: VerifyCaseRow[],
  over: Partial<VerifyReportInput> = {},
): VerifyReportInput => ({
  cases,
  voteGroups: [
    {
      title: 'thumbs up on clean_a (capture)',
      checks: [{ name: 'verdict', ok: true, expected: 'up', actual: 'up' }],
      notes: [],
    },
  ],
  deltas: [{ name: 'reviews', ok: true, expected: '+3', actual: '+3' }],
  totalUsd: '0.0123',
  notes: ['date fix after the edit: not fixed'],
  ...over,
})

describe('formatVerifyReport', () => {
  it('prints one row per case with before, after, target, other changes and the result', () => {
    const text = formatVerifyReport(input([cleanRow, mistakeRow(afterWrong)]))
    expect(text).toMatch(/CASE\s+MUTATION\s+BEFORE\s+AFTER\s+TARGET\s+OTHER\s+RESULT/)
    expect(text).toMatch(/clean_a\s+-\s+0\.9000 date:d1\s+-\s+-\s+-\s+PASS/)
    expect(text).toMatch(
      /wrong_date\s+date \+1 day\s+0\.9000 date:d1\s+0\.0400\s+date:d1 wrong 0\.0400\s+-\s+PASS/,
    )
  })

  it('shows a FAIL row, its reasons and still prints the votes, deltas, cost and notes', () => {
    const stillRight = snap(0.8, [
      part('wording', 'wording', 'right', 0.97),
      part('date', 'date:d1', 'right', 0.8),
    ])
    const text = formatVerifyReport(input([cleanRow, mistakeRow(stillRight)]))
    expect(text).toMatch(/wrong_date .*FAIL/)
    expect(text).toContain('wrong_date: date:d1 is "right", expected "wrong"')
    expect(text).toContain('thumbs up on clean_a (capture)')
    expect(text).toContain('reviews')
    expect(text).toContain('USD')
    expect(text).toContain('0.0123')
    expect(text).toContain('date fix after the edit: not fixed')
    expect(text).toMatch(/result:\s+FAIL/)
  })

  it('flags a mistake case that was already weak before the injection, with its weakest part', () => {
    const weak = snap(0.4, [part('wording', 'wording', 'wrong', 0.4)])
    const row: VerifyCaseRow = {
      ...mistakeRow(afterWrong),
      before: weak,
      outcome: evaluateCase({ kind: 'mistake', target, before: weak, after: afterWrong }),
    }
    const text = formatVerifyReport(input([cleanRow, row]))
    expect(text).toContain(
      'wrong_date: already below the threshold before the injection (weakest wording 0.4000)',
    )
  })

  it('prints injection notes and the parts under the threshold for a failing or weak case', () => {
    const weak = snap(0.4, [
      part('wording', 'wording', 'wrong', 0.4),
      part('date', 'date:d1', 'right', 0.9),
    ])
    const row: VerifyCaseRow = {
      ...mistakeRow(afterWrong),
      before: weak,
      notes: ['removed the name "Jonas"'],
      outcome: evaluateCase({ kind: 'mistake', target, before: weak, after: afterWrong }),
    }
    const text = formatVerifyReport(input([cleanRow, row]))
    expect(text).toContain('wrong_date: note: removed the name "Jonas"')
    expect(text).toContain('wrong_date: parts below the threshold before: wording wrong 0.4000')
    expect(text).toContain('wrong_date: parts below the threshold after: date:d1 wrong 0.0400')
  })

  it('prints a dash for a missing total cost', () => {
    expect(formatVerifyReport(input([cleanRow], { totalUsd: null }))).toMatch(/USD:\s+-/)
  })

  it('shows other part changes in the OTHER column', () => {
    const after = snap(0.04, [
      part('wording', 'wording', 'wrong', 0.3),
      part('date', 'date:d1', 'wrong', 0.04),
    ])
    const text = formatVerifyReport(input([cleanRow, mistakeRow(after)]))
    expect(text).toContain('wording right>wrong')
  })
})

describe('verifyExitCode', () => {
  it('is 0 only when every case, vote check and delta passes', () => {
    expect(verifyExitCode(input([cleanRow, mistakeRow(afterWrong)]))).toBe(0)
  })

  it('is 1 for a failing case, a failing vote check or a failing delta', () => {
    const stillRight = snap(0.8, [part('date', 'date:d1', 'right', 0.8)])
    expect(verifyExitCode(input([mistakeRow(stillRight)]))).toBe(1)
    expect(
      verifyExitCode(
        input([cleanRow], {
          voteGroups: [
            {
              title: 't',
              checks: [{ name: 'verdict', ok: false, expected: 'up', actual: 'down' }],
              notes: [],
            },
          ],
        }),
      ),
    ).toBe(1)
    expect(
      verifyExitCode(
        input([cleanRow], {
          deltas: [{ name: 'reviews', ok: false, expected: '+3', actual: '+2' }],
        }),
      ),
    ).toBe(1)
  })

  it('is 1 for an empty run', () => {
    expect(verifyExitCode(input([]))).toBe(1)
  })
})
