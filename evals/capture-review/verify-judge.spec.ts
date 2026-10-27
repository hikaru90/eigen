import { describe, expect, it } from 'vitest'
import type { CaptureQuality } from '$lib/server/capture-review/admin-quality'
import {
  evaluateCase,
  otherPartChanges,
  qualityDeltaChecks,
  voteRowChecks,
  weakestScoredPart,
  type ReviewSnapshot,
  type VerifyPart,
} from './verify-judge'

const part = (
  p: string,
  ref: string,
  label: string,
  probability: number,
  engine = 'jev_audit',
): VerifyPart => ({ part: p, ref, engine, label, probability })

const snapshot = (
  score: number | null,
  parts: VerifyPart[],
  status = 'scored',
): ReviewSnapshot => ({
  status,
  score,
  parts,
})

const cleanParts = [
  part('category', 'category', 'task', 0.93, 'jev_decision'),
  part('wording', 'wording', 'right', 0.97),
  part('date', 'date:d1', 'right', 0.92),
  part('missing_dates', 'missing_dates', 'none_missing', 0.95),
]

describe('weakestScoredPart', () => {
  it('is the lowest probability over the parts that count toward the score', () => {
    const parts = [
      ...cleanParts,
      part('entity_type', 'm1', 'artifact', 0.1, 'jev_decision'), // hidden: never the weakest
    ]
    expect(weakestScoredPart(parts)).toMatchObject({ part: 'date', ref: 'date:d1' })
  })

  it('is null without scored parts', () => {
    expect(weakestScoredPart([])).toBeNull()
  })
})

describe('evaluateCase: clean', () => {
  it('passes at or above the threshold and fails below it', () => {
    expect(
      evaluateCase({ kind: 'clean', target: null, before: snapshot(0.7, cleanParts), after: null })
        .pass,
    ).toBe(true)
    const low = evaluateCase({
      kind: 'clean',
      target: null,
      before: snapshot(0.69, cleanParts),
      after: null,
    })
    expect(low.pass).toBe(false)
    expect(low.reasons.join(' ')).toMatch(/below the threshold/)
  })

  it('fails when the review is not scored', () => {
    const out = evaluateCase({
      kind: 'clean',
      target: null,
      before: snapshot(null, [], 'audit_failed'),
      after: null,
    })
    expect(out.pass).toBe(false)
    expect(out.reasons.join(' ')).toMatch(/audit_failed/)
  })
})

describe('evaluateCase: mistake', () => {
  const target = { part: 'date', ref: 'date:d1', negativeLabel: 'wrong' }
  const before = snapshot(0.92, cleanParts)
  const flipped = [
    cleanParts[0],
    cleanParts[1],
    part('date', 'date:d1', 'wrong', 0.04),
    cleanParts[3],
  ]

  it('passes when the targeted part is negative AND the score is below the threshold', () => {
    const out = evaluateCase({ kind: 'mistake', target, before, after: snapshot(0.04, flipped) })
    expect(out).toMatchObject({ pass: true, targetLabel: 'wrong', targetProbability: 0.04 })
    expect(out.otherChanges).toEqual([])
    expect(out.beforeWeak).toBe(false)
  })

  it('fails when the label flipped but the score stayed at the threshold or above', () => {
    const out = evaluateCase({ kind: 'mistake', target, before, after: snapshot(0.7, flipped) })
    expect(out.pass).toBe(false)
    expect(out.reasons.join(' ')).toMatch(/not below the threshold/)
  })

  it('fails when the score fell but the targeted part kept its good label', () => {
    const out = evaluateCase({
      kind: 'mistake',
      target,
      before,
      after: snapshot(0.5, [cleanParts[0], part('date', 'date:d1', 'right', 0.5)]),
    })
    expect(out.pass).toBe(false)
    expect(out.reasons.join(' ')).toMatch(/date:d1 is "right"/)
  })

  it('matches a whole-capture part by part kind when the target has no ref', () => {
    const out = evaluateCase({
      kind: 'mistake',
      target: { part: 'missing_dates', ref: null, negativeLabel: 'something_missing' },
      before,
      after: snapshot(0.1, [
        cleanParts[0],
        part('missing_dates', 'missing_dates', 'something_missing', 0.1),
      ]),
    })
    expect(out.pass).toBe(true)
  })

  it('fails when the targeted part is missing from the review', () => {
    const out = evaluateCase({
      kind: 'mistake',
      target,
      before,
      after: snapshot(0.1, [cleanParts[0]]),
    })
    expect(out.pass).toBe(false)
    expect(out.reasons.join(' ')).toMatch(/no date:d1 part/)
  })

  it('fails when the after review is not scored', () => {
    const out = evaluateCase({
      kind: 'mistake',
      target,
      before,
      after: snapshot(null, [], 'audit_failed'),
    })
    expect(out.pass).toBe(false)
  })

  it('reports a case that was already weak before the injection, without failing it for that', () => {
    const out = evaluateCase({
      kind: 'mistake',
      target,
      before: snapshot(0.4, [part('wording', 'wording', 'wrong', 0.4)]),
      after: snapshot(0.04, flipped),
    })
    expect(out.beforeWeak).toBe(true)
    expect(out.pass).toBe(true)
  })

  it('a setup failure fails the case with its reason', () => {
    const out = evaluateCase({
      kind: 'mistake',
      target,
      before,
      after: null,
      setupError: 'no dates stored',
    })
    expect(out.pass).toBe(false)
    expect(out.reasons).toEqual(['setup: no dates stored'])
  })
})

