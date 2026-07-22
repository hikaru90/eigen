import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { temporalEvent } from '$lib/server/db/schema'
import {
  annotateTemporalEvents,
  classifyThoughtTemporalStatus,
  formatTemporalAnnotation,
  type TemporalEventValidity,
  type TemporalEventValidityInput,
  type ThoughtTemporalStatus,
} from '$lib/server/memory/temporal-validity'

export type ThoughtTemporalContext = {
  temporalStatus: ThoughtTemporalStatus
  temporalEvents: TemporalEventValidity[]
}

export type ThoughtTemporalContextMap = Map<string, ThoughtTemporalContext>

/**
 * Load temporal_event rows for thought ids and classify ACTIVE/EXPIRED vs answer-time `now`.
 */
export async function loadTemporalContextByThoughtIds(input: {
  userId: string
  thoughtIds: string[]
  now: Date
}): Promise<ThoughtTemporalContextMap> {
  const map: ThoughtTemporalContextMap = new Map()
  if (input.thoughtIds.length === 0) return map

  const rows = await getDb()
    .select({
      thoughtId: temporalEvent.thoughtId,
      kind: temporalEvent.kind,
      semanticSummary: temporalEvent.semanticSummary,
      activePeriod: temporalEvent.activePeriod,
    })
    .from(temporalEvent)
    .where(
      and(
        eq(temporalEvent.userId, input.userId),
        inArray(temporalEvent.thoughtId, input.thoughtIds),
      ),
    )

  const eventsByThoughtId = new Map<string, TemporalEventValidityInput[]>()
  for (const row of rows) {
    const list = eventsByThoughtId.get(row.thoughtId) ?? []
    list.push({
      kind: row.kind,
      semanticSummary: row.semanticSummary,
      activePeriod: String(row.activePeriod),
    })
    eventsByThoughtId.set(row.thoughtId, list)
  }

  for (const thoughtId of input.thoughtIds) {
    const rawEvents = eventsByThoughtId.get(thoughtId) ?? []
    const temporalStatus = classifyThoughtTemporalStatus(rawEvents, input.now)
    const temporalEvents = annotateTemporalEvents(rawEvents, input.now)
    map.set(thoughtId, { temporalStatus, temporalEvents })
  }

  return map
}

/** Compact temporal fields for MCP tool payloads. */
export function compactTemporalFieldsForMcp(
  context: ThoughtTemporalContext | undefined,
  now: Date,
): {
  temporalStatus: ThoughtTemporalStatus
  temporalSummary: string | undefined
} {
  if (!context || context.temporalStatus === 'none') {
    return { temporalStatus: 'none', temporalSummary: undefined }
  }
  const annotation = formatTemporalAnnotation(context.temporalEvents, context.temporalStatus, now)
  const temporalSummary = annotation.replace(/^temporal:\s*/, '').trim() || undefined
  return {
    temporalStatus: context.temporalStatus,
    temporalSummary,
  }
}

const STORED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Append capture date and temporal validity to a snippet so relative words like "heute"
 * are not read as the current calendar day.
 */
export function enhanceSnippetWithTemporalContext(input: {
  snippet: string
  storedAt: Date
  temporalStatus: ThoughtTemporalStatus
  temporalSummary: string | undefined
}): string {
  const storedDate = input.storedAt.toISOString().slice(0, 10)
  const base = input.snippet.trim()
  const parts: string[] = [`stored ${storedDate}`]
  if (input.temporalSummary) {
    parts.push(input.temporalSummary)
  } else if (input.temporalStatus === 'none') {
    parts.push('no linked event date')
  }
  const suffix = ` (${parts.join('; ')})`
  if (base.endsWith(')') && STORED_DATE_RE.test(base.slice(-11, -1))) {
    return base
  }
  return `${base}${suffix}`
}
