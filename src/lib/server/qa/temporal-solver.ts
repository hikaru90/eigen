/**
 * Deterministic timeline solver for ordering and duration questions.
 * Uses persisted temporal_event bounds — not LLM date arithmetic.
 */

import type { TemporalEventKind } from '$lib/server/db/brain.schema'
import { parseActivePeriodLiteral } from '$lib/server/memory/temporal-validity'
import type {
  DurationUnit,
  TemporalQuestionKind,
} from '$lib/server/retrieval/classify-query-intent'
import type { TemporalHintBinding } from '$lib/server/retrieval/resolve-temporal-hint-bindings'
import type { TemporalEventSeed } from '$lib/server/retrieval/temporal'

export type SolverTimelineEvent = {
  thoughtId: string
  label: string
  startAt: Date
  kind: TemporalEventKind
}

/** Reserved citation id for solver-derived ordering/duration facts in compose prompts. */
export const COMPUTED_TIMELINE_CITATION_ID = 'computed'

export type TemporalSolverResult = {
  kind: TemporalQuestionKind | 'unsupported'
  confidence: 'high' | 'low'
  events: SolverTimelineEvent[]
  ordering?: {
    earliest: SolverTimelineEvent
    latest: SolverTimelineEvent
  }
  multiOrdering?: {
    ordered: SolverTimelineEvent[]
  }
  durationDays?: {
    exclusive: number
    inclusive: number
    from: SolverTimelineEvent
    to: SolverTimelineEvent
    unit: DurationUnit
  }
  count?: {
    value: number
    anchor: SolverTimelineEvent
    before: SolverTimelineEvent[]
  }
  lookback?: {
    value: number
    unit: DurationUnit
    event: SolverTimelineEvent
  }
  span?: {
    years: number
    months: number
    from: SolverTimelineEvent
    to: SolverTimelineEvent
  }
}

const MS_PER_DAY = 86_400_000

export function calendarDaysBetweenExclusive(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.floor((toUtc - fromUtc) / MS_PER_DAY)
}

export function calendarDaysBetweenInclusive(from: Date, to: Date): number {
  return calendarDaysBetweenExclusive(from, to) + 1
}

export function calendarWeeksBetweenExclusive(from: Date, to: Date): number {
  return Math.floor(calendarDaysBetweenExclusive(from, to) / 7)
}

export function calendarMonthsBetweenExclusive(from: Date, to: Date): number {
  const fromYear = from.getUTCFullYear()
  const fromMonth = from.getUTCMonth()
  const toYear = to.getUTCFullYear()
  const toMonth = to.getUTCMonth()
  return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}

export function calendarMonthsBetweenInclusive(from: Date, to: Date): number {
  return calendarMonthsBetweenExclusive(from, to) + 1
}

export function calendarSpanBetweenExclusive(
  from: Date,
  to: Date,
): { years: number; months: number } {
  const totalMonths = calendarMonthsBetweenExclusive(from, to)
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12 }
}

export function resolveEventStartAt(seed: TemporalEventSeed): Date | null {
  if (seed.startAt && !Number.isNaN(seed.startAt.getTime())) {
    return seed.startAt
  }
  try {
    const { start } = parseActivePeriodLiteral(seed.activePeriod)
    return start
  } catch {
    return null
  }
}

