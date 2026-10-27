import { describe, expect, it } from 'vitest'
import {
  formatSmokeReport,
  median,
  orderSplitChildren,
  renderTable,
  smokeExitCode,
  smokeTotals,
  type SmokeCaptureResult,
  type SmokeThoughtResult,
} from './report'

function thought(overrides: Partial<SmokeThoughtResult> = {}): SmokeThoughtResult {
  return {
    thoughtId: '6f1c2a90-aaaa-bbbb-cccc-1234567890ab',
    splitChild: false,
    text: 'Call Mom on Friday about the birthday dinner',
    category: 'task',
    enrichQueueStatus: 'complete',
    enrichQueueError: null,
    review: {
      status: 'scored',
      score: 0.734,
      auditError: null,
      parts: [
        {
          part: 'category',
          ref: 'category',
          engine: 'jev_decision',
          label: 'task',
          probability: 0.9,
        },
        { part: 'name', ref: 'name:n1', engine: 'jev_audit', label: 'right', probability: 0.734 },
      ],
    },
    audit: {
      names: [{ ref: 'n1', surface: 'Mom' }],
      dates: [{ ref: 'd1', event: 'Call Mom', day: '2026-10-30', detail: null }],
      pieces: [],
    },
    auditInputError: null,
    ...overrides,
  }
}

function capture(
  index: number,
  thoughts: SmokeThoughtResult[],
  text = 'Call Mom on Friday about the birthday dinner',
): SmokeCaptureResult {
  return { index, text, capturedAt: '2026-10-27T10:00:00+01:00', thoughts }
}

const scored = (score: number): SmokeThoughtResult =>
  thought({ review: { status: 'scored', score, auditError: null, parts: [] } })

describe('median', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([0.9, 0.1, 0.5])).toBe(0.5)
    expect(median([0.2, 0.4, 0.6, 0.8])).toBeCloseTo(0.5)
    expect(median([0.7])).toBe(0.7)
  })

  it('is null for nothing', () => {
    expect(median([])).toBeNull()
  })
})

describe('smokeTotals', () => {
  it('counts reviews by status and gives the min and median score of the scored ones', () => {
    const totals = smokeTotals([
      capture(1, [scored(0.9), scored(0.3)]),
      capture(2, [
        scored(0.6),
        thought({ review: { status: 'pending_audit', score: null, auditError: null, parts: [] } }),
      ]),
      capture(3, [
        thought({
          review: { status: 'audit_failed', score: null, auditError: 'gave up', parts: [] },
        }),
        thought({ review: null }),
      ]),
    ])
    expect(totals).toEqual({
      captures: 3,
      thoughts: 6,
      splitChildren: 0,
      reviews: 5,
      scored: 3,
      pendingAudit: 1,
      auditFailed: 1,
      withoutReview: 1,
      minScore: 0.3,
      medianScore: 0.6,
    })
  })

  it('counts split children apart from captures', () => {
    const totals = smokeTotals([
      capture(1, [
        scored(0.8),
        { ...scored(0.7), splitChild: true },
        { ...scored(0.9), splitChild: true },
      ]),
    ])
    expect(totals).toMatchObject({ captures: 1, thoughts: 3, splitChildren: 2, scored: 3 })
  })

  it('has no min or median when nothing is scored', () => {
    const totals = smokeTotals([capture(1, [thought({ review: null })])])
    expect(totals.minScore).toBeNull()
    expect(totals.medianScore).toBeNull()
  })
})

describe('smokeExitCode', () => {
  it('is 0 when every thought, split children included, has a scored review', () => {
    expect(smokeExitCode([capture(1, [scored(0.8), { ...scored(0.6), splitChild: true }])])).toBe(0)
  })

  it('is 1 when any review is pending, failed or missing', () => {
    const pending = thought({
      review: { status: 'pending_audit', score: null, auditError: null, parts: [] },
    })
    const failed = thought({
      review: { status: 'audit_failed', score: null, auditError: 'x', parts: [] },
    })
    expect(smokeExitCode([capture(1, [scored(0.8), pending])])).toBe(1)
    expect(smokeExitCode([capture(1, [failed])])).toBe(1)
    expect(smokeExitCode([capture(1, [scored(0.8), thought({ review: null })])])).toBe(1)
  })

  it('is 1 when a split child is the one without a scored review', () => {
    expect(
      smokeExitCode([
        capture(1, [scored(0.8), { ...thought({ review: null }), splitChild: true }]),
      ]),
    ).toBe(1)
  })

  it('is 1 for an empty run (nothing was captured, so nothing was verified)', () => {
    expect(smokeExitCode([])).toBe(1)
  })
})

describe('orderSplitChildren', () => {
  const child = (text: string) => ({ text })

  it('orders the children like the pieces the capture was split into', () => {
    const ordered = orderSplitChildren(
      [child('Water the plants'), child('Send invoice'), child('Book train')],
      ['Send invoice', 'Book train', 'Water the plants'],
    )
    expect(ordered.map((c) => c.text)).toEqual(['Send invoice', 'Book train', 'Water the plants'])
  })

  it('puts children that match no piece last, in text order', () => {
    const ordered = orderSplitChildren(
      [child('Zebra'), child('Send invoice'), child('Apple')],
      ['Send invoice'],
    )
    expect(ordered.map((c) => c.text)).toEqual(['Send invoice', 'Apple', 'Zebra'])
  })

  it('does not change the list it is given', () => {
    const children = [child('b'), child('a')]
    orderSplitChildren(children, [])
    expect(children.map((c) => c.text)).toEqual(['b', 'a'])
  })
})

