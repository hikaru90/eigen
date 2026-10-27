/**
 * Capture audit: the questions Jev answers about what the chat model wrote for a capture
 * (docs/planning/capture-feedback.md §4). Pure: builds the Decisions request, does no I/O.
 *
 * Jev judges four things the chat model wrote: the stored wording, the names it found (and whether
 * one is missing), the dates it took from the text (and whether one is missing), and the pieces a
 * capture was split into. The criteria below are the product contract for those judgments, tuned
 * with `npm run jev:check` (evals/jev-check) before anything is wired. The state names the day and
 * time the user wrote; each date question says when Eigen stored the event as a distance from that
 * capture day ("the Friday after the capture day (3 days later)"), computed here, because Jev
 * cannot do calendar arithmetic.
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
  /**
   * Dates the chat model took from the text. `day` is the stored calendar day (YYYY-MM-DD, in the
   * capture time zone) or null; `detail` is plain extra words ("at 09:00", "before 18:00", "as the
   * deadline", "every Tuesday at 19:00") or null. At least one of the two is given.
   */
  dates: Array<{ ref: string; event: string; day: string | null; detail: string | null }>
  /** Pieces the capture was split into; empty when it was not split. */
  pieces: Array<{ ref: string; text: string }>
}

export const AUDIT_QUESTION_WORDING = 'wording'
export const AUDIT_QUESTION_MISSING_NAMES = 'missing_names'
export const AUDIT_QUESTION_MISSING_DATES = 'missing_dates'
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
    'Yes: the capture\'s own time words for this event ("Friday", "tomorrow", "Mittwoch", "today", "before 6pm", "every Tuesday") point to this time. A vague time in the capture ("next week", "end of November", "in spring") is right when the stored time falls within it.',
  wrong:
    "No: the capture's time words point to a different day or time, the capture gives no time for this event, the event is not in the capture, or the capture says it repeats and the stored time does not repeat (or the other way round).",
}

/**
 * missing_dates when Eigen stored no time at all: does the capture give any? Asked about the
 * capture alone, because "is a time missing from this (empty) list?" made Jev shaky.
 */
export const AUDIT_CRITERIA_MISSING_DATES_NONE_STORED: Readonly<
  Record<'none_missing' | 'something_missing', string>
> = {
  none_missing:
    'No: the capture gives no day, time, deadline or repetition. Words that do not fix a time — "soon", "sometimes", "lately", "more often", "again" — do not count.',
  something_missing:
    'Yes: the capture gives at least one day, time, deadline or repetition ("on Friday at 9am", "every Tuesday", "by the end of November", "tomorrow", "today", "in March").',
}

/**
 * missing_dates when Eigen stored some times: does the capture give one for anything else? The
 * question names the stored events and no times, so a wrongly stored time is not read as a missing
 * one; comparing times is the date question's job.
 */
export const AUDIT_CRITERIA_MISSING_DATES_STORED: Readonly<
  Record<'none_missing' | 'something_missing', string>
> = {
  none_missing:
    'No: every time the capture gives belongs to one of these — whether or not Eigen stored it correctly does not matter here. Words that do not fix a time — "soon", "sometimes", "lately", "more often" — do not count.',
  something_missing:
    'Yes: the capture gives a day, time, deadline or repetition for something else as well.',
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
    if (d.day !== null) requireDay(d.day, `dates[${i}].day`)
    if (d.detail !== null && d.detail.trim() === '') {
      fail(`dates[${i}].detail must not be empty when given, or null`)
    }
    if (d.day === null && d.detail === null) {
      fail(`dates[${i}] needs a day or a detail, both are null`)
    }
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

type DayParts = { weekday: string; day: string; month: string; year: string }

/** A calendar date with no time of day and no zone. */
type CalendarDay = { year: number; month: number; day: number }

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((p) => p.type === type)
  if (!found) throw new Error(`[capture-review] audit: no ${type} in the formatted capture date`)
  return found.value
}

function dayParts(instant: Date, timeZone: string): DayParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(instant)
  return {
    weekday: part(parts, 'weekday'),
    day: part(parts, 'day'),
    month: part(parts, 'month'),
    year: part(parts, 'year'),
  }
}

/** "Tuesday 27 October 2026": parts are joined here so ICU punctuation cannot vary. */
function formatDay(d: DayParts): string {
  return `${d.weekday} ${d.day} ${d.month} ${d.year}`
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
  return `${formatDay(dayParts(instant, timezone))} at ${part(clock, 'hour')}:${part(clock, 'minute')}`
}

