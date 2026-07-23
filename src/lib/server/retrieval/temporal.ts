import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { temporalEvent } from '$lib/server/db/schema'
import { createThoughtEmbedding, createThoughtEmbeddings } from '$lib/server/llm/embedding'
import { expandContextFromTemporalEventSeeds } from '$lib/server/graph/age'
import {
  candidatesFromTemporalSeeds,
  type TemporalHintBindingCandidate,
  resolveTemporalHintBindings,
} from '$lib/server/retrieval/resolve-temporal-hint-bindings'
import type { TemporalEventKind } from '$lib/server/db/brain.schema'
import type { QueryIntent, TemporalQuestionKind } from '$lib/server/retrieval/classify-query-intent'

export type TemporalFilterResult = {
  eventId: string
  graphNodeId: string | null
  semanticSummary: string
  thoughtId: string
  score: number
  startAt: Date | null
}

export type TemporalEventSeed = {
  eventId: string
  thoughtId: string
  semanticSummary: string
  startAt: Date | null
  activePeriod: string
  kind: TemporalEventKind
}

export type TemporalSeedsFetchResult = {
  seeds: TemporalEventSeed[]
  candidatesByHint: TemporalHintBindingCandidate[][]
}

export type TemporalQueryIntent = Pick<QueryIntent, 'temporal' | 'kind' | 'timeWindow'>

/** True when LLM query intent marks the question as temporal. */
export function isTemporalQuery(intent?: TemporalQueryIntent | null): boolean {
  return intent?.temporal === true
}

/** Time window from LLM query intent (no string parsing). */
export function resolveQueryTimeRange(
  intent?: TemporalQueryIntent | null,
): { start: Date; end: Date } | null {
  return intent?.timeWindow ?? null
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/**
 * Postgres time slice: overlap filter and/or semantic match on temporal_event rows.
 */
export async function filterTemporalEvents(input: {
  userId: string
  query: string
  queryEmbedding?: number[]
  limit?: number
  queryRange?: { start: Date; end: Date } | null
}): Promise<TemporalFilterResult[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 24, 100))
  const db = getDb()
  const queryEmbedding =
    input.queryEmbedding ?? (await createThoughtEmbedding(input.userId, input.query))
  const vectorLiteral = toVectorLiteral(queryEmbedding)
  const distance = sql<number>`${temporalEvent.embedding} <=> ${vectorLiteral}::vector`

  const range = input.queryRange ?? null
  const rangeLiteral = range ? `[${range.start.toISOString()},${range.end.toISOString()})` : null

  const rows = await db
    .select({
      id: temporalEvent.id,
      graphNodeId: temporalEvent.graphNodeId,
      semanticSummary: temporalEvent.semanticSummary,
      thoughtId: temporalEvent.thoughtId,
      startAt: temporalEvent.startAt,
      distance,
    })
    .from(temporalEvent)
    .where(
      and(
        eq(temporalEvent.userId, input.userId),
        isNotNull(temporalEvent.embedding),
        rangeLiteral ? sql`${temporalEvent.activePeriod} && ${rangeLiteral}::tsrange` : undefined,
      ),
    )
    .orderBy(distance)
    .limit(limit)

  return rows.map((row, index) => ({
    eventId: row.id,
    graphNodeId: row.graphNodeId,
    semanticSummary: row.semanticSummary,
    thoughtId: row.thoughtId,
    startAt: row.startAt,
    score: 1 / (index + 1),
  }))
}

/**
 * Semantic match on temporal_event rows, ordered by embedding distance then start_at.
 */
function sortAndSliceSeeds(rows: TemporalEventRow[], limit: number): TemporalEventSeed[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    const aTime = a.startAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bTime = b.startAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    return aTime - bTime
  })

  return sorted.slice(0, limit).map(rowToSeed)
}

async function mergeSeedsWithRequiredHints(input: {
  userId: string
  question: string
  kind: TemporalQuestionKind
  sliced: TemporalEventSeed[]
  allRows: TemporalEventRow[]
  requiredHints: string[]
  candidatesByHint: TemporalHintBindingCandidate[][]
  limit: number
}): Promise<TemporalEventSeed[]> {
  if (input.requiredHints.length < 1) return input.sliced

  const candidateSeeds = input.allRows.map(rowToSeed)
  const bindings = await resolveTemporalHintBindings({
    userId: input.userId,
    question: input.question,
    kind: input.kind,
    hints: input.requiredHints,
    candidates: candidatesFromTemporalSeeds(candidateSeeds),
    candidatesByHint: input.candidatesByHint,
  })

  const required: TemporalEventSeed[] = []
  const includedIds = new Set<string>()

  for (const binding of bindings) {
    const seed = candidateSeeds.find((row) => row.eventId === binding.eventId)
    if (!seed || includedIds.has(seed.eventId)) continue
    required.push(seed)
    includedIds.add(seed.eventId)
  }

  const merged = [...required]
  for (const seed of input.sliced) {
    if (merged.length >= input.limit) break
    if (includedIds.has(seed.eventId)) continue
    merged.push(seed)
    includedIds.add(seed.eventId)
  }

  return merged.slice(0, input.limit)
}