describe('renderTable', () => {
  it('pads every column to its widest cell and indents the rows', () => {
    expect(
      renderTable(
        ['PART', 'REF'],
        [
          ['category', 'category'],
          ['name', 'name:n1'],
        ],
        '  ',
      ),
    ).toEqual(['  PART      REF', '  category  category', '  name      name:n1'])
  })
})

describe('formatSmokeReport', () => {
  const report = formatSmokeReport([
    capture(1, [thought()]),
    capture(
      2,
      [
        thought({ text: 'Today: 1) send invoice 2) book train', category: 'task' }),
        {
          ...thought({
            thoughtId: 'bbbbbbbb-1111-2222-3333-444444444444',
            text: 'Book train to Hamburg',
            review: { status: 'pending_audit', score: null, auditError: null, parts: [] },
            audit: {
              names: [],
              dates: [],
              pieces: [{ ref: 'p1', text: 'Book train to Hamburg' }],
            },
          }),
          splitChild: true,
        },
      ],
      'Today: 1) send invoice 2) book train',
    ),
  ])

  it('titles each capture with its number, of the total, and its time', () => {
    expect(report).toContain('=== Capture 1 of 2 · 2026-10-27T10:00:00+01:00')
    expect(report).toContain('=== Capture 2 of 2 · 2026-10-27T10:00:00+01:00')
  })

  it('prints the capture text, the stored category, the review status and the score', () => {
    expect(report).toContain('capture: Call Mom on Friday about the birthday dinner')
    expect(report).toContain('category: task')
    expect(report).toContain('review:   scored · score 0.7340')
  })

  it('prints the parts as a table of part, ref, engine, label and probability', () => {
    expect(report).toContain('PART      REF       ENGINE        LABEL  PROBABILITY')
    expect(report).toContain('category  category  jev_decision  task   0.9000')
    expect(report).toContain('name      name:n1   jev_audit     right  0.7340')
  })

  it('prints the audit input: names, dates with day and detail, pieces', () => {
    expect(report).toContain('names:  n1 "Mom"')
    expect(report).toContain('dates:  d1 "Call Mom" · day 2026-10-30 · detail -')
    expect(report).toContain('pieces: -')
    expect(report).toContain('p1 "Book train to Hamburg"')
  })

  it('shows a date that repeats with no day and its detail', () => {
    const text = formatSmokeReport([
      capture(1, [
        thought({
          audit: {
            names: [],
            dates: [{ ref: 'd1', event: 'Yoga', day: null, detail: 'every Tuesday at 19:00' }],
            pieces: [],
          },
        }),
      ]),
    ])
    expect(text).toContain('d1 "Yoga" · day - · detail every Tuesday at 19:00')
  })

  it('marks split children and prints their own text, status and score', () => {
    expect(report).toContain('split child')
    expect(report).toContain('text:     Book train to Hamburg')
    expect(report).toContain('review:   pending_audit · score -')
  })

  it('says why the audit input is unavailable instead of failing the report', () => {
    const text = formatSmokeReport([
      capture(1, [
        thought({
          audit: null,
          auditInputError:
            '[capture-review] recurrence rule uses BYSETPOS, which the audit cannot express',
        }),
      ]),
    ])
    expect(text).toContain(
      'audit input: unavailable ([capture-review] recurrence rule uses BYSETPOS, which the audit cannot express)',
    )
  })

  it('says so when a thought has no review, with the enrichment state', () => {
    const text = formatSmokeReport([
      capture(1, [
        thought({
          review: null,
          enrichQueueStatus: 'failed',
          enrichQueueError: 'Ingest failed after 4 attempts',
          audit: null,
        }),
      ]),
    ])
    expect(text).toContain('review:   none (enrichment failed: Ingest failed after 4 attempts)')
    expect(text).toContain('audit input: none')
  })

  it('prints the audit error of a failed audit', () => {
    const text = formatSmokeReport([
      capture(1, [
        thought({
          review: {
            status: 'audit_failed',
            score: null,
            auditError: 'Audit given up after 4 attempts at step "decision_model".',
            parts: [],
          },
        }),
      ]),
    ])
    expect(text).toContain('review:   audit_failed · score -')
    expect(text).toContain('error:    Audit given up after 4 attempts at step "decision_model".')
  })

  it('ends with the totals and the result line', () => {
    expect(report).toContain('=== Totals')
    expect(report).toContain('captures: 2 · thoughts: 3 (1 split child)')
    expect(report).toContain(
      'reviews:  3 · scored 2 · pending_audit 1 · audit_failed 0 · no review 0',
    )
    expect(report).toContain('score:    min 0.7340 · median 0.7340 (over 2 scored)')
    expect(report).toContain('result:   FAIL · 1 of 3 thoughts has no scored review')
  })

  it('counts several split children in the plural', () => {
    const text = formatSmokeReport([
      capture(1, [
        scored(0.8),
        { ...scored(0.7), splitChild: true },
        { ...scored(0.9), splitChild: true },
      ]),
    ])
    expect(text).toContain('captures: 1 · thoughts: 3 (2 split children)')
  })

  it('reports OK when everything is scored', () => {
    const text = formatSmokeReport([capture(1, [scored(0.8), scored(0.4)])])
    expect(text).toContain('score:    min 0.4000 · median 0.6000 (over 2 scored)')
    expect(text).toContain('captures: 1 · thoughts: 2\n')
    expect(text).toContain('result:   OK · every thought has a scored review')
  })

  it('writes no score line figures when nothing is scored', () => {
    const text = formatSmokeReport([capture(1, [thought({ review: null })])])
    expect(text).toContain('score:    n/a (nothing scored)')
    expect(text).toContain('result:   FAIL · 1 of 1 thought has no scored review')
  })
})