/** A real YYYY-MM-DD calendar date, or a loud failure naming the field. */
function requireDay(value: string, field: string): CalendarDay {
  const match = ISO_DAY.exec(value)
  if (match) {
    const day = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    const check = new Date(Date.UTC(day.year, day.month - 1, day.day))
    if (
      check.getUTCFullYear() === day.year &&
      check.getUTCMonth() === day.month - 1 &&
      check.getUTCDate() === day.day
    ) {
      return day
    }
  }
  return fail(`${field} must be a real calendar date as YYYY-MM-DD, or null, got "${value}"`)
}

/** The calendar date of the capture in the capture time zone. */
function captureDayOf(capturedAt: string, timezone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(capturedAt))
  return {
    year: Number(part(parts, 'year')),
    month: Number(part(parts, 'month')),
    day: Number(part(parts, 'day')),
  }
}

/** Whole days since the epoch for a calendar date: plain arithmetic on year-month-day, no zone, no DST. */
function dayNumber(d: CalendarDay): number {
  return Date.UTC(d.year, d.month - 1, d.day) / MS_PER_DAY
}

/**
 * Where a stored day lies relative to the capture day, in words Jev can read without calendar
 * arithmetic: the weekday for the next two weeks, the full date and the distance beyond that, and a
 * note when the day is the last of its month ("Ende November" resolved to 30 November).
 */
function describeDay(target: CalendarDay, captureDay: CalendarDay): string {
  const n = dayNumber(target) - dayNumber(captureDay)
  if (n === 0) return 'the capture day itself'
  if (n === 1) return 'the day after the capture day'
  if (n === -1) return 'the day before the capture day'

  const names = dayParts(new Date(Date.UTC(target.year, target.month - 1, target.day, 12)), 'UTC')
  if (n >= 2 && n <= 13) return `the ${names.weekday} after the capture day (${n} days later)`

  const lastDayOfMonth = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate()
  const lastDay = target.day === lastDayOfMonth ? `, the last day of ${names.month}` : ''
  return n >= 14
    ? `${formatDay(names)} (${n} days after the capture day${lastDay})`
    : `${formatDay(names)} (${-n} days before the capture day${lastDay})`
}

/**
 * When Eigen stored an event, in words: the stored day as a distance from the capture day, then
 * the detail ("the Friday after the capture day (3 days later) at 09:00"). Only the date question
 * says it; the missing_dates question names the events and no times.
 */
function datePhrase(date: CaptureAuditInput['dates'][number], captureDay: CalendarDay): string {
  return [
    date.day === null ? null : describeDay(requireDay(date.day, 'day'), captureDay),
    date.detail === null ? null : date.detail.trim(),
  ]
    .filter((piece) => piece !== null)
    .join(' ')
}

function question(
  instructions: string,
  criteria: Readonly<Record<string, string>>,
): DecisionChoiceQuestion {
  return { type: 'choice', instructions, criteria: { ...criteria } }
}

/**
 * The Decisions request that audits one capture. Question ids: `wording` (only when the stored text
 * differs from what the user wrote), `name:{ref}`, `missing_names`, `date:{ref}`, `missing_dates`,
 * `piece:{ref}` and `pieces_cover` (the last two only when the capture was split), in that order.
 * `missing_names` and `missing_dates` are always asked, even when nothing was found.
 */
export function buildCaptureAuditRequest(input: CaptureAuditInput): DecisionRequest {
  validate(input)

  const state = [
    `Captured on ${formatCapturedOn(input.capturedAt, input.timezone)} (${input.timezone}).`,
    'The user wrote:',
    '<<<capture',
    input.rawText,
    'capture>>>',
  ].join('\n')

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

  const captureDay = captureDayOf(input.capturedAt, input.timezone)
  for (const date of input.dates) {
    questions[auditDateQuestionId(date.ref)] = question(
      `Eigen stored "${date.event}" for ${datePhrase(date, captureDay)}. Does the capture put this event at that time?`,
      AUDIT_CRITERIA_DATE,
    )
  }

  // missing_dates names no stored time when there is one: it only asks whether the capture gives a
  // time for anything else (or, with nothing stored, for anything). The date questions compare times.
  questions[AUDIT_QUESTION_MISSING_DATES] =
    input.dates.length === 0
      ? question(
          'Eigen stored no times for this capture. Does the capture give a day, a time, a deadline or a repetition for anything?',
          AUDIT_CRITERIA_MISSING_DATES_NONE_STORED,
        )
      : question(
          `Eigen stored a time for: ${input.dates.map((d) => `"${d.event}"`).join('; ')}. Besides these, does the capture give a day, a time, a deadline or a repetition for anything else?`,
          AUDIT_CRITERIA_MISSING_DATES_STORED,
        )

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
