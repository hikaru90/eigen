/**
 * Find what a forget request is about (docs/planning/personamem-score-plan.md, S2b): the same
 * retrieval Ask uses, run for every LLM-derived target phrase, over thoughts AND note passages,
 * restricted to items stored before the forget capture. The facts derived from captures
 * (docs/planning/user-facts-layer.md) are searched for the same phrases and are hits too — the
 * statement the user is asking to forget usually exists as a fact as well. Finding does not decide
 * anything: every hit goes to the per-hit judge with its full text.
 */

import { statementForIndex, type FactKind } from '$lib/server/facts/fact-vocabulary'
import { searchUserFacts, type UserFactHit } from '$lib/server/facts/search-user-facts'
import { createThoughtEmbeddings } from '$lib/server/llm/embedding'
import { retrieveAnswerEvidence } from '$lib/server/qa/retrieve-answer-evidence'
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval'
import { deriveDeleteSearchQueries } from '$lib/server/retrieval/derive-delete-search-query'
import { mergeRetrievalResultsByBestScore } from '$lib/server/retrieval/retrieve-for-delete'
import { redactedText } from '$lib/server/security/detect-secrets'
import type { TextFileSearchHit } from '$lib/server/text-files/service'

/** A wider pool than Ask's question budget: forgetting wants recall, the judge filters. */
export const FORGET_TOP_K_PER_PHRASE = 20

export type ForgetHit =
  | {
      kind: 'thought'
      id: string
      /** The thought's full stored text. */
      text: string
      category: string
      createdAt: Date
      score: number
    }
  | {
      kind: 'note'
      id: string
      title: string
      /** The matched passage(s) with their neighbours, as note search returns them. */
      text: string
      matchedOrdinals: number[]
      createdAt: Date
      score: number
    }
  | {
      kind: 'fact'
      id: string
      /** The statement in display form: an identifier fact shows a placeholder, never the value or its id. */
      text: string
      /** Who the fact is about: "the user" or the person as the capture named them. */
      subject: string
      factKind: FactKind
      inferred: boolean
      /** The fact's as-of time (the capture it was last known from). */
      createdAt: Date
      score: number
    }

function mergeNotesByBestScore(resultSets: TextFileSearchHit[][]): TextFileSearchHit[] {
  const byId = new Map<string, TextFileSearchHit>()
  for (const hits of resultSets) {
    for (const hit of hits) {
      const existing = byId.get(hit.id)
      if (!existing || hit.score > existing.score) byId.set(hit.id, hit)
    }
  }
  return [...byId.values()]
}

function mergeFactsByBestScore(resultSets: UserFactHit[][]): UserFactHit[] {
  const byId = new Map<string, UserFactHit>()
  for (const hits of resultSets) {
    for (const hit of hits) {
      const existing = byId.get(hit.id)
      if (!existing || hit.score > existing.score) byId.set(hit.id, hit)
    }
  }
  return [...byId.values()]
}

export async function findForgetHits(input: {
  userId: string
  /** The forget capture's (secret-redacted) text. */
  request: string
  /** Only items stored strictly before this instant can be forgotten: a fact restated later stays. */
  createdBefore: Date
}): Promise<{ phrases: string[]; hits: ForgetHit[] }> {
  const phrases = (
    await deriveDeleteSearchQueries({ userId: input.userId, deleteRequest: input.request })
  ).map((phrase) => redactedText(phrase))
  const embeddings = await createThoughtEmbeddings(input.userId, phrases)

  const [evidence, factResults] = await Promise.all([
    Promise.all(
      phrases.map((phrase, i) =>
        retrieveAnswerEvidence({
          userId: input.userId,
          query: phrase,
          queryEmbedding: embeddings[i]!,
          topK: FORGET_TOP_K_PER_PHRASE,
          noteTopK: FORGET_TOP_K_PER_PHRASE,
          weights: CONTEXT_WEIGHTS.default,
        }),
      ),
    ),
    // only facts known before the forget capture: a fact restated later stays
    Promise.all(
      phrases.map((phrase, i) =>
        searchUserFacts(input.userId, {
          query: phrase,
          queryEmbedding: embeddings[i]!,
          topK: FORGET_TOP_K_PER_PHRASE,
          asOfBefore: input.createdBefore,
        }),
      ),
    ),
  ])

  const cutoff = input.createdBefore.getTime()
  const thoughts = mergeRetrievalResultsByBestScore(evidence.map((e) => e.retrieved)).filter(
    (hit) => hit.createdAt.getTime() < cutoff,
  )
  const notes = mergeNotesByBestScore(evidence.map((e) => e.noteHits)).filter(
    (hit) => new Date(hit.createdAt).getTime() < cutoff,
  )

  const facts = mergeFactsByBestScore(factResults)

  const hits: ForgetHit[] = [
    ...facts.map(
      (hit): ForgetHit => ({
        kind: 'fact',
        id: hit.id,
        text: statementForIndex(hit.statement),
        subject: hit.subjectKind === 'user' ? 'the user' : (hit.subjectLabel ?? 'a person'),
        factKind: hit.kind,
        inferred: hit.inferred,
        createdAt: hit.asOf,
        score: hit.score,
      }),
    ),
    ...thoughts.map(
      (hit): ForgetHit => ({
        kind: 'thought',
        id: hit.id,
        text: hit.normalizedText,
        category: hit.category,
        createdAt: hit.createdAt,
        score: hit.score,
      }),
    ),
    ...notes.map(
      (hit): ForgetHit => ({
        kind: 'note',
        id: hit.id,
        title: hit.title,
        text: hit.excerpt,
        matchedOrdinals: hit.matchedOrdinals,
        createdAt: new Date(hit.createdAt),
        score: hit.score,
      }),
    ),
  ].sort((a, b) => b.score - a.score)
  return { phrases, hits }
}
