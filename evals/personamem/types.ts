import { z } from 'zod'

export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const
export const optionLetterSchema = z.enum(OPTION_LETTERS)
export type OptionLetter = z.infer<typeof optionLetterSchema>

export const INGEST_MODES = ['ask', 'capture'] as const
export const ingestModeSchema = z.enum(INGEST_MODES)
export type IngestMode = z.infer<typeof ingestModeSchema>

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

export const retrievedItemSchema = z
  .object({
    id: z.string(),
    normalizedText: z.string(),
    score: z.number(),
    createdAt: z.iso.datetime(),
  })
  .strict()
export type RetrievedItem = z.infer<typeof retrievedItemSchema>

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
    usd: z.number().nonnegative(),
    ms: z.number().nonnegative(),
  })
  .strict()
export type AnswerRow = z.infer<typeof answerRowSchema>

const count = z.number().int().nonnegative()

/** One line of `ask-turns.jsonl`: what happened in one replayed user turn (`--ingest ask`). */
export const askTurnRecordSchema = z
  .object({
    personaId: z.number().int().nonnegative(),
    tenantUserId: nonEmpty,
    /** Zero-based index of the user turn in history order. */
    turn: count,
    /** The turn's eval clock (PERSONAMEM_EPOCH + turn days). */
    clock: z.iso.datetime(),
    /** Successful `capture_thought` calls Ask made. */
    captures: count,
    /** Successful `delete_thought` / `delete_thoughts_by_request` calls Ask made. */
    deletes: count,
    toolNames: z.array(nonEmpty),
    /** Thoughts that exist after the turn and did not before (captures, split/fan-out children). */
    thoughtsCreated: count,
    /** Created thoughts whose stored createdAt differs from the turn clock. */
    clockMismatches: count,
    askUsd: z.number().nonnegative(),
    enrichUsd: z.number().nonnegative(),
    usd: z.number().nonnegative(),
    ms: z.number().nonnegative(),
  })
  .strict()
export type AskTurnRecord = z.infer<typeof askTurnRecordSchema>
