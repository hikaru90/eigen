import { z } from 'zod'

export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const
export const optionLetterSchema = z.enum(OPTION_LETTERS)
export type OptionLetter = z.infer<typeof optionLetterSchema>

/** How a question reaches Eigen: through the real Ask agent, or composeAnswer on the bare query. */
export const ANSWER_MODES = ['ask', 'compose'] as const
export const answerModeSchema = z.enum(ANSWER_MODES)
export type AnswerMode = z.infer<typeof answerModeSchema>

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
    /** `--answer ask`: names of the tools Ask used to answer. */
    askTools: z.array(nonEmpty).optional(),
    /** `--answer ask`: Ask never called answer_question, so the chooser got no context. */
    askAnsweredWithoutMemory: z.boolean().optional(),
    usd: z.number().nonnegative(),
    ms: z.number().nonnegative(),
  })
  .strict()
export type AnswerRow = z.infer<typeof answerRowSchema>
