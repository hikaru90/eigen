import type {
  TemporalEnergyLevel,
  TemporalEventKind,
  TemporalPriorityQuadrant,
  TemporalTimePrecision,
} from '$lib/server/db/brain.schema'
import {
  parseRelativeSpec,
  resolveAnchoredStartAt,
  type TemporalRelativeSpec,
} from '$lib/server/memory/temporal-relative-resolve'

export type ExtractedTemporalMention = {
  surface: string
  kind: TemporalEventKind
  /** ISO-8601 instant or date (start of period / point-in-time). */
  startAt: string
  /** ISO-8601; omit for open-ended deadlines or point events. */
  endAt?: string
  timePrecision: TemporalTimePrecision
  timezone: string
  isAllDay: boolean
  recurrenceRule?: string
  durationMinutes?: number
  energyLevel?: TemporalEnergyLevel
  priorityQuadrant?: TemporalPriorityQuadrant
  contextTags?: string[]
  /** Verbatim phrase of parent task in the same capture (resolved to parent_event_id on persist). */
  parentSurface?: string
  confidence: number
  semanticSummary: string
  /** Structured relative-date spec — startAt is overridden by deterministic anchor math when set. */
  relativeSpec?: TemporalRelativeSpec
}

const ALLOWED_ENERGY = new Set<TemporalEnergyLevel>(['light', 'medium', 'deep'])
const ALLOWED_QUADRANTS = new Set<TemporalPriorityQuadrant>([
  'urgent_important',
  'not_urgent_important',
  'urgent_not_important',
  'neither',
])

/**
 * The meaning of every `kind` a temporal element may carry. Keyed by the schema enum
 * (`satisfies`), so a kind added to the schema fails to compile until it is described here.
 * Both LLM prompts and the parser below are built from this one object.
 */
export const TEMPORAL_KIND_MEANINGS = {
  deadline: 'something that must be done by a time ("by Friday", "until the end of November")',
  appointment: 'something scheduled at a time ("dentist on Friday at 9am", "yoga every Tuesday")',
  milestone: 'something that happened or is reached at a time (arrived, finished, booked, started)',
  period: 'a span of days, weeks or months rather than a point in time',
  reminder: 'something to be reminded of or checked at a time, without a hard commitment',
  inferred_event: 'a date or time the text implies rather than states',
} as const satisfies Record<TemporalEventKind, string>

/** The meaning of every `timePrecision` (see TEMPORAL_KIND_MEANINGS for why it is keyed this way). */
export const TEMPORAL_PRECISION_MEANINGS = {
  exact: 'a clock time is given ("9am", "19:00") — use this for ANY mention with a time of day',
  day: 'only a calendar day is given, no clock time ("on Friday", "March 15th")',
  week: 'only a week is given ("next week")',
  month: 'only a month is given ("in March")',
  fuzzy: 'roughly, no firm day ("soon", "around Easter")',
} as const satisfies Record<TemporalTimePrecision, string>

const ALLOWED_KINDS: ReadonlySet<string> = new Set(Object.keys(TEMPORAL_KIND_MEANINGS))
const ALLOWED_PRECISIONS: ReadonlySet<string> = new Set(Object.keys(TEMPORAL_PRECISION_MEANINGS))

/** `deadline|appointment|…` — for the JSON templates in the prompts and for error messages. */
export const TEMPORAL_KIND_KEYS = [...ALLOWED_KINDS].join('|')
/** `exact|day|week|month|fuzzy`. */
export const TEMPORAL_PRECISION_KEYS = [...ALLOWED_PRECISIONS].join('|')

/**
 * The temporal element contract, as prompt text. ONE copy: the enrich bundle prompt and the
 * standalone temporal extraction prompt both embed it, so the two cannot drift apart, and it is
 * generated from the same catalogs `parseTemporalMentions` validates against. A reply that
 * breaks it makes the parse throw (the ingest retry ladder asks again); nothing is dropped.
 */
