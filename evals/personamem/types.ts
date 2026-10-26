import { z } from 'zod'

export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const
export const optionLetterSchema = z.enum(OPTION_LETTERS)
export type OptionLetter = z.infer<typeof optionLetterSchema>

/** How a question reaches Eigen: through the real Ask agent, or composeAnswer on the bare query. */
export const ANSWER_MODES = ['ask', 'compose'] as const
export const answerModeSchema = z.enum(ANSWER_MODES)
export type AnswerMode = z.infer<typeof answerModeSchema>

/** PersonaMem-v2 ships two disjoint text splits: `benchmark` (reported numbers) and `val` (tuning). */
export const SPLITS = ['benchmark', 'val'] as const
export const splitSchema = z.enum(SPLITS)
export type Split = z.infer<typeof splitSchema>

/**
 * The Q&A relevance floor of a run: `product` (the constant real users get) or an eval-only
 * override in [0, 1] (`withEvalRelevanceFloor`). Part of the run identity.
 */
export const relevanceFloorSchema = z.union([z.literal('product'), z.number().min(0).max(1)])
export type RelevanceFloorSetting = z.infer<typeof relevanceFloorSchema>

export const VARIANTS = ['eigen', 'no-memory'] as const
export const variantSchema = z.enum(VARIANTS)
export type Variant = z.infer<typeof variantSchema>

const nonEmpty = z.string().refine((s) => s.trim().length > 0, 'must not be blank')

/** One row of `personamem.benchmark.jsonl`, as written by prepare.py. */
export const preparedRowSchema = z
  .object({
    personaId: z.number().int().nonnegative(),
    historyPath: nonEmpty,
    query: nonEmpty,
    correctAnswer: nonEmpty,
    incorrectAnswers: z.tuple([nonEmpty, nonEmpty, nonEmpty]),
    prefType: nonEmpty,
    who: nonEmpty,
    updated: z.boolean(),
    prevPref: z.string().nullable(),
    scenario: z.string(),
    topicQuery: z.string(),
    distance32k: z.number().int().nonnegative(),
    questionId: z.string().regex(/^p\d+-[0-9a-f]{12}$/),
    /** The target preference text. For the smoke report only; never shown to Eigen or the chooser. */
    preference: nonEmpty,
    /** The history turns where this row's preference was revealed (`related_conversation_snippet`). */
    evidenceTurns: z.array(z.object({ role: nonEmpty, content: z.string() }).strict()).min(1),
  })
  .strict()
  .refine((row) => new Set([row.correctAnswer, ...row.incorrectAnswers]).size === 4, {
    message: 'the four options must be distinct',
    path: ['incorrectAnswers'],
  })
export type PreparedRow = z.infer<typeof preparedRowSchema>

/** `chat_history_32k/*.json`: a system persona dump, then alternating user/assistant turns. */
export const historySchema = z.object({
  chat_history: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    }),
  ),
})
export type ChatHistory = z.infer<typeof historySchema>

/**
 * What a retrieved item is: a stored thought, a note's matched passages, or a fact derived from the
 * user's captures (`Fact about <subject>: <statement>`; an identifier fact holds only its
 * `[secure:<id>]` reference, never the value).
 */
export const RETRIEVED_ITEM_KINDS = ['thought', 'note', 'fact'] as const
export const retrievedItemKindSchema = z.enum(RETRIEVED_ITEM_KINDS)
export type RetrievedItemKind = z.infer<typeof retrievedItemKindSchema>

export const retrievedItemSchema = z
  .object({
    id: z.string(),
    /** Absent only in rows written before facts existed (those are thoughts or notes). */
    kind: retrievedItemKindSchema.optional(),
    normalizedText: z.string(),
    score: z.number(),
    createdAt: z.iso.datetime(),
  })
  .strict()
export type RetrievedItem = z.infer<typeof retrievedItemSchema>

/**
 * The best candidate scores (0..1) the Q&A relevance floor dropped while answering one question:
 * thoughts, and note passages. null = nothing was dropped on that side. Never shown to Eigen.
 */
export const belowFloorSchema = z
  .object({
    thoughts: z.number().min(0).max(1).nullable(),
    notePassages: z.number().min(0).max(1).nullable(),
  })
  .strict()
export type BelowFloor = z.infer<typeof belowFloorSchema>

/**
 * Full-history runs, eigen rows: whether the chooser context holds any item of the question's
 * evidence. `inHistory: false` = the dataset keeps this question's evidence out of the history,
 * so there is nothing to hit (accuracy is still scored). Evidence-only runs carry no such field.
 */
export const evidenceHitSchema = z.discriminatedUnion('inHistory', [
  z.object({ inHistory: z.literal(false) }).strict(),
  z
    .object({
      inHistory: z.literal(true),
      /** Stored items (thoughts, split children, linked notes) the evidence captures became. */
      items: z.number().int().nonnegative(),
      /** The chooser context holds at least one of them. */
      hit: z.boolean(),
    })
    .strict(),
])
export type EvidenceHit = z.infer<typeof evidenceHitSchema>

/** One line of `answers.jsonl`: one row per (question, variant). Never carries embeddings. */
export const answerRowSchema = z
  .object({
    questionId: nonEmpty,
    personaId: z.number().int().nonnegative(),
    variant: variantSchema,
    prefType: nonEmpty,
    updated: z.boolean(),
    who: nonEmpty,
    letter: optionLetterSchema,
    correctLetter: optionLetterSchema,
    correct: z.boolean(),
    eigenAnswer: z.string().optional(),
    /** Every item Eigen gave its answer model (the chooser saw exactly these), not only the cited ones. */
    retrieved: z.array(retrievedItemSchema).optional(),
    /** Ids of `retrieved` the answer actually cited. */
    citedIds: z.array(z.string()).optional(),
    /** `--answer ask`: names of the tools Ask used to answer. */
    askTools: z.array(nonEmpty).optional(),
    /** `--answer ask`: Ask never called answer_question, so the chooser got no context. */
    askAnsweredWithoutMemory: z.boolean().optional(),
    /** Eigen rows: what just missed the relevance floor, to tell "nothing retrieved" from "below floor". */
    belowFloor: belowFloorSchema.optional(),
    /** Eigen rows of full-history runs: did the chooser context hold any of the question's evidence. */
    evidence: evidenceHitSchema.optional(),
    usd: z.number().nonnegative(),
    ms: z.number().nonnegative(),
  })
  .strict()
export type AnswerRow = z.infer<typeof answerRowSchema>
