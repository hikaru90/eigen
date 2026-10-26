/**
 * Find what a forget request is about (docs/planning/personamem-score-plan.md, S2b): the same
 * retrieval Ask uses, run for every LLM-derived target phrase, over thoughts AND note passages,
 * restricted to items stored before the forget capture. Finding does not decide anything: every
 * hit goes to the per-hit judge with its full text.
 */

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

  const evidence = await Promise.all(
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
  )

  const cutoff = input.createdBefore.getTime()
  const thoughts = mergeRetrievalResultsByBestScore(evidence.map((e) => e.retrieved)).filter(
    (hit) => hit.createdAt.getTime() < cutoff,
  )
  const notes = mergeNotesByBestScore(evidence.map((e) => e.noteHits)).filter(
    (hit) => new Date(hit.createdAt).getTime() < cutoff,
  )

  const hits: ForgetHit[] = [
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
