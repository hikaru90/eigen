import { describe, expect, it } from 'vitest'
import {
  CAPTURE_REVIEW_THRESHOLD,
  REVIEW_AUDIT_PARTS,
  REVIEW_DECISION_KINDS,
  captureReviewPartSchema,
  computeReviewScore,
  decisionsToParts,
  parseCaptureReviewParts,
  type CaptureReviewPart,
} from './review-parts'

const decisionPart: CaptureReviewPart = {
  part: 'category',
  ref: 'category',
  engine: 'jev_decision',
  label: 'task',
  probability: 0.55,
}

const auditPart: CaptureReviewPart = {
  part: 'name',
  ref: 'name:n1',
  engine: 'jev_audit',
  label: 'right',
  probability: 0.97,
}

describe('review constants', () => {
  it('reviews exactly the user-visible capture decisions', () => {
    expect([...REVIEW_DECISION_KINDS]).toEqual([
      'category',
      'content_role',
      'entity_type',
      'temporal_kind',
    ])
  })

  it('audits wording, names, missing names and dates, the date, pieces and their cover', () => {
    expect([...REVIEW_AUDIT_PARTS]).toEqual([
      'wording',
      'name',
      'missing_names',
      'date',
      'missing_dates',
      'piece',
      'pieces_cover',
    ])
  })

  it('splits weak from sure captures at 0.7', () => {
    expect(CAPTURE_REVIEW_THRESHOLD).toBe(0.7)
  })
})

describe('captureReviewPartSchema', () => {
  it('accepts a decision part and an audit part', () => {
    expect(captureReviewPartSchema.parse(decisionPart)).toEqual(decisionPart)
    expect(captureReviewPartSchema.parse(auditPart)).toEqual(auditPart)
  })

  it('rejects any extra field, so thought text cannot ride along in a part', () => {
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, surface: 'Anna' })).toThrow()
    expect(() =>
      captureReviewPartSchema.parse({ ...auditPart, event: 'dentist on Friday' }),
    ).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...auditPart, text: 'x' })).toThrow()
  })

  it('rejects a missing field', () => {
    const { label: _label, ...withoutLabel } = decisionPart
    expect(() => captureReviewPartSchema.parse(withoutLabel)).toThrow()
  })

  it('rejects a probability outside 0..1 or not a number', () => {
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, probability: 1.01 })).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, probability: -0.1 })).toThrow()
    expect(() =>
      captureReviewPartSchema.parse({ ...decisionPart, probability: Number.NaN }),
    ).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, probability: '0.5' })).toThrow()
  })

  it('rejects an unknown engine or part name', () => {
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, engine: 'chat' })).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, part: 'mood' })).toThrow()
  })

  it('rejects a part that does not belong to its engine', () => {
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, engine: 'jev_audit' })).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...auditPart, engine: 'jev_decision' })).toThrow()
  })

  it('rejects an empty or whitespace ref, and an over-long ref or label', () => {
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, ref: '' })).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, ref: 'a b' })).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, ref: 'r'.repeat(81) })).toThrow()
    expect(() => captureReviewPartSchema.parse({ ...decisionPart, label: '' })).toThrow()
    expect(() =>
      captureReviewPartSchema.parse({ ...decisionPart, label: 'l'.repeat(81) }),
    ).toThrow()
  })
})

describe('parseCaptureReviewParts', () => {
  it('accepts an empty list and a valid list', () => {
    expect(parseCaptureReviewParts([])).toEqual([])
    expect(parseCaptureReviewParts([decisionPart, auditPart])).toEqual([decisionPart, auditPart])
  })

  it('rejects a non-array', () => {
    expect(() => parseCaptureReviewParts({})).toThrow(/parts/)
    expect(() => parseCaptureReviewParts(null)).toThrow(/parts/)
  })

  it('rejects the same part and ref twice', () => {
    expect(() =>
      parseCaptureReviewParts([decisionPart, { ...decisionPart, probability: 0.9 }]),
    ).toThrow(/duplicate/)
  })

  it('names the capture review in the error, not the offending value', () => {
    try {
      parseCaptureReviewParts([{ ...decisionPart, surface: 'Anna Schmidt' }])
      expect.unreachable()
    } catch (err) {
      expect(String(err)).toMatch(/capture review/i)
      expect(String(err)).not.toContain('Anna Schmidt')
    }
  })
})

describe('decisionsToParts', () => {
  it('maps the review kinds to jev_decision parts and ignores the rest', () => {
    const parts = decisionsToParts([
      { kind: 'category', ref: 'category', choice: 'task', probability: 0.55 },
      { kind: 'content_role', ref: 'content_role', choice: 'thought_only', probability: 0.9 },
      { kind: 'entity_type', ref: 'm1', choice: 'person', probability: 0.8 },
      { kind: 'temporal_kind', ref: 't2', choice: 'deadline', probability: 0.7 },
      { kind: 'open_loop', ref: 'open_loop', choice: 'actionable', probability: 0.4 },
      { kind: 'salience_band', ref: 'salience_band', choice: 'high', probability: 0.3 },
      { kind: 'relation_type', ref: 'p1', choice: 'works_with', probability: 0.2 },
    ])
    expect(parts).toEqual([
      {
        part: 'category',
        ref: 'category',
        engine: 'jev_decision',
        label: 'task',
        probability: 0.55,
      },
      {
        part: 'content_role',
        ref: 'content_role',
        engine: 'jev_decision',
        label: 'thought_only',
        probability: 0.9,
      },
      { part: 'entity_type', ref: 'm1', engine: 'jev_decision', label: 'person', probability: 0.8 },
      {
        part: 'temporal_kind',
        ref: 't2',
        engine: 'jev_decision',
        label: 'deadline',
        probability: 0.7,
      },
    ])
  })

  it('keeps the last answer when one item was decided twice in the same attempt', () => {
    const parts = decisionsToParts([
      { kind: 'entity_type', ref: 'm1', choice: 'person', probability: 0.5 },
      { kind: 'entity_type', ref: 'm1', choice: 'place', probability: 0.9 },
    ])
    expect(parts).toEqual([
      { part: 'entity_type', ref: 'm1', engine: 'jev_decision', label: 'place', probability: 0.9 },
    ])
  })

  it('returns an empty list when nothing review-relevant was enforced', () => {
    expect(decisionsToParts([])).toEqual([])
  })

  it('produces parts that pass the strict schema', () => {
    const parts = decisionsToParts([
      { kind: 'category', ref: 'category', choice: 'task', probability: 0.55 },
    ])
    expect(parseCaptureReviewParts(parts)).toEqual(parts)
  })
})

describe('computeReviewScore', () => {
  it('is the lowest probability over all parts, decision and audit alike', () => {
    expect(computeReviewScore([decisionPart, auditPart])).toBe(0.55)
    expect(
      computeReviewScore([
        { ...decisionPart, probability: 0.99 },
        { ...auditPart, probability: 0.31 },
      ]),
    ).toBe(0.31)
  })

  it('is null with no parts at all', () => {
    expect(computeReviewScore([])).toBeNull()
  })
})
