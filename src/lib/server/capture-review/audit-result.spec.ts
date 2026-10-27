import { describe, expect, it } from 'vitest'
import type { DecisionChoiceAnswer, DecisionRequest } from '$lib/server/llm/decision-client'
import { buildCaptureAuditRequest, type CaptureAuditInput } from './audit-questions'
import { auditPartsFromAnswers } from './audit-result'
import { parseCaptureReviewParts } from './review-parts'

const input: CaptureAuditInput = {
  capturedAt: '2026-11-04T09:15:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: 'Dentist Friday 9am, ask Anna for a ride',
  storedText: 'Dentist on Friday at 9am. Ask Anna for a ride.',
  names: [{ ref: 'n1', surface: 'Anna' }],
  dates: [{ ref: 'd1', event: 'Dentist', day: '2026-11-06', detail: 'at 09:00' }],
  pieces: [
    { ref: 'p1', text: 'Dentist on Friday at 9am' },
    { ref: 'p2', text: 'Ask Anna for a ride' },
  ],
}

const request: DecisionRequest = buildCaptureAuditRequest(input)

function answer(choice: string, probabilities: Record<string, number>): DecisionChoiceAnswer {
  return { type: 'choice', choice, probabilities, confidence: probabilities[choice] ?? 0.5 }
}

/** Jev answers the good label for every question with the given probability. */
function allGood(p = 0.95): Map<string, DecisionChoiceAnswer> {
  const answers = new Map<string, DecisionChoiceAnswer>()
  for (const id of Object.keys(request.questions)) {
    const missing = id === 'missing_names' || id === 'missing_dates'
    const good = missing ? 'none_missing' : 'right'
    const bad = missing ? 'something_missing' : 'wrong'
    answers.set(id, answer(good, { [good]: p, [bad]: 1 - p }))
  }
  return answers
}

describe('auditPartsFromAnswers', () => {
  it('makes one jev_audit part per question, in question order, named after the question kind', () => {
    const parts = auditPartsFromAnswers(request, allGood())

    expect(parts.map((p) => [p.part, p.ref])).toEqual([
      ['wording', 'wording'],
      ['name', 'name:n1'],
      ['missing_names', 'missing_names'],
      ['date', 'date:d1'],
      ['missing_dates', 'missing_dates'],
      ['piece', 'piece:p1'],
      ['piece', 'piece:p2'],
      ['pieces_cover', 'pieces_cover'],
    ])
    for (const part of parts) expect(part.engine).toBe('jev_audit')
  })

  it("carries Jev's choice as the label and P(good answer) as the probability", () => {
    const parts = auditPartsFromAnswers(request, allGood(0.9))
    expect(parts[0]).toEqual({
      part: 'wording',
      ref: 'wording',
      engine: 'jev_audit',
      label: 'right',
      probability: 0.9,
    })
    expect(parts[2]).toMatchObject({
      part: 'missing_names',
      label: 'none_missing',
      probability: 0.9,
    })
  })

  it('uses the probability of the GOOD answer even when Jev chose the bad one (low means probably wrong)', () => {
    const answers = allGood()
    answers.set('date:d1', answer('wrong', { right: 0.08, wrong: 0.92 }))
    answers.set(
      'missing_names',
      answer('something_missing', { none_missing: 0.31, something_missing: 0.69 }),
    )
    answers.set(
      'missing_dates',
      answer('something_missing', { none_missing: 0.12, something_missing: 0.88 }),
    )

    const parts = auditPartsFromAnswers(request, answers)

    expect(parts.find((p) => p.ref === 'date:d1')).toMatchObject({
      label: 'wrong',
      probability: 0.08,
    })
    expect(parts.find((p) => p.ref === 'missing_names')).toMatchObject({
      label: 'something_missing',
      probability: 0.31,
    })
    expect(parts.find((p) => p.ref === 'missing_dates')).toMatchObject({
      part: 'missing_dates',
      label: 'something_missing',
      probability: 0.12,
    })
  })

  it('produces parts that pass the strict part schema and hold no thought text', () => {
    const parts = auditPartsFromAnswers(request, allGood())
    expect(parseCaptureReviewParts(parts)).toEqual(parts)
    const json = JSON.stringify(parts)
    for (const text of ['Anna', 'Dentist', 'ride', 'Friday']) expect(json).not.toContain(text)
  })

  it('asks no more than the request asked: a capture without names, dates or pieces has the two base questions (missing names, missing dates)', () => {
    const plain = buildCaptureAuditRequest({
      ...input,
      storedText: input.rawText,
      names: [],
      dates: [],
      pieces: [],
    })
    const answers = new Map([
      ['missing_names', answer('none_missing', { none_missing: 0.97, something_missing: 0.03 })],
      ['missing_dates', answer('something_missing', { none_missing: 0.2, something_missing: 0.8 })],
    ])
    expect(auditPartsFromAnswers(plain, answers)).toEqual([
      {
        part: 'missing_names',
        ref: 'missing_names',
        engine: 'jev_audit',
        label: 'none_missing',
        probability: 0.97,
      },
      {
        part: 'missing_dates',
        ref: 'missing_dates',
        engine: 'jev_audit',
        label: 'something_missing',
        probability: 0.2,
      },
    ])
  })

  it('throws when a question has no answer', () => {
    const answers = allGood()
    answers.delete('date:d1')
    expect(() => auditPartsFromAnswers(request, answers)).toThrow(
      /no answer for question "date:d1"/,
    )
  })

  it("throws when the choice is not one of the question's own criteria keys", () => {
    const answers = allGood()
    answers.set('missing_names', answer('right', { right: 0.9 }))
    expect(() => auditPartsFromAnswers(request, answers)).toThrow(
      /question "missing_names".*off-catalog choice "right"/,
    )
  })

  it('throws when missing_dates is answered with a label of the right/wrong questions', () => {
    const answers = allGood()
    answers.set('missing_dates', answer('right', { right: 0.9 }))
    expect(() => auditPartsFromAnswers(request, answers)).toThrow(
      /question "missing_dates".*off-catalog choice "right"/,
    )
  })

  it('throws when Jev gave no probability for the good answer', () => {
    const answers = allGood()
    answers.set('wording', answer('wrong', { wrong: 0.9 }))
    expect(() => auditPartsFromAnswers(request, answers)).toThrow(
      /question "wording".*no probability for "right"/,
    )
  })

  it('throws on a question id it does not know how to name', () => {
    const odd: DecisionRequest = {
      state: 'x',
      questions: {
        'mood:m1': { type: 'choice', instructions: 'q', criteria: { right: 'r', wrong: 'w' } },
      },
    }
    const answers = new Map([['mood:m1', answer('right', { right: 0.9, wrong: 0.1 })]])
    expect(() => auditPartsFromAnswers(odd, answers)).toThrow(/unknown audit question/)
  })
})