export function seedsToTimelineEvents(seeds: TemporalEventSeed[]): SolverTimelineEvent[] {
  const events: SolverTimelineEvent[] = []
  for (const seed of seeds) {
    const startAt = resolveEventStartAt(seed)
    if (!startAt) continue
    events.push({
      thoughtId: seed.thoughtId,
      label: seed.semanticSummary.trim() || 'event',
      startAt,
      kind: seed.kind,
    })
  }
  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

function bindingForHint(
  hint: string,
  hintBindings: TemporalHintBinding[],
): TemporalHintBinding | undefined {
  const trimmed = hint.trim()
  return hintBindings.find((binding) => binding.hint.trim() === trimmed)
}

function eventForBinding(
  events: SolverTimelineEvent[],
  binding: TemporalHintBinding,
): SolverTimelineEvent | null {
  return events.find((event) => event.thoughtId === binding.thoughtId) ?? null
}

function pickEventsForHints(
  events: SolverTimelineEvent[],
  entityHints: string[],
  hintBindings: TemporalHintBinding[],
): SolverTimelineEvent[] {
  if (entityHints.length === 0) return events

  const matched: SolverTimelineEvent[] = []
  const usedThoughtIds = new Set<string>()

  for (const hint of entityHints) {
    const binding = bindingForHint(hint, hintBindings)
    if (!binding) continue
    const event = eventForBinding(events, binding)
    if (!event || usedThoughtIds.has(event.thoughtId)) continue
    matched.push(event)
    usedThoughtIds.add(event.thoughtId)
  }

  if (entityHints.length >= 2 && matched.length < 2) {
    return []
  }

  const pool = matched.length >= 2 ? matched : matched.length > 0 ? matched : events
  return [...pool].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

function pickAnchorEvent(
  events: SolverTimelineEvent[],
  entityHints: string[],
  hintBindings: TemporalHintBinding[],
): SolverTimelineEvent | null {
  if (entityHints.length === 0) return null
  const anchorHint = entityHints[entityHints.length - 1]!
  const binding = bindingForHint(anchorHint, hintBindings)
  if (!binding) return null
  return eventForBinding(events, binding)
}

function computeDurationBetween(
  earlier: SolverTimelineEvent,
  later: SolverTimelineEvent,
  unit: DurationUnit,
): number {
  const exclusiveDays = calendarDaysBetweenExclusive(earlier.startAt, later.startAt)
  if (unit === 'weeks') return calendarWeeksBetweenExclusive(earlier.startAt, later.startAt)
  if (unit === 'months') return calendarMonthsBetweenExclusive(earlier.startAt, later.startAt)
  return exclusiveDays
}

function formatDurationLabel(value: number, unit: DurationUnit): string {
  const unitLabel = value === 1 ? unit.slice(0, -1) : unit
  return `${value} calendar ${unitLabel}`
}

function formatSpanLabel(years: number, months: number): string {
  const parts: string[] = []
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`)
  if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' and ') : '0 months'
}

export function solveTemporalQuestion(input: {
  kind: TemporalQuestionKind
  entityHints: string[]
  seeds: TemporalEventSeed[]
  hintBindings?: TemporalHintBinding[]
  referenceTime?: Date
  durationUnit?: DurationUnit | null
}): TemporalSolverResult {
  const timeline = seedsToTimelineEvents(input.seeds)
  const hintBindings = input.hintBindings ?? []
  const unit = input.durationUnit ?? 'days'
  const referenceTime = input.referenceTime ?? new Date()

  if (timeline.length === 0) {
    return { kind: 'unsupported', confidence: 'low', events: [] }
  }

  if (input.kind === 'ordering') {
    const pool = pickEventsForHints(timeline, input.entityHints, hintBindings)
    if (pool.length < 2) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    const earliest = pool[0]!
    const latest = pool[pool.length - 1]!
    return {
      kind: 'ordering',
      confidence: 'high',
      events: timeline,
      ordering: { earliest, latest },
    }
  }

  if (input.kind === 'multi_ordering') {
    const pool = pickEventsForHints(timeline, input.entityHints, hintBindings)
    if (pool.length < 3) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    return {
      kind: 'multi_ordering',
      confidence: 'high',
      events: timeline,
      multiOrdering: { ordered: pool },
    }
  }

  if (input.kind === 'duration') {
    const pool = pickEventsForHints(timeline, input.entityHints, hintBindings)
    if (pool.length < 2) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    const from = pool[0]!
    const to = pool[pool.length - 1]!
    if (from.startAt.getTime() === to.startAt.getTime()) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    const [earlier, later] =
      from.startAt.getTime() <= to.startAt.getTime() ? [from, to] : [to, from]
    const exclusive = computeDurationBetween(earlier, later, unit)
    const inclusive =
      unit === 'days'
        ? calendarDaysBetweenInclusive(earlier.startAt, later.startAt)
        : unit === 'weeks'
          ? exclusive + 1
          : calendarMonthsBetweenInclusive(earlier.startAt, later.startAt)
    return {
      kind: 'duration',
      confidence: 'high',
      events: timeline,
      durationDays: { exclusive, inclusive, from: earlier, to: later, unit },
    }
  }

  if (input.kind === 'count') {
    const anchor = pickAnchorEvent(timeline, input.entityHints, hintBindings)
    if (!anchor) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    const seenThoughtIds = new Set<string>()
    const before: SolverTimelineEvent[] = []
    for (const event of timeline) {
      if (event.thoughtId === anchor.thoughtId) continue
      if (event.startAt.getTime() >= anchor.startAt.getTime()) continue
      if (seenThoughtIds.has(event.thoughtId)) continue
      seenThoughtIds.add(event.thoughtId)
      before.push(event)
    }
    return {
      kind: 'count',
      confidence: 'high',
      events: timeline,
      count: { value: before.length, anchor, before },
    }
  }

  if (input.kind === 'lookback') {
    const pool =
      input.entityHints.length > 0
        ? pickEventsForHints(timeline, input.entityHints, hintBindings)
        : timeline
    const event = pool[0] ?? timeline[0]
    if (!event) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    const lookbackUnit = unit === 'days' ? 'days' : unit === 'weeks' ? 'weeks' : 'months'
    const exclusiveDays = calendarDaysBetweenExclusive(event.startAt, referenceTime)
    let value: number
    if (lookbackUnit === 'weeks') {
      value = calendarWeeksBetweenExclusive(event.startAt, referenceTime)
    } else if (lookbackUnit === 'months') {
      value = calendarMonthsBetweenExclusive(event.startAt, referenceTime)
    } else {
      value = exclusiveDays
    }
    return {
      kind: 'lookback',
      confidence: 'high',
      events: timeline,
      lookback: { value, unit: lookbackUnit, event },
    }
  }

  if (input.kind === 'span') {
    const pool = pickEventsForHints(timeline, input.entityHints, hintBindings)
    if (pool.length < 2) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    const from = pool[0]!
    const to = pool[pool.length - 1]!
    const [earlier, later] =
      from.startAt.getTime() <= to.startAt.getTime() ? [from, to] : [to, from]
    if (earlier.startAt.getTime() === later.startAt.getTime()) {
      return { kind: 'unsupported', confidence: 'low', events: timeline }
    }
    const { years, months } = calendarSpanBetweenExclusive(earlier.startAt, later.startAt)
    return {
      kind: 'span',
      confidence: 'high',
      events: timeline,
      span: { years, months, from: earlier, to: later },
    }
  }

  return { kind: 'unsupported', confidence: 'low', events: timeline }
}

export function allowsComputedTimelineCitation(result: TemporalSolverResult): boolean {
  return result.confidence === 'high' && result.events.length > 0
}

export function formatComputedTimelineForPrompt(result: TemporalSolverResult): string {
  if (!allowsComputedTimelineCitation(result)) return ''

  const lines: string[] = [
    'Computed timeline (from temporal_event ledger — use these dates for Answer):',
    `Cite derived ordering or day-count conclusions with [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
  ]

  for (const event of result.events) {
    const dateLabel = event.startAt.toISOString().slice(0, 10)
    lines.push(`- ${dateLabel}: ${event.label} [id=${event.thoughtId}]`)
  }

  if (result.kind === 'ordering' && result.ordering) {
    const { earliest, latest } = result.ordering
    if (earliest.thoughtId !== latest.thoughtId) {
      lines.push(
        `Ordering: "${earliest.label}" (${earliest.startAt.toISOString().slice(0, 10)}) before "${latest.label}" (${latest.startAt.toISOString().slice(0, 10)})`,
      )
    }
  }

  if (result.kind === 'multi_ordering' && result.multiOrdering) {
    const ordered = result.multiOrdering.ordered
      .map((e) => `"${e.label}" (${e.startAt.toISOString().slice(0, 10)})`)
      .join(' → ')
    lines.push(`Ordering (earliest to latest): ${ordered}`)
  }

  if (result.kind === 'duration' && result.durationDays) {
    const { exclusive, inclusive, from, to, unit } = result.durationDays
    lines.push(
      `Duration between "${from.label}" (${from.startAt.toISOString().slice(0, 10)}) and "${to.label}" (${to.startAt.toISOString().slice(0, 10)}): ${exclusive} calendar ${unit} (exclusive) / ${inclusive} calendar ${unit} (inclusive)`,
    )
  }

  if (result.kind === 'count' && result.count) {
    const { value, anchor, before } = result.count
    lines.push(
      `Count before "${anchor.label}" (${anchor.startAt.toISOString().slice(0, 10)}): ${value} event(s)`,
    )
    for (const event of before) {
      lines.push(`  - ${event.label} (${event.startAt.toISOString().slice(0, 10)})`)
    }
  }

  if (result.kind === 'lookback' && result.lookback) {
    const { value, unit, event } = result.lookback
    lines.push(
      `Lookback: ${value} calendar ${unit} from "${event.label}" (${event.startAt.toISOString().slice(0, 10)}) to reference time`,
    )
  }

  if (result.kind === 'span' && result.span) {
    const { years, months, from, to } = result.span
    lines.push(
      `Span from "${from.label}" (${from.startAt.toISOString().slice(0, 10)}) to "${to.label}" (${to.startAt.toISOString().slice(0, 10)}): ${formatSpanLabel(years, months)}`,
    )
  }

  return `\n\n${lines.join('\n')}\n`
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Deterministic compose output when the solver has high confidence.
 * Avoids LLM reordering or day-count errors on ordering/duration questions.
 */
export function formatSolverAnswer(result: TemporalSolverResult): string | null {
  if (!allowsComputedTimelineCitation(result)) return null

  if (result.kind === 'ordering' && result.ordering) {
    const { earliest, latest } = result.ordering
    if (earliest.thoughtId === latest.thoughtId) return null
    const earliestDate = formatIsoDate(earliest.startAt)
    const latestDate = formatIsoDate(latest.startAt)
    return [
      `Answer: "${earliest.label}" came first (${earliestDate}) [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
      'Evidence:',
      `- ${earliest.label} (${earliestDate}) [id=${earliest.thoughtId}]`,
      `- ${latest.label} (${latestDate}) [id=${latest.thoughtId}]`,
      `- Ordering: "${earliest.label}" before "${latest.label}" [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
      'Unknown:',
      '- none',
    ].join('\n')
  }

  if (result.kind === 'multi_ordering' && result.multiOrdering) {
    const { ordered } = result.multiOrdering
    const orderLine = ordered.map((e) => `"${e.label}" (${formatIsoDate(e.startAt)})`).join(' → ')
    return [
      `Answer: ${orderLine} [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
      'Evidence:',
      ...ordered.map((e) => `- ${e.label} (${formatIsoDate(e.startAt)}) [id=${e.thoughtId}]`),
      `- Ordering: ${orderLine} [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
      'Unknown:',
      '- none',
    ].join('\n')
  }

  if (result.kind === 'duration' && result.durationDays) {
    const { exclusive, from, to, unit } = result.durationDays
    const fromDate = formatIsoDate(from.startAt)
    const toDate = formatIsoDate(to.startAt)
    return [
      `Answer: ${formatDurationLabel(exclusive, unit)} passed between "${from.label}" (${fromDate}) and "${to.label}" (${toDate}) [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
      'Evidence:',
      `- ${from.label} (${fromDate}) [id=${from.thoughtId}]`,
      `- ${to.label} (${toDate}) [id=${to.thoughtId}]`,
      `- Duration: ${formatDurationLabel(exclusive, unit)} (exclusive) between the two events [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
      'Unknown:',
      '- none',
    ].join('\n')
  }

  if (result.kind === 'count' && result.count) {
    const { value, anchor, before } = result.count
    const anchorDate = formatIsoDate(anchor.startAt)
    return [
      `Answer: ${value} [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
      'Evidence:',
      ...before.map((e) => `- ${e.label} (${formatIsoDate(e.startAt)}) [id=${e.thoughtId}]`),
      `- Anchor: ${anchor.label} (${anchorDate}) [id=${anchor.thoughtId}]`,
      `- Count: ${value} events before "${anchor.label}" [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
      'Unknown:',
      '- none',
    ].join('\n')
  }

  if (result.kind === 'lookback' && result.lookback) {
    const { value, unit, event } = result.lookback
    const eventDate = formatIsoDate(event.startAt)
    const unitWord = value === 1 ? unit.slice(0, -1) : unit
    return [
      `Answer: ${value} ${unitWord} ago [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
      'Evidence:',
      `- ${event.label} (${eventDate}) [id=${event.thoughtId}]`,
      `- Lookback: ${formatDurationLabel(value, unit)} from event to reference time [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
      'Unknown:',
      '- none',
    ].join('\n')
  }

  if (result.kind === 'span' && result.span) {
    const { years, months, from, to } = result.span
    const spanLabel = formatSpanLabel(years, months)
    return [
      `Answer: ${spanLabel} [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
      'Evidence:',
      `- ${from.label} (${formatIsoDate(from.startAt)}) [id=${from.thoughtId}]`,
      `- ${to.label} (${formatIsoDate(to.startAt)}) [id=${to.thoughtId}]`,
      `- Span: ${spanLabel} between the two milestones [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
      'Unknown:',
      '- none',
    ].join('\n')
  }

  return null
}
