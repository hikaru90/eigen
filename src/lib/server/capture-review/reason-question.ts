/**
 * Capture reason label: the one question Jev answers about a 👎 reason
 * (docs/planning/capture-feedback.md §6). Pure: builds the Decisions request, does no I/O.
 *
 * The reason text is what the user typed; Jev names the kind of mistake it describes, and only that
 * closed label is ever aggregated. No string rules decide the kind: every call is Jev's.
 */

import type { DecisionRequest } from '$lib/server/llm/decision-client'

export const CAPTURE_REASON_QUESTION_ID = 'reason'

export const CAPTURE_REASON_KINDS = [
  'wrong_category',
  'wrong_name',
  'wrong_link',
  'wrong_date',
  'wording_changed',
  'split_wrong',
  'something_missing',
  'not_worth_keeping',
  'other',
] as const

export type CaptureReasonKind = (typeof CAPTURE_REASON_KINDS)[number]

export const CAPTURE_REASON_CRITERIA: Readonly<Record<CaptureReasonKind, string>> = {
  wrong_category:
    'The thought was stored as the wrong kind — for example a task that is an idea, a note that is an event.',
  wrong_name:
    'A person, place, organisation or project is wrong, misspelled, invented, or missing from what was stored.',
  wrong_link:
    'A name was linked to the wrong existing person, place or project (the wrong Anna), or two different ones were treated as the same.',
  wrong_date: 'A date, time, deadline or repetition is wrong or missing.',
  wording_changed:
    "The stored text changed what the user said — something added, dropped or reworded so that the meaning changed (for example 'maybe' became a must).",
  split_wrong:
    'The capture was split wrongly: split when it should be one thought, not split when it should be several, or split in the wrong places.',
  something_missing:
    'Something else the user said was not kept at all (not a name or a date — those have their own kinds).',
  not_worth_keeping: 'The user says this should not have been stored at all.',
  other: 'Anything else, or the user does not say what was wrong.',
}

export type CaptureReasonInput = {
  /** What the user captured. */
  rawText: string
  /** How Eigen stored it, in words (category, names, dates, split). No ids. */
  storedSummary: string
  /** What the user says was wrong. */
  reason: string
}

function requireText(value: string, field: keyof CaptureReasonInput): void {
  if (value.trim() === '') throw new Error(`[capture-review] reason: ${field} must not be empty`)
}

export function buildCaptureReasonRequest(input: CaptureReasonInput): DecisionRequest {
  requireText(input.rawText, 'rawText')
  requireText(input.storedSummary, 'storedSummary')
  requireText(input.reason, 'reason')

  const state = [
    'The user captured:',
    '<<<capture',
    input.rawText,
    'capture>>>',
    `Eigen stored it as: ${input.storedSummary}`,
    'The user says this is wrong:',
    '<<<reason',
    input.reason,
    'reason>>>',
  ].join('\n')

  return {
    state,
    questions: {
      [CAPTURE_REASON_QUESTION_ID]: {
        type: 'choice',
        instructions: 'What kind of mistake does the user describe?',
        criteria: { ...CAPTURE_REASON_CRITERIA },
      },
    },
  }
}
