/**
 * Hybrid search over the user's facts (docs/planning/user-facts-layer.md): pgvector cosine
 * similarity on the statement embedding plus FTS over the folded keyword surface — the same two
 * signals thoughts and note passages use, scored the same way (best of cosine similarity and the
 * normalised keyword rank), under the same kind of relevance floor.
 *
 * Active facts only by default: a forgotten fact never matches (the status condition is part of
 * every query), a superseded one only for history questions. A hit carries the subject, the
 * statement (identifier facts: the `[secure:<id>]` reference, never the value), kind, as-of,
 * inferred flag and provenance ids. It never carries an embedding or a secure value: the selects
 * below list their columns, and `embedding` is not among them.
 *
 * Consumers: F2 (facts in answers) and the forget flow; `runFactSearch` is pure over injected
 * sources so the ranking is testable without a database.
 */

import type { FactKind, FactStatus, FactSubjectKind } from './fact-vocabulary'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { userFact, userFactSource } from '$lib/server/db/schema'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import { buildLexicalTsQuery } from '$lib/server/retrieval/lexical'
import { relevanceFloorFor } from '$lib/server/retrieval/relevance-floor'
import { normalizeLexicalRank } from '$lib/server/retrieval/rrf-scoring'
import { redactedText } from '$lib/server/security/detect-secrets'

/** Candidates pulled per signal before the merge. */
export const FACT_ANN_LIMIT = 40
export const FACT_LEXICAL_LIMIT = 40

export type FactSearchCandidate = {
  factId: string
  /** pgvector cosine distance (ANN side). */
  vectorDistance?: number
  /** Postgres ts_rank_cd (FTS side). */
  lexicalRank?: number
}

/** The columns a search reads from `user_fact` — everything but the embedding. */
export type FactRow = {
  id: string
  subjectKind: FactSubjectKind
  subjectLabel: string | null
  subjectEntityId: string | null
  statementEncrypted: string
  kind: FactKind
  confidence: number
  inferred: boolean
  status: FactStatus
  supersededBy: string | null
  asOf: Date
  secureValueId: string | null
}

export type FactSourceRow = { factId: string; thoughtId: string | null; textFileId: string | null }

export type UserFactHit = {
  id: string
  subjectKind: FactSubjectKind
  subjectLabel: string | null
  subjectEntityId: string | null
  /** As stored: an identifier fact holds `[secure:<id>]`, never the value. */
  statement: string
  kind: FactKind
  inferred: boolean
  confidence: number
  status: FactStatus
  supersededBy: string | null
  asOf: Date
  secureValueId: string | null
  /** Capture thoughts / reference notes the fact was derived from. */
  sourceThoughtIds: string[]
  sourceTextFileIds: string[]
  /** Best signal, 0..1. */
  score: number
  /** Cosine similarity of the statement (0 when the fact matched by keyword only). */
  vectorScore: number
}

/** The data sources of a fact search; real ones read Postgres, tests inject their own. */
export type FactSearchSources = {
  candidates: () => Promise<FactSearchCandidate[]>
  loadFacts: (ids: string[]) => Promise<FactRow[]>
  loadSources: (ids: string[]) => Promise<FactSourceRow[]>
  decryptStatement: (row: FactRow) => Promise<string>
}

type RankedFact = { factId: string; score: number; vectorScore: number }

/** Merges the vector and keyword rows of each fact and applies the floor. Pure arithmetic. */
export function rankFactCandidates(
  candidates: FactSearchCandidate[],
  params: { minScore: number; limit: number },
): RankedFact[] {
  const byFact = new Map<string, FactSearchCandidate>()
  for (const c of candidates) {
    const existing = byFact.get(c.factId)
    if (!existing) {
      byFact.set(c.factId, { ...c })
      continue
    }
    if (c.vectorDistance !== undefined) {
      existing.vectorDistance = Math.min(existing.vectorDistance ?? Infinity, c.vectorDistance)
    }
    if (c.lexicalRank !== undefined) {
      existing.lexicalRank = Math.max(existing.lexicalRank ?? 0, c.lexicalRank)
    }
  }

  const ranked: RankedFact[] = []
  for (const c of byFact.values()) {
    const vectorScore = c.vectorDistance !== undefined ? Math.max(0, 1 - c.vectorDistance) : 0
    const score = Math.max(vectorScore, normalizeLexicalRank(c.lexicalRank ?? 0))
    if (score >= params.minScore) ranked.push({ factId: c.factId, score, vectorScore })
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.factId.localeCompare(b.factId))
    .slice(0, params.limit)
}

export async function runFactSearch(
  sources: FactSearchSources,
  params: { minScore: number; limit: number },
): Promise<UserFactHit[]> {
  const ranked = rankFactCandidates(await sources.candidates(), params)
  if (ranked.length === 0) return []

  const ids = ranked.map((r) => r.factId)
  const [rows, provenance] = await Promise.all([sources.loadFacts(ids), sources.loadSources(ids)])
  const byId = new Map(rows.map((r) => [r.id, r]))

  const hits: UserFactHit[] = []
  for (const r of ranked) {
    const row = byId.get(r.factId)
    // the row is re-read under the same conditions: a fact forgotten in between is gone
    if (!row) continue
    const own = provenance.filter((p) => p.factId === row.id)
    hits.push({
      id: row.id,
      subjectKind: row.subjectKind,
      subjectLabel: row.subjectLabel,
      subjectEntityId: row.subjectEntityId,
      statement: await sources.decryptStatement(row),
      kind: row.kind,
      inferred: row.inferred,
      confidence: row.confidence,
      status: row.status,
      supersededBy: row.supersededBy,
      asOf: row.asOf,
      secureValueId: row.secureValueId,
      sourceThoughtIds: [...new Set(own.flatMap((p) => (p.thoughtId ? [p.thoughtId] : [])))],
      sourceTextFileIds: [...new Set(own.flatMap((p) => (p.textFileId ? [p.textFileId] : [])))],
      score: r.score,
      vectorScore: r.vectorScore,
    })
  }
  return hits
}