describe('otherPartChanges', () => {
  it('lists label flips, new and vanished parts, and ignores the target and probability moves', () => {
    const before = [
      part('wording', 'wording', 'right', 0.97),
      part('date', 'date:d1', 'right', 0.9),
      part('name', 'name:n1', 'right', 0.9),
    ]
    const after = [
      part('wording', 'wording', 'wrong', 0.2),
      part('date', 'date:d1', 'wrong', 0.05),
      part('missing_names', 'missing_names', 'none_missing', 0.9),
    ]
    expect(otherPartChanges(before, after, { part: 'date', ref: 'date:d1' })).toEqual([
      'wording right>wrong',
      'name:n1 gone',
      'missing_names new',
    ])
    const same = [part('wording', 'wording', 'right', 0.5)]
    expect(otherPartChanges(before.slice(0, 1), same, null)).toEqual([])
  })
})

const quality = (over: {
  reviews?: number
  captureUp?: number
  captureDown?: number
  meshUp?: number
  meshDown?: number
  downWithoutReason?: number
  wrongDate?: number
}): CaptureQuality =>
  ({
    totals: {
      reviews: over.reviews ?? 0,
      votes: {
        capture: { up: over.captureUp ?? 0, down: over.captureDown ?? 0 },
        mesh: { up: over.meshUp ?? 0, down: over.meshDown ?? 0 },
        mcp: { up: 0, down: 0 },
      },
      downWithoutReason: over.downWithoutReason ?? 0,
    },
    reasonKinds: { wrong_date: over.wrongDate ?? 0 },
  }) as unknown as CaptureQuality

describe('qualityDeltaChecks', () => {
  const expected = {
    reviews: 14,
    votes: { capture: { up: 2, down: 0 }, mesh: { up: 0, down: 2 }, mcp: { up: 0, down: 0 } },
    downWithoutReason: 1,
    wrongDate: 1,
  }

  it('passes when every delta matches, whatever the baseline was', () => {
    const before = quality({
      reviews: 5,
      captureUp: 1,
      meshDown: 3,
      downWithoutReason: 2,
      wrongDate: 4,
    })
    const after = quality({
      reviews: 19,
      captureUp: 3,
      meshDown: 5,
      downWithoutReason: 3,
      wrongDate: 5,
    })
    const checks = qualityDeltaChecks(before, after, expected)
    expect(checks.every((c) => c.ok)).toBe(true)
    expect(checks.map((c) => c.name)).toContain('reasonKinds.wrong_date')
  })

  it('names the delta that is off', () => {
    const before = quality({})
    const after = quality({
      reviews: 14,
      captureUp: 2,
      meshDown: 1,
      downWithoutReason: 1,
      wrongDate: 1,
    })
    const bad = qualityDeltaChecks(before, after, expected).filter((c) => !c.ok)
    expect(bad.map((c) => c.name)).toEqual(['votes.mesh.down'])
    expect(bad[0]).toMatchObject({ expected: '+2', actual: '+1' })
  })
})

describe('voteRowChecks', () => {
  const row = {
    verdict: 'down' as const,
    votedOn: 'mesh' as const,
    reasonKind: 'wrong_date',
    reasonStored: true,
    editAppliedAt: new Date('2026-10-27T10:00:00Z'),
  }

  it('passes a vote with a reason whose label and edit are stored', () => {
    const checks = voteRowChecks(
      {
        verdict: 'down',
        votedOn: 'mesh',
        reasonKind: 'wrong_date',
        reasonStored: true,
        edit: true,
      },
      row,
    )
    expect(checks.every((c) => c.ok)).toBe(true)
  })

  it('passes an empty down vote only with no label, no stored reason and no edit', () => {
    const empty = { ...row, reasonKind: null, reasonStored: false, editAppliedAt: null }
    const want = {
      verdict: 'down' as const,
      votedOn: 'mesh' as const,
      reasonKind: null,
      reasonStored: false,
      edit: false,
    }
    expect(voteRowChecks(want, empty).every((c) => c.ok)).toBe(true)
    const bad = voteRowChecks(want, { ...empty, editAppliedAt: new Date() }).filter((c) => !c.ok)
    expect(bad.map((c) => c.name)).toEqual(['edit_applied_at'])
  })

  it('reports each field that differs', () => {
    const bad = voteRowChecks(
      { verdict: 'up', votedOn: 'capture', reasonKind: null, reasonStored: false, edit: false },
      row,
    ).filter((c) => !c.ok)
    expect(bad.map((c) => c.name)).toEqual([
      'verdict',
      'voted_on',
      'reason_kind',
      'reason',
      'edit_applied_at',
    ])
  })
})
