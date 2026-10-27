/**
 * Capture audit: the questions Jev answers about what the chat model wrote for a capture
 * (docs/planning/capture-feedback.md §4). Pure: builds the Decisions request, does no I/O.
 *
 * Jev judges four things the chat model wrote: the stored wording, the names it found (and whether
 * one is missing), the dates it took from the text, and the pieces a capture was split into. The
 * criteria below are the product contract for those judgments, tuned with `npm run jev:check`
 * (evals/jev-check) before anything is wired. The capture date and time zone go into the state so a
 * relative time ("Friday", "tomorrow") can be checked against the day the user wrote it.
 *
 * No string rules decide meaning here: every semantic call is Jev's. This code only formats the
 * question text and validates the shape of its input.
 */

import type { DecisionChoiceQuestion, DecisionRequest } from '$lib/server/llm/decision-client'

export type CaptureAuditInput = {
  /** When the user captured the thought: ISO 8601 with an offset or Z. */
  capturedAt: string
  /** IANA time zone the capture date and time are shown in, e.g. Europe/Berlin. */
  timezone: string
  /** What the user wrote. */
  rawText: string
  /** What Eigen stored as the thought's text. */
  storedText: string
  /** Names the chat model found. */
  names: Array<{ ref: string; surface: string }>
  /** Dates the chat model took from the text; `when` is human-readable and already resolved. */
  dates: Array<{ ref: string; event: string; when: string }>
  /** Pieces the capture was split into; empty when it was not split. */
  pieces: Array<{ ref: string; text: string }>
}

export const AUDIT_QUESTION_WORDING = 'wording'
export const AUDIT_QUESTION_MISSING_NAMES = 'missing_names'
export const AUDIT_QUESTION_PIECES_COVER = 'pieces_cover'

export const auditNameQuestionId = (ref: string): string => `name:${ref}`
export const auditDateQuestionId = (ref: string): string => `date:${ref}`
export const auditPieceQuestionId = (ref: string): string => `piece:${ref}`

export const AUDIT_CRITERIA_WORDING: Readonly<Record<'right' | 'wrong', string>> = {
  right:
    'The stored wording says the same as what the user wrote. Fixing typos, punctuation, filler words or speech-to-text slips, or rephrasing for clarity, is fine as long as nothing is added, dropped or changed in meaning.',
  wrong:
    "The stored wording adds something the user did not say, drops something they did say, or changes what they meant (a different person, time, amount or place, or a stronger or weaker claim — 'maybe' turned into a plan, 'I think' turned into a fact).",
}

export const AUDIT_CRITERIA_NAME: Readonly<Record<'right' | 'wrong', string>> = {
  right:
    'The capture mentions this person, place, organisation, project or thing, by this name or a clear variant of it (a nickname, another spelling, a possessive such as "Anna\'s", a family role used as a name such as "Mom").',
  wrong:
    'The capture does not mention it: the name is invented, misread, or a common word mistaken for a name.',
}

export const AUDIT_CRITERIA_MISSING_NAMES: Readonly<
  Record<'none_missing' | 'something_missing', string>
> = {
  none_missing:
    'Every person, place, organisation and project the capture names is in the list (variants of the same name count as found). A family role used as a name ("Mom", "Papa", "Oma") counts as a name. Generic words without a name — "the doctor", "work", "the team lead", "the cabin" — do not count.',
  something_missing:
    'The capture names at least one person, place, organisation or project that is not in the list.',
}

export const AUDIT_CRITERIA_DATE: Readonly<Record<'right' | 'wrong', string>> = {
  right:
    'The capture says this event is at this time. A relative time ("Friday", "tomorrow", "next week", "before 6pm" with no day meaning today) counts as right when it resolves to this time from the capture date — use the calendar above to resolve weekday names and relative days. A repeating time counts as right when the capture says it repeats.',
  wrong:
    'The capture gives a different time for this event, gives no time for it at all, or does not contain this event.',
}

