import { and, asc, eq, ne } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { isThoughtNeverStale } from '$lib/server/memory/thought-staleness'
import { RELEVANCE_CHECKIN_MIN_INACTIVE_DAYS } from '$lib/server/grounding/constants'

const MS_PER_DAY = 86_400_000

export type RelevanceCheckInCandidate = {
  id: string
  normalizedText: string
  category: string
  salienceScore: number
  inactiveDays: number
}

/**
 * Structural shortlist of open, non-task thoughts that look faded enough to ask about.
 * Meaning/selection among candidates is an LLM judge — this only filters on age/salience/lifecycle.
 */
export async function loadRelevanceCheckInCandidates(
  userId: string,
  limit = 12,
): Promise<RelevanceCheckInCandidate[]> {
  const now = Date.now()
  const minInactiveMs = RELEVANCE_CHECKIN_MIN_INACTIVE_DAYS * MS_PER_DAY

  const rows = await getDb()
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      category: thought.category,
      salienceScore: thought.salienceScore,
      lastAccessedAt: thought.lastAccessedAt,
      createdAt: thought.createdAt,
      metadata: thought.metadata,
    })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        eq(thought.lifecycleStatus, 'open'),
        ne(thought.category, 'task'),
      ),
    )
    .orderBy(asc(thought.salienceScore), asc(thought.createdAt))
    .limit(Math.max(limit * 3, 36))

  const candidates: RelevanceCheckInCandidate[] = []
  for (const row of rows) {
    if (
      isThoughtNeverStale({
        metadata: row.metadata,
      })
    ) {
      continue
    }

    const anchor = row.lastAccessedAt ?? row.createdAt
    const inactiveMs = now - anchor.getTime()
    if (inactiveMs < minInactiveMs) continue

    const text = row.normalizedText?.trim() ?? ''
    if (text.length === 0) continue

    candidates.push({
      id: row.id,
      normalizedText: text,
      category: row.category,
      salienceScore: row.salienceScore,
      inactiveDays: Math.floor(inactiveMs / MS_PER_DAY),
    })

    if (candidates.length >= limit) break
  }

  return candidates
}
