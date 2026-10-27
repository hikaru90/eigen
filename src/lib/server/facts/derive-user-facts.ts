/**
 * Derive the facts of one capture thought (docs/planning/user-facts-layer.md, F1): the single
 * entry point enrichment and the edit hook share.
 *
 *   release  what this thought derived before (a re-run or an edit starts clean; facts that other
 *            sources still carry stay)
 *   find     the stored facts about related subjects, by meaning
 *   extract  one json-mode LLM call: add | update | confirm | none per fact, subjects attributed,
 *            identifiers returned apart from the statement
 *   write    embeddings of the display statements, then one transaction
 *
 * Every step fails loud into the caller's retry ladder; nothing here falls back. Logs carry
 * counts and ids, never text. The capture text and the reference text reach exactly one place
 * that is not the database: the extraction prompt, redacted of credentials.
 */

import type { ParsedFactExtraction } from './parse-fact-extraction'
import { createThoughtEmbeddings } from '$lib/server/llm/embedding'
import { redactedText } from '$lib/server/security/detect-secrets'
import { getTextFile } from '$lib/server/text-files/service'
import {
  extractUserFacts,
  type ExtractUserFactsInput,
  type KnownPerson,
  type StoredFactForPrompt,
} from './extract-user-facts'
import { planFactWrites } from './plan-fact-writes'
import { releaseThoughtFacts } from './user-fact-lifecycle'
import {
  loadKnownPeople,
  loadStoredFactsForPrompt,
  persistFactWrites,
  type PersistedFactCounts,
  type PersistFactWritesInput,
} from './user-fact-store'

/** The extractor reads at most this much reference text; longer text is cut and the cut is logged. */
export const FACT_REFERENCE_MAX_CHARS = 24_000
/** How much of the reference text joins the query that finds related stored facts. */
const FACT_QUERY_REFERENCE_CHARS = 1_500

export type DeriveFactsDeps = {
  releaseThoughtFacts: (userId: string, thoughtId: string) => Promise<void>
  /** The note's body (null: the note is gone). The caller redacts it. */
  loadReferenceText: (userId: string, textFileId: string) => Promise<string | null>
  embed: (userId: string, texts: string[]) => Promise<number[][]>
  loadStoredFacts: (
    userId: string,
    input: { text: string; queryEmbedding: number[] },
  ) => Promise<StoredFactForPrompt[]>
  loadKnownPeople: (userId: string, thoughtId: string) => Promise<KnownPerson[]>
  extract: (input: ExtractUserFactsInput) => Promise<ParsedFactExtraction>
  persist: (userId: string, input: PersistFactWritesInput) => Promise<PersistedFactCounts>
}

// Every dependency is called through an arrow: nothing is read from an imported module at load.
export const defaultDeriveFactsDeps: DeriveFactsDeps = {
  releaseThoughtFacts: (userId, thoughtId) => releaseThoughtFacts(userId, thoughtId),
  loadReferenceText: async (userId, textFileId) =>
    (await getTextFile(userId, textFileId))?.body ?? null,
  embed: (userId, texts) => createThoughtEmbeddings(userId, texts),
  loadStoredFacts: (userId, input) => loadStoredFactsForPrompt(userId, input),
  loadKnownPeople: (userId, thoughtId) => loadKnownPeople(userId, thoughtId),
  extract: (input) => extractUserFacts(input),
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
  /** Embedding of `text` when enrichment already has it. */
  queryEmbedding?: number[]
}

export type DerivedFactCounts = PersistedFactCounts & { droppedLowConfidence: number }

const NO_FACTS: DerivedFactCounts = {
  added: 0,
  superseded: 0,
  confirmed: 0,
  droppedLowConfidence: 0,
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

  if (text === '' && referenceText === null) return NO_FACTS

  const queryText = referenceText
    ? `${text}\n${referenceText.slice(0, FACT_QUERY_REFERENCE_CHARS)}`.trim()
    : text
  const queryEmbedding =
    input.queryEmbedding && referenceText === null
      ? input.queryEmbedding
      : (await deps.embed(userId, [queryText]))[0]
  if (!queryEmbedding) {
    throw new Error('user facts: no embedding for the related-facts search')
  }

  const [storedFacts, people] = await Promise.all([
    deps.loadStoredFacts(userId, { text: queryText, queryEmbedding }),
    deps.loadKnownPeople(userId, thoughtId),
  ])

  const extraction = await deps.extract({
    userId,
    text,
    referenceText,
    capturedAt,
    storedFacts,
    people,
  })

  if (extraction.operations.length === 0) {
    console.info('[user-facts] derived', {
      userId: userId.slice(0, 8),
      thoughtId,
      added: 0,
      superseded: 0,
      confirmed: 0,
      droppedLowConfidence: extraction.droppedLowConfidence,
    })
    return { ...NO_FACTS, droppedLowConfidence: extraction.droppedLowConfidence }
  }

  const plan = planFactWrites(extraction.operations)
  // statements are embedded in display form: no reference id, never an identifier value
  const embeddings =
    plan.adds.length > 0
      ? await deps.embed(
          userId,
          plan.adds.map((add) => add.displayStatement),
        )
      : []
  const counts = await deps.persist(userId, {
    plan,
    embeddings,
    thoughtId,
    textFileId,
    capturedAt,
  })

  console.info('[user-facts] derived', {
    userId: userId.slice(0, 8),
    thoughtId,
    ...counts,
    droppedLowConfidence: extraction.droppedLowConfidence,
  })
  return { ...counts, droppedLowConfidence: extraction.droppedLowConfidence }
}