export const AUDIT_CRITERIA_PIECE: Readonly<Record<'right' | 'wrong', string>> = {
  right:
    "The piece is one complete thing from the capture — a task, an event, an idea, a fact or a note — that can be read on its own, in the user's words or a faithful rewording. Leaving out a detail is not a reason to call the piece wrong.",
  wrong:
    'The piece is a fragment that makes no sense on its own (a greeting, a sign-off, half a sentence), mixes unrelated things, or says something the capture does not.',
}

export const AUDIT_CRITERIA_PIECES_COVER: Readonly<Record<'right' | 'wrong', string>> = {
  right:
    'Everything of substance in the capture is in at least one of the thoughts. Greetings, filler and repetition may be left out. Judge only whether something is lost: a piece that is a fragment or should not exist does not make this wrong — each piece is judged on its own.',
  wrong:
    'Something of substance in the capture — a task, a fact, a date, a person, an amount or a reason — is in none of the thoughts.',
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

function fail(message: string): never {
  throw new Error(`[capture-review] audit: ${message}`)
}

function requireText(value: string, field: string): void {
  if (value.trim() === '') fail(`${field} must not be empty`)
}

function requireRefs(list: string, refs: string[]): void {
  const seen = new Set<string>()
  refs.forEach((ref, i) => {
    requireText(ref, `${list}[${i}].ref`)
    if (/\s/.test(ref)) fail(`${list}[${i}].ref must not contain whitespace, got "${ref}"`)
    if (seen.has(ref)) fail(`${list} refs must be unique, "${ref}" appears more than once`)
    seen.add(ref)
  })
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone })
  } catch {
    fail(`timezone must be a valid IANA time zone, got "${timezone}"`)
  }
}

function validate(input: CaptureAuditInput): void {
  requireText(input.rawText, 'rawText')
  requireText(input.storedText, 'storedText')
  if (!ISO_WITH_OFFSET.test(input.capturedAt) || Number.isNaN(Date.parse(input.capturedAt))) {
    fail(`capturedAt must be an ISO 8601 date-time with an offset or Z, got "${input.capturedAt}"`)
  }
  validateTimezone(input.timezone)

  requireRefs(
    'names',
    input.names.map((n) => n.ref),
  )
  input.names.forEach((n, i) => requireText(n.surface, `names[${i}].surface`))

  requireRefs(
    'dates',
    input.dates.map((d) => d.ref),
  )
  input.dates.forEach((d, i) => {
    requireText(d.event, `dates[${i}].event`)
    requireText(d.when, `dates[${i}].when`)
  })

  if (input.pieces.length === 1) {
    fail(`pieces must be empty or have at least 2 entries, got ${input.pieces.length}`)
  }
  requireRefs(
    'pieces',
    input.pieces.map((p) => p.ref),
  )
  input.pieces.forEach((p, i) => requireText(p.text, `pieces[${i}].text`))
}

/** Days in the calendar of the state: the capture day and the 13 after it. */
const CALENDAR_DAYS = 14

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((p) => p.type === type)
  if (!found) throw new Error(`[capture-review] audit: no ${type} in the formatted capture date`)
  return found.value
}

/** "Tuesday 27 October 2026" in the given zone; parts are joined here so ICU punctuation cannot vary. */
function formatDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(instant)
  return [
    part(parts, 'weekday'),
    part(parts, 'day'),
    part(parts, 'month'),
    part(parts, 'year'),
  ].join(' ')
}

/** "Tuesday 27 October 2026 at 10:00" in the given zone. */
function formatCapturedOn(capturedAt: string, timezone: string): string {
  const instant = new Date(capturedAt)
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  return `${formatDay(instant, timezone)} at ${part(clock, 'hour')}:${part(clock, 'minute')}`
}

