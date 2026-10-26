import { z } from 'zod'
import { appendJsonl, readJsonl } from '../public-bench/run-output'
import {
  belowFloorSchema,
  evidenceHitSchema,
  optionLetterSchema,
  retrievedItemSchema,
} from './types'

/**
 * `answer-stages.jsonl`: the durable, per-question record of an answer, written stage by stage.
 * The final `answers.jsonl` rows are derived from it only when all three stages exist, and a
 * stage that is stored is never recomputed (the Ask agent loop is the expensive one):
 *
 *   eigen             the Ask / compose answer with its tools, the full context the chooser sees,
 *                     the below-floor scores and the evidence hit
 *   choose-eigen      the chooser's letter given that context
 *   choose-no-memory  the chooser's letter with no memory
 *
 * `usd` / `ms` are what the stage cost. Never holds a vector.
 */

const nonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank')
const cost = { usd: z.number().nonnegative(), ms: z.number().nonnegative() }

export const eigenStageSchema = z
  .object({
    type: z.literal('eigen'),
    at: z.string(),
    questionId: nonBlank,
    answerText: z.string(),
    /** Everything Eigen gave its answer model (the chooser sees exactly these). */
    retrieved: z.array(retrievedItemSchema),
    citedIds: z.array(z.string()),
    belowFloor: belowFloorSchema,
    askTools: z.array(nonBlank).optional(),
    askAnsweredWithoutMemory: z.boolean().optional(),
    evidence: evidenceHitSchema.optional(),
    ...cost,
  })
  .strict()
export type EigenStage = z.infer<typeof eigenStageSchema>

const chooseSchema = <T extends 'choose-eigen' | 'choose-no-memory'>(type: T) =>
  z
    .object({
      type: z.literal(type),
      at: z.string(),
      questionId: nonBlank,
      letter: optionLetterSchema,
      ...cost,
    })
    .strict()
export const chooseEigenStageSchema = chooseSchema('choose-eigen')
export const chooseNoMemoryStageSchema = chooseSchema('choose-no-memory')
export type ChooseEigenStage = z.infer<typeof chooseEigenStageSchema>
export type ChooseNoMemoryStage = z.infer<typeof chooseNoMemoryStageSchema>

const stageRowSchema = z.discriminatedUnion('type', [
  eigenStageSchema,
  chooseEigenStageSchema,
  chooseNoMemoryStageSchema,
])

/** What `appendStage` takes: a stage without its timestamp. */
export type StageInput =
  Omit<EigenStage, 'at'> | Omit<ChooseEigenStage, 'at'> | Omit<ChooseNoMemoryStage, 'at'>

export type QuestionStages = {
  eigen?: EigenStage
  chooseEigen?: ChooseEigenStage
  chooseNoMemory?: ChooseNoMemoryStage
}

export type NextStage = 'eigen' | 'choose-eigen' | 'choose-no-memory' | 'complete'

export function appendStage(path: string, stage: StageInput): void {
  appendJsonl(path, stageRowSchema.parse({ ...stage, at: new Date().toISOString() }))
}

/** Where to continue a question: the first stage that is not stored yet. */
export function nextStage(stages: QuestionStages | undefined): NextStage {
  if (stages?.eigen === undefined) return 'eigen'
  if (stages.chooseEigen === undefined) return 'choose-eigen'
  if (stages.chooseNoMemory === undefined) return 'choose-no-memory'
  return 'complete'
}

/** The three stages once all exist; null while any is missing. */
export function completedStageRows(
  stages: QuestionStages | undefined,
): {
  eigen: EigenStage
  chooseEigen: ChooseEigenStage
  chooseNoMemory: ChooseNoMemoryStage
} | null {
  if (!stages?.eigen || !stages.chooseEigen || !stages.chooseNoMemory) return null
  return {
    eigen: stages.eigen,
    chooseEigen: stages.chooseEigen,
    chooseNoMemory: stages.chooseNoMemory,
  }
}

/** Every question's stored stages; a stage stored twice or out of order means the file is damaged. */
export function loadAnswerStages(path: string): Map<string, QuestionStages> {
  const byQuestion = new Map<string, QuestionStages>()
  const damaged = (line: number, why: string): never => {
    throw new Error(
      `[personamem] ${path} line ${line} is invalid (damaged answer-stages.jsonl): ${why}`,
    )
  }
  readJsonl(path).forEach((raw, i) => {
    const line = i + 1
    const parsed = stageRowSchema.safeParse(raw)
    if (!parsed.success) return damaged(line, parsed.error.message)
    const row = parsed.data
    const stages = byQuestion.get(row.questionId) ?? {}
    byQuestion.set(row.questionId, stages)
    if (row.type === 'eigen') {
      if (stages.eigen) damaged(line, `${row.questionId} has the eigen stage twice`)
      stages.eigen = row
    } else if (row.type === 'choose-eigen') {
      if (!stages.eigen) damaged(line, `${row.questionId} has choose-eigen without the eigen stage`)
      if (stages.chooseEigen) damaged(line, `${row.questionId} has choose-eigen twice`)
      stages.chooseEigen = row
    } else {
      if (!stages.chooseEigen)
        damaged(line, `${row.questionId} has choose-no-memory before choose-eigen`)
      if (stages.chooseNoMemory) damaged(line, `${row.questionId} has choose-no-memory twice`)
      stages.chooseNoMemory = row
    }
  })
  return byQuestion
}
