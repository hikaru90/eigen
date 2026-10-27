import { describe, expect, it } from 'vitest'
import {
  CAPTURE_REASON_CRITERIA,
  CAPTURE_REASON_KINDS,
  CAPTURE_REASON_QUESTION_ID,
  buildCaptureReasonRequest,
  type CaptureReasonInput,
} from './reason-question'

const INPUT: CaptureReasonInput = {
  rawText: 'Call Mom on Friday',
  storedSummary: 'Saved as a task · about Mom · due Thu 29 Oct',
  reason: 'wrong day, I said friday',
}

describe('CAPTURE_REASON_KINDS', () => {
  it('lists the nine kinds in the plan order', () => {
    expect(CAPTURE_REASON_KINDS).toEqual([
      'wrong_category',
      'wrong_name',
      'wrong_link',
      'wrong_date',
      'wording_changed',
      'split_wrong',
      'something_missing',
      'not_worth_keeping',
      'other',
    ])
  })

  it('has one criterion per kind, in the same order', () => {
    expect(Object.keys(CAPTURE_REASON_CRITERIA)).toEqual([...CAPTURE_REASON_KINDS])
    for (const text of Object.values(CAPTURE_REASON_CRITERIA))
      expect(text.trim().length).toBeGreaterThan(20)
  })

  it('names the decisive cases', () => {
    expect(CAPTURE_REASON_CRITERIA.wrong_link).toContain('the wrong Anna')
    expect(CAPTURE_REASON_CRITERIA.wording_changed).toContain("'maybe' became a must")
    expect(CAPTURE_REASON_CRITERIA.something_missing).toContain(
      'names and dates have their own kinds',
    )
  })

  // Tuned against the live check: pinned word for word so a change is deliberate. The two kinds
  // overlapped when wording_changed said "dropped"; now a left-out detail is something_missing only.
  it('wording_changed is for a different meaning, not for details that were only left out', () => {
    expect(CAPTURE_REASON_CRITERIA.wording_changed).toBe(
      "The stored text says something different from what the user said — reworded, added to, or made stronger or weaker so that the meaning changed (for example 'maybe' became a must). Not for details that were only left out.",
    )
    expect(CAPTURE_REASON_CRITERIA.wording_changed).not.toContain('dropped')
  })

  it('something_missing is a left-out detail while the rest is right', () => {
    expect(CAPTURE_REASON_CRITERIA.something_missing).toBe(
      'A detail the user said was left out of what was stored — a reason, an amount, a condition, a place — while the rest is right (names and dates have their own kinds).',
    )
  })
})

describe('buildCaptureReasonRequest', () => {
  it('quotes what the user captured, how Eigen stored it and the reason', () => {
    expect(buildCaptureReasonRequest(INPUT).state).toBe(
      [
        'The user captured:',
        '<<<capture',
        'Call Mom on Friday',
        'capture>>>',
        'Eigen stored it as: Saved as a task · about Mom · due Thu 29 Oct',
        'The user says this is wrong:',
        '<<<reason',
        'wrong day, I said friday',
        'reason>>>',
      ].join('\n'),
    )
  })

  it('asks exactly one choice question, "reason"', () => {
    const request = buildCaptureReasonRequest(INPUT)
    expect(CAPTURE_REASON_QUESTION_ID).toBe('reason')
    expect(Object.keys(request.questions)).toEqual(['reason'])
    expect(request.questions.reason.type).toBe('choice')
    expect(request.questions.reason.instructions).toBe(
      'What kind of mistake does the user describe?',
    )
    expect(request.questions.reason.criteria).toEqual(CAPTURE_REASON_CRITERIA)
    expect(Object.keys(request.questions.reason.criteria)).toEqual([...CAPTURE_REASON_KINDS])
  })

  it('hands out a copy of the criteria', () => {
    const before = { ...CAPTURE_REASON_CRITERIA }
    buildCaptureReasonRequest(INPUT).questions.reason.criteria.other = 'changed'
    expect(CAPTURE_REASON_CRITERIA).toEqual(before)
  })

  it('passes German text through untouched', () => {
    const request = buildCaptureReasonRequest({
      rawText: 'Morgen Oma anrufen',
      storedSummary: 'Gespeichert als Aufgabe · über Oma Ilse · fällig Mi 28. Okt',
      reason: 'falsche Oma, ich meinte Oma Gerda',
    })
    expect(request.state).toContain('<<<capture\nMorgen Oma anrufen\ncapture>>>')
    expect(request.state).toContain(
      'Eigen stored it as: Gespeichert als Aufgabe · über Oma Ilse · fällig Mi 28. Okt',
    )
    expect(request.state).toContain('<<<reason\nfalsche Oma, ich meinte Oma Gerda\nreason>>>')
  })

  describe('validation', () => {
    it('rejects an empty rawText', () => {
      expect(() => buildCaptureReasonRequest({ ...INPUT, rawText: ' ' })).toThrow(
        '[capture-review] reason: rawText must not be empty',
      )
    })

    it('rejects an empty storedSummary', () => {
      expect(() => buildCaptureReasonRequest({ ...INPUT, storedSummary: '' })).toThrow(
        '[capture-review] reason: storedSummary must not be empty',
      )
    })

    it('rejects an empty reason', () => {
      expect(() => buildCaptureReasonRequest({ ...INPUT, reason: '\n\t' })).toThrow(
        '[capture-review] reason: reason must not be empty',
      )
    })
  })
})
