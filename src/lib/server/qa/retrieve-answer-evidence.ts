/**
 * The retrieval half of Ask (`composeAnswer`), as one function with one search path: thoughts
 * through hybrid search + rerank, note passages through note search, both under the same
 * relevance floor, with the personalization expansion (S3) when the caller passes sub-queries.
 *
 * composeAnswer uses it for the question; the forget flow uses it for every LLM-derived target
 * phrase (docs/planning/personamem-score-plan.md, S2b), so "find XYZ" is exactly "what Ask would
 * find". Nothing here interprets text; the caller owns the query, its embedding and any
 * LLM-written sub-queries.
 */

import type { BelowFloorScores } from '$lib/server/qa/compose-observer'
import { relevanceFloorFor } from '$lib/server/retrieval/relevance-floor'
import type { RetrieveEvidenceExtras } from '$lib/server/retrieval/retrieve-evidence'
import {
  bestScoreBelowFloor,
  fuseRankedHits,
  normalizeRetrievalScore,
} from '$lib/server/retrieval/rrf-scoring'
import { searchThoughts, type RetrievalResult } from '$lib/server/retrieval/service'
import type { TemporalQueryIntent } from '$lib/server/retrieval/temporal'
import { searchTextFiles, type TextFileSearchHit } from '$lib/server/text-files/service'

/** Notes kept per question in Ask. */
export const TEXT_FILE_COMPOSE_TOP_K = 5

export type AnswerEvidenceInput = {
  userId: string
  /** The retrieval query, already secret-redacted by the caller. */
  query: string
  queryEmbedding: number[]
  /** Thoughts kept (reranked pool size). */
  topK: number
  /** Notes kept per query. */
  noteTopK: number
  weights?: { vector: number; graph: number }
  temporalIntent?: TemporalQueryIntent | null
  authorFilter?: 'user' | 'agent'
  /** Personalization sub-queries with their embeddings (S3); absent for fact questions. */
  expansions?: Array<{ query: string; embedding: number[] }>
}

export type AnswerEvidence = {
  /** Thoughts at or above the relevance floor, in rank order. */
  retrieved: RetrievalResult[]
  /** Notes (one hit per note, matched passages with neighbours), budgeted to `noteTopK`. */
  noteHits: TextFileSearchHit[]
  /** Community themes and temporal seeds that thought retrieval produced on the way. */
  extras: RetrieveEvidenceExtras
  /** Best scores the floor dropped (eval observability). */
  belowFloor: BelowFloorScores
  /** The floor that was applied (the product's, or the eval run's override). */
  relevanceFloor: number
}

export async function retrieveAnswerEvidence(input: AnswerEvidenceInput): Promise<AnswerEvidence> {
  const { userId, query, queryEmbedding, expansions } = input
  const extras: RetrieveEvidenceExtras = {
    communityThemes: [],
    temporalSeeds: [],
  }
  // the product floor, or (eval harness only) the floor of the run being measured
  const relevanceFloor = relevanceFloorFor(userId)
  let notePassagesBelowFloor: number | null = null
  const [searchResults, questionTextFileHits, ...expansionTextFileHits] = await Promise.all([
    searchThoughts({
      userId,
      query,
      topK: input.topK,
      weights: input.weights,
      queryEmbedding,
      temporalIntent: input.temporalIntent,
      authorFilter: input.authorFilter,
      extrasOut: extras,
      ...(expansions ? { expansions } : {}),
    }),
    searchTextFiles(userId, {
      query,
      topK: input.noteTopK,
      queryEmbedding,
      minScore: relevanceFloor,
      onBelowFloor: (best) => {
        notePassagesBelowFloor = best
      },
    }),
    ...(expansions ?? []).map((e) =>
      searchTextFiles(userId, {
        query: e.query,
        topK: input.noteTopK,
        queryEmbedding: e.embedding,
        minScore: relevanceFloor,
      }),
    ),
  ])
  // Notes: the question's passages and each sub-query's merge by reciprocal rank, deduplicated,
  // inside the same notes budget.
  const noteHits = expansions
    ? fuseRankedHits([questionTextFileHits, ...expansionTextFileHits], input.noteTopK)
    : questionTextFileHits
  return {
    retrieved: searchResults.filter((r) => normalizeRetrievalScore(r.score) >= relevanceFloor),
    noteHits,
    extras,
    belowFloor: {
      thoughts: bestScoreBelowFloor(
        searchResults.map((r) => normalizeRetrievalScore(r.score)),
        relevanceFloor,
      ),
      notePassages: notePassagesBelowFloor,
    },
    relevanceFloor,
  }
}
