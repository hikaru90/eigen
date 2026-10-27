/**
 * Relevance of what an answer may see (docs/planning/jev-everywhere-rollout.md, J1): the decision
 * model (Jev) judges every candidate — thought, note passage or fact — against the user's
 * question, in ONE batched Decisions call per question: relevant · partly · not.
 *
 * It replaced the chat model's listwise rerank. Candidates judged `not` are dropped, the rest are
 * ordered by an expected-relevance score built from Jev's probabilities. There is no fallback: a
 * failed call, a missing answer or a malformed candidate list rejects the retrieval, and the
 * fusion order is never silently used instead.
 *
 * Closed set in, closed set out — this file reads no candidate text for meaning.
 */

import { runEnforcedPerItemDecisions } from '$lib/server/llm/decision-plane'

export type EvidenceRelevanceChoice = 'relevant' | 'partly' | 'not'

export const EVIDENCE_RELEVANCE_CRITERIA: Record<EvidenceRelevanceChoice, string> = {
  relevant:
    "The item directly helps answer the question: it states what is asked about, or something about the user that a good answer must take into account (a preference, a health condition, a habit, a constraint, a circumstance).",
  partly:
    'The item is related and could add useful context to the answer, but the answer does not depend on it.',
  not: 'The item does not help answer the question: it is about something else, or only shares a topic or a word with it.',
}

/** One candidate item is cut here so a long note excerpt cannot flood the batched call. */
export const EVIDENCE_ITEM_MAX_CHARS = 800

export type RelevanceCandidate = {
  /** Unique within the call (`t1`, `n2`, `f3`); stored as the row's subject ref, never text. */
  ref: string
  /** What the item is, for the judge: "Stored thought, 2026-05-01", "Known fact about Mia …". */
  label: string
  /** The item's text as the answer would see it (identifiers as the `[secure value]` placeholder). */
  text: string
}

export type EvidenceVerdict = {
  choice: EvidenceRelevanceChoice
  /** Jev's probability of the chosen answer. */
  probability: number
  /** Expected relevance, P(relevant) + ½·P(partly): what the ordering is built from. */
  score: number
}

function probabilityOf(
  answer: { choice: string; probability: number; alternatives: Record<string, number> },
  choice: EvidenceRelevanceChoice,
): number {
  return answer.choice === choice ? answer.probability : (answer.alternatives[choice] ?? 0)
}

export async function judgeEvidenceRelevance(input: {
  userId: string
  /** The question as the user asked it. */
  question: string
  candidates: RelevanceCandidate[]
}): Promise<Map<string, EvidenceVerdict>> {
  const question = input.question.trim()
  if (!question) throw new Error('judgeEvidenceRelevance: question must be non-empty')
  if (input.candidates.length === 0) return new Map()

  const seen = new Set<string>()
  for (const candidate of input.candidates) {
    if (seen.has(candidate.ref)) {
      throw new Error(`judgeEvidenceRelevance: duplicate candidate ref "${candidate.ref}"`)
    }
    seen.add(candidate.ref)
  }

  const answers = await runEnforcedPerItemDecisions({
    userId: input.userId,
    surface: 'evidence',
    kind: 'evidence_relevance',
    state: `Question: ${question}`,
    criteria: EVIDENCE_RELEVANCE_CRITERIA,
    items: input.candidates.map((candidate) => ({
      ref: candidate.ref,
      instructions: `Does this stored item help answer the question?\n${candidate.label}:\n<<<item\n${candidate.text.slice(0, EVIDENCE_ITEM_MAX_CHARS)}\nitem>>>`,
      llmChoice: null,
    })),
  })

  const verdicts = new Map<string, EvidenceVerdict>()
  for (const candidate of input.candidates) {
    const answer = answers.get(candidate.ref)
    if (!answer) {
      throw new Error(`judgeEvidenceRelevance: no relevance answer for "${candidate.ref}"`)
    }
    verdicts.set(candidate.ref, {
      choice: answer.choice as EvidenceRelevanceChoice,
      probability: answer.probability,
      score: probabilityOf(answer, 'relevant') + 0.5 * probabilityOf(answer, 'partly'),
    })
  }
  return verdicts
}

/**
 * Drops every candidate judged `not` and orders the rest by relevance, best first; candidates with
 * the same score keep their incoming order (the search's own ranking breaks ties).
 */
export function rankByRelevance<T>(
  items: T[],
  refOf: (item: T) => string,
  verdicts: ReadonlyMap<string, EvidenceVerdict>,
): T[] {
  const kept: Array<{ item: T; score: number; index: number }> = []
  items.forEach((item, index) => {
    const verdict = verdicts.get(refOf(item))
    if (!verdict) throw new Error(`rankByRelevance: no verdict for "${refOf(item)}"`)
    if (verdict.choice !== 'not') kept.push({ item, score: verdict.score, index })
  })
  return kept.sort((a, b) => b.score - a.score || a.index - b.index).map((k) => k.item)
}
