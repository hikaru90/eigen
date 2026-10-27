/**
 * Derive the facts of one capture thought (docs/planning/user-facts-layer.md, F1; decisions on the
 * decision model since docs/planning/jev-everywhere-rollout.md, J1): the single entry point
 * enrichment and the edit hook share.
 *
 *   release   what this thought derived before (a re-run or an edit starts clean; facts that other
 *             sources still carry stay)
 *   propose   one json-mode chat call: candidate statements, who they name, identifiers apart from
 *             the statement (extract-user-facts.ts) — the chat model decides nothing else
 *   embed     the candidates' display statements, once: they find the nearest stored facts now and
 *             become the embeddings of the facts that are written
 *   find      per candidate, the stored facts nearest to it, by meaning
 *   decide    one Decisions call (Jev): per candidate keep or drop, user or person, kind, and
 *             add / update / confirm / none against its nearest stored facts (decide-user-facts.ts)
 *   write     one transaction
 *
 * Every step fails loud into the caller's retry ladder; nothing here falls back. Logs carry
 * counts and ids, never text. The capture text and the reference text reach exactly two places that
 * are not the database: the candidate prompt and the Decisions state, redacted of credentials (the
 * Decisions state also of identifier values).
 */

import type { FactCandidate } from './parse-fact-extraction'
import { createThoughtEmbeddings } from '$lib/server/llm/embedding'
import { redactedText } from '$lib/server/security/detect-secrets'
import { getTextFile } from '$lib/server/text-files/service'
import {
  decideFactCandidates,
  type DecidedFacts,
  type NearestFact,
} from './decide-user-facts'
import {
  extractFactCandidates,
  type ExtractFactCandidatesInput,
  type KnownPerson,
} from './extract-user-facts'
import { NO_DERIVED_FACTS, type DerivedFactCounts } from './fact-operations'
import { planFactWrites } from './plan-fact-writes'
import { releaseThoughtFacts } from './user-fact-lifecycle'
import {
  loadKnownPeople,
  loadNearestFacts,
  persistFactWrites,
  type PersistedFactCounts,
  type PersistFactWritesInput,
} from './user-fact-store'

/** The proposer reads at most this much reference text; longer text is cut and the cut is logged. */
export const FACT_REFERENCE_MAX_CHARS = 24_000

export type DeriveFactsDeps = {
  releaseThoughtFacts: (userId: string, thoughtId: string) => Promise<void>
  /** The note's body (null: the note is gone). The caller redacts it. */
  loadReferenceText: (userId: string, textFileId: string) => Promise<string | null>
  embed: (userId: string, texts: string[]) => Promise<number[][]>
  loadKnownPeople: (userId: string, thoughtId: string) => Promise<KnownPerson[]>
  extractCandidates: (input: ExtractFactCandidatesInput) => Promise<FactCandidate[]>
  /** The active stored facts nearest to one candidate statement (found by its embedding). */
  loadNearestFacts: (
    userId: string,
    input: { text: string; queryEmbedding: number[] },
  ) => Promise<NearestFact[]>
  decide: (input: Parameters<typeof decideFactCandidates>[0]) => Promise<DecidedFacts>
  persist: (userId: string, input: PersistFactWritesInput) => Promise<PersistedFactCounts>
}

// Every dependency is called through an arrow: nothing is read from an imported module at load.
export const defaultDeriveFactsDeps: DeriveFactsDeps = {
  releaseThoughtFacts: (userId, thoughtId) => releaseThoughtFacts(userId, thoughtId),
  loadReferenceText: async (userId, textFileId) =>
    (await getTextFile(userId, textFileId))?.body ?? null,
  embed: (userId, texts) => createThoughtEmbeddings(userId, texts),
  loadKnownPeople: (userId, thoughtId) => loadKnownPeople(userId, thoughtId),
  extractCandidates: (input) => extractFactCandidates(input),
  loadNearestFacts: (userId, input) => loadNearestFacts(userId, input),
  decide: (input) => decideFactCandidates(input),
  persist: (userId, input) => persistFactWrites(userId, input),
}

