/**
 * Turns Jev's answers to an audit request into `jev_audit` review parts
 * (docs/planning/capture-feedback.md §4, §5).
 *
 * Each question becomes one part. Its probability is Jev's probability of the GOOD answer
 * (`right`, or `none_missing` for the missing-names and missing-dates questions), not of the answer
 * it chose, so a low value always means "probably wrong" and the score can be the lowest value over
 * the scored parts.
 * Parts hold the question id as `ref` and Jev's criteria key as `label`: no user text.
 */

import type { DecisionChoiceAnswer, DecisionRequest } from '$lib/server/llm/decision-client'
import {
  AUDIT_QUESTION_MISSING_DATES,
  AUDIT_QUESTION_MISSING_NAMES,
  AUDIT_QUESTION_PIECES_COVER,
  AUDIT_QUESTION_WORDING,
} from './audit-questions'
import {
  parseCaptureReviewParts,
  type CaptureReviewPart,
  type ReviewAuditPart,
} from './review-parts'

function fail(message: string): never {
  throw new Error(`[capture-review] audit result: ${message}`)
}

/** The audit part a question id names: `wording`, `name:n1` -> `name`, `pieces_cover`, ... */
function partOfQuestion(id: string): ReviewAuditPart {
  if (id === AUDIT_QUESTION_WORDING) return 'wording'
  if (id === AUDIT_QUESTION_MISSING_NAMES) return 'missing_names'
  if (id === AUDIT_QUESTION_MISSING_DATES) return 'missing_dates'
  if (id === AUDIT_QUESTION_PIECES_COVER) return 'pieces_cover'
  const prefix = id.slice(0, id.indexOf(':'))
  if (id.includes(':') && (prefix === 'name' || prefix === 'date' || prefix === 'piece')) {
    return prefix
  }
  return fail('unknown audit question')
}

/** The criteria key that means "this part is fine". */
function goodAnswer(part: ReviewAuditPart): string {
  return part === 'missing_names' || part === 'missing_dates' ? 'none_missing' : 'right'
}

export function auditPartsFromAnswers(
  request: DecisionRequest,
  answers: Map<string, DecisionChoiceAnswer>,
): CaptureReviewPart[] {
  const parts: CaptureReviewPart[] = []
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = answers.get(id)
    if (!answer) fail(`no answer for question "${id}"`)
    if (!Object.hasOwn(question.criteria, answer.choice)) {
      fail(`question "${id}" returned off-catalog choice "${answer.choice}"`)
    }
    const part = partOfQuestion(id)
    const good = goodAnswer(part)
    const probability = answer.probabilities[good]
    if (typeof probability !== 'number') {
      fail(`question "${id}" has no probability for "${good}"`)
    }
    parts.push({ part, ref: id, engine: 'jev_audit', label: answer.choice, probability })
  }
  return parseCaptureReviewParts(parts)
}