export const TEMPORAL_ELEMENT_CONTRACT = [
  'Temporal element contract. Every element needs these required fields: surface, kind, startAt, timePrecision, timezone (plus isAllDay, confidence and semanticSummary).',
  'kind must be exactly one of:',
  ...Object.entries(TEMPORAL_KIND_MEANINGS).map(([key, meaning]) => `- ${key}: ${meaning}`),
  'timePrecision must be exactly one of:',
  ...Object.entries(TEMPORAL_PRECISION_MEANINGS).map(([key, meaning]) => `- ${key}: ${meaning}`),
  'Any other kind or timePrecision (for example "hour" or "minute") makes the whole reply invalid and it is asked again — a clock time is still timePrecision "exact".',
].join('\n')

/** Build a Postgres `tsrange` literal from normalized bounds. */
export function buildActivePeriodLiteral(start: Date, end: Date): string {
  const startIso = start.toISOString()
  const endIso = end.toISOString()
  return `[${startIso},${endIso})`
}

/**
 * Expand a parsed instant/range into concrete Date bounds for storage and AGE graph scalars.
 * Fuzzy precision uses a ±7 day window around start when end is absent.
 */
export function resolveTemporalBounds(mention: ExtractedTemporalMention): {
  start: Date
  end: Date
  activePeriodLiteral: string
} {
  const start = new Date(mention.startAt)
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid temporal startAt: ${mention.startAt}`)
  }

  let end: Date
  if (mention.endAt) {
    end = new Date(mention.endAt)
    if (Number.isNaN(end.getTime())) {
      throw new Error(`Invalid temporal endAt: ${mention.endAt}`)
    }
  } else if (mention.kind === 'deadline' || mention.kind === 'reminder') {
    // Open-ended commitment: point at due instant, range extends one day forward.
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  } else if (mention.timePrecision === 'fuzzy') {
    end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  } else if (mention.timePrecision === 'day' || mention.isAllDay) {
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  } else if (mention.timePrecision === 'week') {
    end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  } else if (mention.timePrecision === 'month') {
    end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
  } else {
    end = new Date(start.getTime() + 60 * 60 * 1000)
  }

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000)
  }

  return {
    start,
    end,
    activePeriodLiteral: buildActivePeriodLiteral(start, end),
  }
}

function describeReceived(value: unknown): string {
  return value === undefined ? 'nothing (the field is missing)' : JSON.stringify(value)
}

/** A required string field: present, a string, non-empty after trim. Throws naming field and value. */
function requireString(entry: Record<string, unknown>, field: string, at: string): string {
  const value = entry[field]
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new Error(`${at}.${field} must be a non-empty string, received ${describeReceived(value)}`)
}

/** A required string field that must be one of `allowed` (the catalog keys, joined with `|` in `list`). */
function requireOneOf<T extends string>(
  entry: Record<string, unknown>,
  field: string,
  at: string,
  allowed: ReadonlySet<string>,
  list: string,
): T {
  const value = entry[field]
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  if (trimmed !== undefined && allowed.has(trimmed)) return trimmed as T
  throw new Error(`${at}.${field} must be one of ${list}, received ${describeReceived(value)}`)
}

/**
 * Parse the temporal elements of an LLM reply. An element that breaks the contract
 * (TEMPORAL_ELEMENT_CONTRACT) makes the whole parse THROW with the element index, the field and
 * the received value — never a dropped element, never a defaulted field: a dropped mention is a
 * date the user said and Eigen silently lost. The error holds no capture text. Callers parse
 * inside their reject/retry path so the bad reply is evicted and asked again.
 */
export function parseTemporalMentions(content: string): ExtractedTemporalMention[] {
  const parsed = JSON.parse(content) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Temporal extraction output must be a JSON array')
  }

  return parsed.map((raw, index): ExtractedTemporalMention => {
    const at = `Temporal element [${index}]`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${at} must be an object, received ${describeReceived(raw)}`)
    }
    const entry = raw as Record<string, unknown>

    const surface = requireString(entry, 'surface', at)
    const kind = requireOneOf<TemporalEventKind>(
      entry,
      'kind',
      at,
      ALLOWED_KINDS,
      TEMPORAL_KIND_KEYS,
    )
    const startAt = requireString(entry, 'startAt', at)
    const timePrecision = requireOneOf<TemporalTimePrecision>(
      entry,
      'timePrecision',
      at,
      ALLOWED_PRECISIONS,
      TEMPORAL_PRECISION_KEYS,
    )
    const timezone = requireString(entry, 'timezone', at)

    const endAtRaw = entry.endAt
    const endAt = typeof endAtRaw === 'string' && endAtRaw.trim() ? endAtRaw.trim() : undefined
    const isAllDay = entry.isAllDay === true
    const recurrenceRuleRaw = entry.recurrenceRule
    const recurrenceRule =
      typeof recurrenceRuleRaw === 'string' && recurrenceRuleRaw.trim()
        ? recurrenceRuleRaw.trim()
        : undefined
    const confidenceRaw = entry.confidence
    const confidence =
      typeof confidenceRaw === 'number' && !Number.isNaN(confidenceRaw)
        ? Math.min(1, Math.max(0, confidenceRaw))
        : 0
    const semanticSummary =
      typeof entry.semanticSummary === 'string' ? entry.semanticSummary.trim() : surface
    const relativeSpec = parseRelativeSpec(entry.relativeSpec)
    const durationRaw = entry.durationMinutes
    const durationMinutes =
      typeof durationRaw === 'number' && durationRaw > 0 ? Math.round(durationRaw) : undefined
    const energyRaw = entry.energyLevel
    const energyLevel =
      typeof energyRaw === 'string' && ALLOWED_ENERGY.has(energyRaw as TemporalEnergyLevel)
        ? (energyRaw as TemporalEnergyLevel)
        : undefined
    const quadrantRaw = entry.priorityQuadrant
    const priorityQuadrant =
      typeof quadrantRaw === 'string' &&
      ALLOWED_QUADRANTS.has(quadrantRaw as TemporalPriorityQuadrant)
        ? (quadrantRaw as TemporalPriorityQuadrant)
        : undefined
    const contextTagsRaw = entry.contextTags
    const contextTags = Array.isArray(contextTagsRaw)
      ? contextTagsRaw
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
      : undefined
    const parentSurfaceRaw = entry.parentSurface
    const parentSurface =
      typeof parentSurfaceRaw === 'string' && parentSurfaceRaw.trim()
        ? parentSurfaceRaw.trim()
        : undefined

    return {
      surface,
      kind,
      startAt,
      ...(endAt ? { endAt } : {}),
      timePrecision,
      timezone,
      isAllDay,
      ...(recurrenceRule ? { recurrenceRule } : {}),
      confidence,
      semanticSummary: semanticSummary || surface,
      ...(relativeSpec ? { relativeSpec } : {}),
      ...(durationMinutes != null ? { durationMinutes } : {}),
      ...(energyLevel ? { energyLevel } : {}),
      ...(priorityQuadrant ? { priorityQuadrant } : {}),
      ...(contextTags && contextTags.length > 0 ? { contextTags } : {}),
      ...(parentSurface ? { parentSurface } : {}),
    }
  })
}

/** Apply capture-anchored relative date math to LLM-extracted mentions. */
export function applyCaptureAnchoredMentions(
  mentions: ExtractedTemporalMention[],
  capturedAt: Date,
): ExtractedTemporalMention[] {
  return mentions.map((mention) => {
    if (!mention.relativeSpec) return mention
    const start = resolveAnchoredStartAt({
      startAt: mention.startAt,
      capturedAt,
      relativeSpec: mention.relativeSpec,
    })
    return { ...mention, startAt: start.toISOString() }
  })
}