type TemporalEventRow = {
  id: string
  thoughtId: string
  semanticSummary: string
  startAt: Date | null
  activePeriod: string
  kind: TemporalEventKind
  distance: number
}

function rowToSeed(row: TemporalEventRow): TemporalEventSeed {
  return {
    eventId: row.id,
    thoughtId: row.thoughtId,
    semanticSummary: row.semanticSummary,
    startAt: row.startAt,
    activePeriod: row.activePeriod,
    kind: row.kind,
  }
}

function rowToBindingCandidate(row: TemporalEventRow): TemporalHintBindingCandidate {
  return {
    eventId: row.id,
    thoughtId: row.thoughtId,
    semanticSummary: row.semanticSummary,
    startAt: row.startAt && !Number.isNaN(row.startAt.getTime()) ? row.startAt.toISOString() : null,
    kind: row.kind,
  }
}

async function queryTemporalEventRows(input: {
  userId: string
  queryEmbedding: number[]
  limit: number
}): Promise<TemporalEventRow[]> {
  const db = getDb()
  const vectorLiteral = toVectorLiteral(input.queryEmbedding)
  const distance = sql<number>`${temporalEvent.embedding} <=> ${vectorLiteral}::vector`

  return db
    .select({
      id: temporalEvent.id,
      thoughtId: temporalEvent.thoughtId,
      semanticSummary: temporalEvent.semanticSummary,
      startAt: temporalEvent.startAt,
      activePeriod: temporalEvent.activePeriod,
      kind: temporalEvent.kind,
      distance,
    })
    .from(temporalEvent)
    .where(and(eq(temporalEvent.userId, input.userId), isNotNull(temporalEvent.embedding)))
    .orderBy(distance)
    .limit(input.limit)
}

export async function fetchTemporalEventSeeds(input: {
  userId: string
  query: string
  queryEmbedding: number[]
  limit?: number
  entityHints?: string[]
}): Promise<TemporalSeedsFetchResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 24, 100))
  const rows = await queryTemporalEventRows({
    userId: input.userId,
    queryEmbedding: input.queryEmbedding,
    limit: limit * 4,
  })
  return { seeds: sortAndSliceSeeds(rows, limit), candidatesByHint: [] }
}

/**
 * Fetch temporal_event rows per entity hint (embedding query per hint), merged and deduped.
 * Ensures both anchors appear even when a single global query would miss one.
 */
export async function fetchTemporalEventSeedsForHints(input: {
  userId: string
  query: string
  queryEmbedding: number[]
  entityHints: string[]
  kind?: TemporalQuestionKind
  limit?: number
  limitPerHint?: number
}): Promise<TemporalSeedsFetchResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 24, 100))
  const limitPerHint = Math.max(8, Math.min(input.limitPerHint ?? 16, 50))
  const hints = input.entityHints.filter((h) => h.trim().length > 0)
  const kind = input.kind ?? 'none'

  const byEventId = new Map<string, TemporalEventRow>()
  const candidatesByHint: TemporalHintBindingCandidate[][] = []

  const globalRows = await queryTemporalEventRows({
    userId: input.userId,
    queryEmbedding: input.queryEmbedding,
    limit: limit * 4,
  })
  for (const row of globalRows) {
    byEventId.set(row.id, row)
  }

  const hintEmbeddings = hints.length > 0 ? await createThoughtEmbeddings(input.userId, hints) : []

  for (let i = 0; i < hints.length; i++) {
    const hintEmbedding = hintEmbeddings[i]!
    const hintRows = await queryTemporalEventRows({
      userId: input.userId,
      queryEmbedding: hintEmbedding,
      limit: limitPerHint,
    })
    candidatesByHint.push(hintRows.map(rowToBindingCandidate))
    for (const row of hintRows) {
      const existing = byEventId.get(row.id)
      if (!existing || row.distance < existing.distance) {
        byEventId.set(row.id, row)
      }
    }
  }

  const merged = [...byEventId.values()].sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    const aTime = a.startAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bTime = b.startAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    return aTime - bTime
  })

  const sliced = sortAndSliceSeeds(merged, limit)
  const seeds = await mergeSeedsWithRequiredHints({
    userId: input.userId,
    question: input.query,
    kind,
    sliced,
    allRows: merged,
    requiredHints: hints,
    candidatesByHint,
    limit,
  })
  return { seeds, candidatesByHint }
}

/**
 * Filter-then-traverse: AGE graph expansion from Postgres-seeded event ids.
 */
export async function traverseTemporalContext(input: {
  userId: string
  seeds: TemporalFilterResult[]
  limit?: number
}): Promise<Array<{ thoughtId: string; hits: number; provenance?: string }>> {
  const eventIds = input.seeds.map((s) => s.graphNodeId ?? s.eventId).filter((id) => id.length > 0)

  if (eventIds.length === 0) return []

  return expandContextFromTemporalEventSeeds({
    userId: input.userId,
    eventIds,
    limit: input.limit ?? 40,
  })
}

export type TemporalSearchHit = TemporalFilterResult