/**
 * The capture day and the 13 days after it, one line each, so a relative day ("Friday",
 * "tomorrow", "Mittwoch") can be read off instead of computed. Deterministic: the capture day is
 * the calendar date in the capture time zone, and each next day is that date plus one in plain
 * calendar arithmetic (UTC midday carries no daylight-saving shift).
 */
function formatCalendar(capturedAt: string, timezone: string): string {
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(capturedAt))
  const year = Number(part(local, 'year'))
  const month = Number(part(local, 'month'))
  const day = Number(part(local, 'day'))

  const lines = ['Calendar from the capture day on:']
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const label = formatDay(new Date(Date.UTC(year, month - 1, day + i, 12)), 'UTC')
    const note = i === 0 ? ' (today, the capture day)' : i === 1 ? ' (tomorrow)' : ''
    lines.push(`- ${label}${note}`)
  }
  return lines.join('\n')
}

function question(
  instructions: string,
  criteria: Readonly<Record<string, string>>,
): DecisionChoiceQuestion {
  return { type: 'choice', instructions, criteria: { ...criteria } }
}

/**
 * The Decisions request that audits one capture. Question ids: `wording` (only when the stored text
 * differs from what the user wrote), `name:{ref}`, `missing_names`, `date:{ref}`, `piece:{ref}` and
 * `pieces_cover` (the last two only when the capture was split), in that order.
 */
export function buildCaptureAuditRequest(input: CaptureAuditInput): DecisionRequest {
  validate(input)

  const stateLines = [
    `Captured on ${formatCapturedOn(input.capturedAt, input.timezone)} (${input.timezone}).`,
    'The user wrote:',
    '<<<capture',
    input.rawText,
    'capture>>>',
  ]
  // Jev cannot do calendar arithmetic ("Friday" from a Tuesday): with a date question it reads the day off a calendar.
  if (input.dates.length > 0) stateLines.push(formatCalendar(input.capturedAt, input.timezone))
  const state = stateLines.join('\n')

  const questions: Record<string, DecisionChoiceQuestion> = {}

  if (input.storedText.trim() !== input.rawText.trim()) {
    questions[AUDIT_QUESTION_WORDING] = question(
      `Eigen stored the capture with this wording:\n<<<stored\n${input.storedText}\nstored>>>\nDoes the stored wording say what the user wrote?`,
      AUDIT_CRITERIA_WORDING,
    )
  }

  for (const name of input.names) {
    questions[auditNameQuestionId(name.ref)] = question(
      `Eigen found the name "${name.surface}" in the capture. Does the capture mention "${name.surface}"?`,
      AUDIT_CRITERIA_NAME,
    )
  }

  const found =
    input.names.length > 0 ? input.names.map((n) => `"${n.surface}"`).join(', ') : 'none'
  questions[AUDIT_QUESTION_MISSING_NAMES] = question(
    `Eigen found these names in the capture: ${found}. Does the capture name a person, place, organisation or project that is missing from this list?`,
    AUDIT_CRITERIA_MISSING_NAMES,
  )

  for (const date of input.dates) {
    questions[auditDateQuestionId(date.ref)] = question(
      `Eigen stored: "${date.event}" — ${date.when}. Does the capture say that?`,
      AUDIT_CRITERIA_DATE,
    )
  }

  if (input.pieces.length > 0) {
    for (const piece of input.pieces) {
      questions[auditPieceQuestionId(piece.ref)] = question(
        `Eigen stored this part of the capture as its own thought:\n<<<piece\n${piece.text}\npiece>>>\nIs this a complete thought from the capture?`,
        AUDIT_CRITERIA_PIECE,
      )
    }
    const numbered = input.pieces.map((p, i) => `${i + 1}. ${p.text}`).join('\n')
    questions[AUDIT_QUESTION_PIECES_COVER] = question(
      `Eigen split the capture into these ${input.pieces.length} thoughts:\n${numbered}\nDo they keep everything the capture says?`,
      AUDIT_CRITERIA_PIECES_COVER,
    )
  }

  return { state, questions }
}