export type DeriveUserFactsInput = {
  userId: string
  thoughtId: string
  /** The text this thought stands for (its span, the pointer or the whole capture). */
  text: string
  /** The reference note that came with the capture; its text is read for facts about people. */
  attachedFileId?: string | null
  /** The capture's time: a fact is "as of" it. */
  capturedAt: Date
}

export async function deriveUserFactsForThought(
  input: DeriveUserFactsInput,
  deps: DeriveFactsDeps = defaultDeriveFactsDeps,
): Promise<DerivedFactCounts> {
  const { userId, thoughtId, capturedAt } = input

  // A re-run (retry, edit) starts from what other sources still say.
  await deps.releaseThoughtFacts(userId, thoughtId)

  // Defence in depth: the caller hands over redacted text; nothing credential-shaped reaches the model.
  const text = redactedText(input.text).trim()

  let referenceText: string | null = null
  let textFileId: string | null = null
  if (input.attachedFileId) {
    const body = await deps.loadReferenceText(userId, input.attachedFileId)
    if (body !== null && body.trim() !== '') {
      const redacted = redactedText(body).trim()
      if (redacted.length > FACT_REFERENCE_MAX_CHARS) {
        console.warn('[user-facts] reference text truncated', {
          thoughtId,
          textFileId: input.attachedFileId,
          chars: redacted.length,
          kept: FACT_REFERENCE_MAX_CHARS,
        })
      }
      referenceText = redacted.slice(0, FACT_REFERENCE_MAX_CHARS)
      textFileId = input.attachedFileId
    }
  }

  if (text === '' && referenceText === null) return NO_DERIVED_FACTS

  const people = await deps.loadKnownPeople(userId, thoughtId)
  const candidates = await deps.extractCandidates({ userId, text, referenceText, capturedAt, people })

  if (candidates.length === 0) {
    console.info('[user-facts] derived', { userId: userId.slice(0, 8), thoughtId, candidates: 0 })
    return NO_DERIVED_FACTS
  }

  // statements are embedded in display form: no reference id, never an identifier value. One batch
  // finds the nearest stored facts now and becomes the embeddings of the facts that are written.
  const embeddings = await deps.embed(
    userId,
    candidates.map((candidate) => candidate.statement),
  )
  if (embeddings.length !== candidates.length) {
    throw new Error(
      `user facts: embedding count mismatch: expected ${candidates.length}, got ${embeddings.length}`,
    )
  }
  const nearest = await Promise.all(
    candidates.map((candidate, i) =>
      deps.loadNearestFacts(userId, { text: candidate.statement, queryEmbedding: embeddings[i]! }),
    ),
  )

  const decided = await deps.decide({
    userId,
    text,
    referenceText,
    capturedAt,
    candidates,
    nearest,
  })
  const dropped = {
    droppedByJudge: decided.droppedByJudge,
    droppedLowConfidence: decided.droppedLowConfidence,
  }

  if (decided.operations.length === 0) {
    console.info('[user-facts] derived', {
      userId: userId.slice(0, 8),
      thoughtId,
      candidates: candidates.length,
      added: 0,
      superseded: 0,
      confirmed: 0,
      ...dropped,
    })
    return { ...NO_DERIVED_FACTS, ...dropped }
  }

  const plan = planFactWrites(decided.operations)
  const counts = await deps.persist(userId, {
    plan,
    // one per planned add (adds and updates, in operation order): the candidate's own embedding
    embeddings: decided.candidateIndexes.map((index) => embeddings[index]!),
    thoughtId,
    textFileId,
    capturedAt,
  })

  console.info('[user-facts] derived', {
    userId: userId.slice(0, 8),
    thoughtId,
    candidates: candidates.length,
    ...counts,
    ...dropped,
  })
  return { ...counts, ...dropped }
}
