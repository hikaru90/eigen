import { and, eq, gte, isNotNull, ne, sql } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { canonicalEntity, thought, thoughtEntity } from '$lib/server/db/schema'
import { fetchGraphCommunityOverlays } from '$lib/server/graph/community-overlays'
import { validatePatternsPayload, type ValidatedPattern } from './patterns-contract'
import {
  PATTERNS_CATALOG_LIMIT,
  PATTERNS_WINDOW_DAYS,
  PATTERN_ROW_SUMMARY_MAX_LENGTH,
  buildPatternsLlmInput,
  isoDay,
  patternsWindowStart,
  type PatternThoughtRow,
} from './patterns-input'
import { runPatternsJudge } from './patterns-judge'

/**
 * Patterns: what the mesh notices (ei redesign wave 2.4).
 *
 * Load the last weeks' thoughts, community overlays and thread activity (all
 * existing data — no migration), build the structured summary, run ONE judge
 * call, validate + clamp its JSON. Nothing is persisted. Tenancy: every query
 * is scoped with `eq(..userId)` like the neighbouring judges
 * (src/lib/server/memory/judge-gtd-project.ts). Embeddings are never selected.
 */

export type PatternThoughtPreview = {
  id: string
  summary: string
}

export type PatternsOkResult = {
  status: 'ok'
  insight: string
  patterns: ValidatedPattern[]
  /** Short summaries for every thought a pattern cites — so cards can list them. */
  thoughtPreviews: PatternThoughtPreview[]
  windowDays: number
}

/** The legitimate quiet state: nothing (with a readable summary) captured in the window. */
export type PatternsEmptyResult = {
  status: 'empty'
  windowDays: number
}

export type PatternsResult = PatternsOkResult | PatternsEmptyResult

/** Newest rows considered per user per run; counts beyond this are not loaded. */
const PATTERNS_ROW_LIMIT = 400

/*
 * In-process cache, one entry per user per UTC day, successes only.
 * Limitation (this pass): per server process — a restart or a second instance
 * recomputes; nothing is shared or persisted. A new capture today does not
 * refresh today's patterns until the day rolls over.
 */
const PATTERNS_CACHE_MAX_ENTRIES = 200
const patternsCache = new Map<string, PatternsOkResult>()

function patternsCacheKey(userId: string, dayKey: string): string {
  return `${userId}:${dayKey}`
}

function rememberPatterns(key: string, value: PatternsOkResult): void {
  if (patternsCache.size >= PATTERNS_CACHE_MAX_ENTRIES) {
    const oldest = patternsCache.keys().next().value
    if (oldest !== undefined) patternsCache.delete(oldest)
  }
  patternsCache.set(key, value)
}

/** Test seam: forget every cached result. */
export function clearPatternsCache(): void {
  patternsCache.clear()
}

async function summarizeThoughtRow(
  userId: string,
  row: { normalizedText: string | null; normalizedTextEncrypted: string | null },
): Promise<string | null> {
  const text = row.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: row.normalizedTextEncrypted,
      })
    : row.normalizedText
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return null
  return trimmed.length > PATTERN_ROW_SUMMARY_MAX_LENGTH
    ? trimmed.slice(0, PATTERN_ROW_SUMMARY_MAX_LENGTH)
    : trimmed
}

async function loadWindowThoughtRows(userId: string, since: Date): Promise<PatternThoughtRow[]> {
  const rows = await getDb()
    .select({
      id: thought.id,
      category: thought.category,
      createdAt: thought.createdAt,
      primaryCommunityIds: thought.primaryCommunityIds,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        gte(thought.createdAt, since),
        ne(thought.lifecycleStatus, 'archived'),
      ),
    )
    .orderBy(sql`${thought.createdAt} desc`)
    .limit(PATTERNS_ROW_LIMIT)

  // Rows arrive newest first; only the ones that can enter the catalog get decrypted.
  const out: PatternThoughtRow[] = []
  for (const [index, row] of rows.entries()) {
    out.push({
      id: row.id,
      category: row.category,
      createdAt: row.createdAt,
      communityIds: row.primaryCommunityIds,
      summary: index < PATTERNS_CATALOG_LIMIT ? await summarizeThoughtRow(userId, row) : null,
    })
  }
  return out
}

async function loadThreadActivity(
  userId: string,
  since: Date,
): Promise<Array<{ label: string; recentThoughtCount: number }>> {
  return getDb()
    .select({
      label: canonicalEntity.label,
      recentThoughtCount: sql<number>`count(distinct ${thoughtEntity.thoughtId})`.mapWith(Number),
    })
    .from(canonicalEntity)
    .innerJoin(
      thoughtEntity,
      and(eq(thoughtEntity.entityId, canonicalEntity.id), eq(thoughtEntity.userId, userId)),
    )
    .innerJoin(
      thought,
      and(
        eq(thought.id, thoughtEntity.thoughtId),
        gte(thought.createdAt, since),
        ne(thought.lifecycleStatus, 'archived'),
      ),
    )
    .where(and(eq(canonicalEntity.userId, userId), isNotNull(canonicalEntity.projectStatus)))
    .groupBy(canonicalEntity.id, canonicalEntity.label)
}

export async function getPatternsForUser(userId: string): Promise<PatternsResult> {
  const today = new Date()
  const cacheKey = patternsCacheKey(userId, isoDay(today))
  const cached = patternsCache.get(cacheKey)
  if (cached) return cached

  const since = patternsWindowStart(today, PATTERNS_WINDOW_DAYS)
  const [rows, overlays, threadActivity] = await Promise.all([
    loadWindowThoughtRows(userId, since),
    fetchGraphCommunityOverlays(userId),
    loadThreadActivity(userId, since),
  ])

  const input = buildPatternsLlmInput({
    rows,
    overlays: overlays.map((overlay) => ({ id: overlay.id, name: overlay.name })),
    threadActivity,
    today,
    windowDays: PATTERNS_WINDOW_DAYS,
  })

  // Quiet state: no readable thought in the window means there is nothing the
  // judge could cite — not an error, and not worth a call. Not cached, so the
  // first capture of the day shows up on the next visit.
  if (input.thoughtCatalog.length === 0) {
    return { status: 'empty', windowDays: PATTERNS_WINDOW_DAYS }
  }

  const knownIds = new Set(input.thoughtCatalog.map((entry) => entry.id))
  const payload = await runPatternsJudge(userId, input)
  const validated = validatePatternsPayload(payload, knownIds)

  const summaryById = new Map(input.thoughtCatalog.map((entry) => [entry.id, entry.summary]))
  const citedIds = new Set(validated.patterns.flatMap((pattern) => pattern.thoughtIds))
  const thoughtPreviews: PatternThoughtPreview[] = []
  for (const id of citedIds) {
    const summary = summaryById.get(id)
    if (summary) thoughtPreviews.push({ id, summary })
  }

  const result: PatternsOkResult = {
    status: 'ok',
    insight: validated.insight,
    patterns: validated.patterns,
    thoughtPreviews,
    windowDays: PATTERNS_WINDOW_DAYS,
  }
  rememberPatterns(cacheKey, result)
  return result
}