/**
 * Which facts a search may match: this tenant's, in one of the given statuses (`forgotten` is
 * never offered), optionally only facts known before an instant. Exported so the invariant is
 * testable.
 */
export function factSearchConditions(
  userId: string,
  input: { statuses: ReadonlyArray<Exclude<FactStatus, 'forgotten'>>; asOfBefore?: Date },
) {
  return and(
    eq(userFact.userId, userId),
    inArray(userFact.status, [...input.statuses]),
    input.asOfBefore ? lt(userFact.asOf, input.asOfBefore) : undefined,
  )!
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

export function decryptFactStatement(userId: string, row: { statementEncrypted: string }) {
  return decryptTenantValue({
    userId,
    table: 'user_fact',
    column: 'statement',
    ciphertext: row.statementEncrypted,
  })
}

/** The columns of a fact search read: never `embedding`, never the secure value. */
export const FACT_ROW_COLUMNS = {
  id: userFact.id,
  subjectKind: userFact.subjectKind,
  subjectLabel: userFact.subjectLabel,
  subjectEntityId: userFact.subjectEntityId,
  statementEncrypted: userFact.statementEncrypted,
  kind: userFact.kind,
  confidence: userFact.confidence,
  inferred: userFact.inferred,
  status: userFact.status,
  supersededBy: userFact.supersededBy,
  asOf: userFact.asOf,
  secureValueId: userFact.secureValueId,
} as const

export function createDbFactSearchSources(
  userId: string,
  input: {
    query: string
    queryEmbedding: number[]
    statuses: ReadonlyArray<Exclude<FactStatus, 'forgotten'>>
    asOfBefore?: Date
  },
): FactSearchSources {
  const where = factSearchConditions(userId, input)
  const tsQueryString = buildLexicalTsQuery(input.query)

  return {
    candidates: async () => {
      const db = getDb()
      const distance = sql<number>`${userFact.embedding} <=> ${toVectorLiteral(input.queryEmbedding)}::vector`
      const vectorRows = await db
        .select({ factId: userFact.id, distance })
        .from(userFact)
        .where(where)
        .orderBy(distance)
        .limit(FACT_ANN_LIMIT)

      const lexicalRows =
        tsQueryString.length === 0
          ? []
          : await (async () => {
              const tsQuery = sql`to_tsquery('simple', ${tsQueryString})`
              const rank = sql<number>`ts_rank_cd(${userFact.lexicalTsv}, ${tsQuery})`
              return db
                .select({ factId: userFact.id, rank })
                .from(userFact)
                .where(and(where, sql`${userFact.lexicalTsv} @@ ${tsQuery}`))
                .orderBy(desc(rank))
                .limit(FACT_LEXICAL_LIMIT)
            })()

      return [
        ...vectorRows.map((r) => ({ factId: r.factId, vectorDistance: r.distance })),
        ...lexicalRows.map((r) => ({ factId: r.factId, lexicalRank: r.rank ?? 0 })),
      ]
    },

    loadFacts: async (ids) =>
      getDb()
        .select(FACT_ROW_COLUMNS)
        .from(userFact)
        // same conditions again: a fact forgotten after the candidate read does not come back
        .where(and(where, inArray(userFact.id, ids))),

    loadSources: async (ids) =>
      getDb()
        .select({
          factId: userFactSource.factId,
          thoughtId: userFactSource.thoughtId,
          textFileId: userFactSource.textFileId,
        })
        .from(userFactSource)
        .where(and(eq(userFactSource.userId, userId), inArray(userFactSource.factId, ids))),

    decryptStatement: (row) => decryptFactStatement(userId, row),
  }
}

export type SearchUserFactsInput = {
  query: string
  /** Facts kept (default 10, at most 50). */
  topK?: number
  /** The query's embedding when the caller already has it. */
  queryEmbedding?: number[]
  /** Relevance floor on the 0..1 score. Default: the Q&A floor (eval harness: its override). */
  minScore?: number
  /** History questions: also match facts a newer one replaced. Forgotten facts never match. */
  includeSuperseded?: boolean
  /** Only facts known before this instant (the forget flow: a fact restated later stays). */
  asOfBefore?: Date
}

export async function searchUserFacts(
  userId: string,
  input: SearchUserFactsInput,
): Promise<UserFactHit[]> {
  const limit = Math.max(1, Math.min(input.topK ?? 10, 50))
  // a credential pasted into a question is neither embedded nor keyword-matched
  const query = redactedText(input.query)
  const queryEmbedding = input.queryEmbedding ?? (await createThoughtEmbedding(userId, query))
  return runFactSearch(
    createDbFactSearchSources(userId, {
      query,
      queryEmbedding,
      statuses: input.includeSuperseded ? ['active', 'superseded'] : ['active'],
      asOfBefore: input.asOfBefore,
    }),
    { minScore: input.minScore ?? relevanceFloorFor(userId), limit },
  )
}
