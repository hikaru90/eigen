import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import type { MemoryAuthor } from '$lib/server/db/schema'
import { tokenizeLexicalQuery } from '$lib/server/memory/lexical-fold'
import { activeThoughtLifecycleCondition } from '$lib/server/memory/thought-lifecycle-filter'

export type LexicalSearchResult = {
  id: string
  normalizedText: string
  category: string
  metadata: Record<string, unknown>
  lexicalScore: number
  createdAt: Date
}

/**
 * Build an OR-joined `to_tsquery` string from a free-form natural-language query.
 *
 * `plainto_tsquery` AND-joins every token, which means natural-language questions
 * (e.g. "what did Marcus tell me about my starter") require every token in one
 * document and almost never match. We instead tokenize the query the same way
 * `lexical_text` is precomputed (NFKC + lowercase + alphanumeric split) and OR
 * the tokens, so any single keyword can surface a candidate while ts_rank_cd
 * still rewards documents that match more tokens.
 */
export function buildLexicalTsQuery(query: string): string {
  const tokens = tokenizeLexicalQuery(query)
    .filter((token) => token.length >= 3)
    .slice(0, 32)
  return tokens.join(' | ')
}

export async function lexicalSearch(params: {
  userId: string
  query: string
  limit: number
  authorFilter?: MemoryAuthor
}): Promise<LexicalSearchResult[]> {
  const tsQueryString = buildLexicalTsQuery(params.query)
  if (tsQueryString.length === 0) return []

  const lexicalVector = sql`to_tsvector('simple', coalesce(${thought.lexicalText}, '') || ' ' || coalesce(array_to_string(${thought.cues}, ' '), ''))`
  const tsQueryExpr = sql`to_tsquery('simple', ${tsQueryString})`
  const rankExpr = sql<number>`ts_rank_cd(${lexicalVector}, ${tsQueryExpr})`
  const matchExpr = sql<boolean>`${lexicalVector} @@ ${tsQueryExpr}`

  const rows = await getDb()
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      category: thought.category,
      metadata: thought.metadata,
      createdAt: thought.createdAt,
      lexicalScore: rankExpr,
    })
    .from(thought)
    .where(
      and(
        eq(thought.userId, params.userId),
        activeThoughtLifecycleCondition(),
        matchExpr,
        params.authorFilter ? eq(thought.author, params.authorFilter) : undefined,
      ),
    )
    .orderBy(desc(rankExpr))
    .limit(params.limit)

  return rows.map((row) => ({
    id: row.id,
    normalizedText: row.normalizedText,
    category: row.category,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    lexicalScore: row.lexicalScore ?? 0,
  }))
}
