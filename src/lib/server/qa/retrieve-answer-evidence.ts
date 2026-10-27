/**
 * The retrieval half of Ask (`composeAnswer`), as one function with one search path: thoughts
 * through hybrid search, note passages through note search, and the user's facts
 * (docs/planning/user-facts-layer.md) through fact search, all under the same relevance floor,
 * with the personalization expansion (S3) when the caller passes sub-queries.
 *
 * composeAnswer uses it for the question; the forget flow uses it for every LLM-derived target
 * phrase (docs/planning/personamem-score-plan.md, S2b), so "find XYZ" is exactly "what Ask would
 * find". Nothing here interprets text; the caller owns the query, its embedding and any
 * LLM-written sub-queries.
 *
 * Budgets are separate: `topK` thoughts, `noteTopK` notes, `factTopK` facts — the candidate pools
 * of the search. A fact is one short sentence, so facts never take a thought slot and a long note
 * never crowds facts out.
 *
 * What the answer finally sees is a second, separate step: `selectRelevantEvidence` asks Jev
 * (`evidence_relevance`, docs/planning/jev-everywhere-rollout.md) once per question which
 * candidates help answer it, drops the ones that do not and cuts the rest to the answer budgets.
 * The forget flow does not take that step — it wants recall, and its own per-hit decision
 * (`forget_action`) is the filter.
 */

import { factSubjectLabel, statementForIndex } from '$lib/server/facts/fact-vocabulary'
import { searchUserFacts, type UserFactHit } from '$lib/server/facts/search-user-facts'
import type { BelowFloorScores } from '$lib/server/qa/compose-observer'
import { relevanceFloorFor } from '$lib/server/retrieval/relevance-floor'
import {
  judgeEvidenceRelevance,
  rankByRelevance,
  type RelevanceCandidate,
} from '$lib/server/retrieval/reranker'
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

/**
 * Facts the answer may see: a small budget of the ones Jev judged relevant to the question. Facts
 * are short, but every fact the answer model reads has to earn its place — there is no fixed
 * 24 for overview or advice questions.
 */
export const FACT_ANSWER_MAX = 8

/** Facts the search hands to the relevance judgement: the pool Jev picks the answer's facts from. */
export const FACT_CANDIDATE_POOL = 24

export type AnswerEvidenceInput = {
  userId: string
  /** The retrieval query, already secret-redacted by the caller. */
  query: string
  queryEmbedding: number[]
  /** Thoughts kept (reranked pool size). */
  topK: number
  /** Notes kept per query. */
  noteTopK: number
  /** Facts kept per question (all sub-queries fused inside it). */
  factTopK: number
  /** Only facts known before this instant (the forget flow: a fact restated later stays). */
  factsAsOfBefore?: Date
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
  /**
   * Active facts about the user and the people in their life, in rank order, budgeted to
   * `factTopK`. A hit holds an identifier fact's `[secure:<id>]` reference, never its value.
   * Empty for an agent-only search (`authorFilter: 'agent'`): facts are about the user.
   */
  facts: UserFactHit[]
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
  // facts are the user's own: an agent-only search (author=agent) has none
  const searchFacts = (q: string, embedding: number[]) =>
    input.authorFilter === 'agent'
      ? Promise.resolve<UserFactHit[]>([])
      : searchUserFacts(userId, {
          query: q,
          queryEmbedding: embedding,
          topK: input.factTopK,
          minScore: relevanceFloor,
          ...(input.factsAsOfBefore ? { asOfBefore: input.factsAsOfBefore } : {}),
        })
  const searchNotes = (q: string, embedding: number[]) =>
    searchTextFiles(userId, {
      query: q,
      topK: input.noteTopK,
      queryEmbedding: embedding,
      minScore: relevanceFloor,
    })
  // Every search starts at once: the question's three channels, then each sub-query's notes and facts.
  const [
    [searchResults, questionTextFileHits, questionFactHits],
    expansionTextFileHits,
    expansionFactHits,
  ] = await Promise.all([
    Promise.all([
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
      searchFacts(query, queryEmbedding),
    ]),
    Promise.all((expansions ?? []).map((e) => searchNotes(e.query, e.embedding))),
    Promise.all((expansions ?? []).map((e) => searchFacts(e.query, e.embedding))),
  ])
  // Notes: the question's passages and each sub-query's merge by reciprocal rank, deduplicated,
  // inside the same notes budget. Facts the same way, inside the facts budget.
  const noteHits = expansions
    ? fuseRankedHits([questionTextFileHits, ...expansionTextFileHits], input.noteTopK)
    : questionTextFileHits
  const facts = expansions
    ? fuseRankedHits([questionFactHits, ...expansionFactHits], input.factTopK)
    : questionFactHits
  return {
    retrieved: searchResults.filter((r) => normalizeRetrievalScore(r.score) >= relevanceFloor),
    noteHits,
    facts,
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

export type EvidenceBudgets = {
  /** Thoughts the answer may see (the compose budget of the question). */
  thoughts: number
  notes: number
  facts: number
}

const day = (date: Date | string) => new Date(date).toISOString().slice(0, 10)

/**
 * Jev's relevance verdict over everything the search found for a question — thoughts, note
 * passages and facts, ONE batched Decisions call. Candidates judged `not` are dropped, the rest are
 * ordered by relevance and cut to their budget. The question is judged as the user asked it (the
 * search may have used a different retrieval query). No candidates, no call.
 */
export async function selectRelevantEvidence(input: {
  userId: string
  question: string
  evidence: AnswerEvidence
  budgets: EvidenceBudgets
}): Promise<AnswerEvidence> {
  const { evidence, budgets } = input
  const thoughts = evidence.retrieved.map((hit, i) => ({ ref: `t${i + 1}`, hit }))
  const notes = evidence.noteHits.map((hit, i) => ({ ref: `n${i + 1}`, hit }))
  const facts = evidence.facts.map((hit, i) => ({ ref: `f${i + 1}`, hit }))
  if (thoughts.length + notes.length + facts.length === 0) return evidence

  const candidates: RelevanceCandidate[] = [
    ...thoughts.map(({ ref, hit }) => ({
      ref,
      label: `Stored thought, ${day(hit.createdAt)}`,
      text: hit.normalizedText,
    })),
    ...notes.map(({ ref, hit }) => ({
      ref,
      label: `Excerpt of the note "${hit.title.trim() || 'Untitled note'}", ${day(hit.createdAt)}`,
      text: hit.excerpt,
    })),
    ...facts.map(({ ref, hit }) => ({
      ref,
      // who it is about, so a friend's fact is not taken for the user's; identifiers as placeholders
      label: `Known fact about ${factSubjectLabel(hit)} (${hit.kind}, as of ${day(hit.asOf)}${hit.inferred ? ', inferred' : ''})`,
      text: statementForIndex(hit.statement),
    })),
  ]
  const verdicts = await judgeEvidenceRelevance({
    userId: input.userId,
    question: input.question,
    candidates,
  })

  return {
    ...evidence,
    retrieved: rankByRelevance(thoughts, (t) => t.ref, verdicts)
      .slice(0, budgets.thoughts)
      .map((t) => t.hit),
    noteHits: rankByRelevance(notes, (n) => n.ref, verdicts)
      .slice(0, budgets.notes)
      .map((n) => n.hit),
    facts: rankByRelevance(facts, (f) => f.ref, verdicts)
      .slice(0, budgets.facts)
      .map((f) => f.hit),
  }
}
