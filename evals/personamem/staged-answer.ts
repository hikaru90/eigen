import { appendJsonlRows, readJsonl, removeJsonlRows } from '../public-bench/run-output'
import {
  appendStage,
  nextStage,
  type ChooseEigenStage,
  type EigenStage,
  type QuestionStages,
} from './answer-stages'
import { answerRowSchema, type AnswerRow, type OptionLetter } from './types'

/** What the eigen stage stores: the Ask / compose answer and everything the chooser sees. */
export type EigenOutcome = Omit<EigenStage, 'type' | 'at' | 'questionId' | 'usd' | 'ms'>

export type StagedQuestion = {
  questionId: string
  personaId: number
  prefType: string
  updated: boolean
  who: string
  correctLetter: OptionLetter
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

/**
 * Answers one question stage by stage (eigen -> choose-eigen -> choose-no-memory), storing each
 * stage durably before the next starts, and writes the two final `answers.jsonl` rows (in one
 * write) only when all three stages exist. A stage that is already stored is not run again:
 * `stages` is what an earlier process left in answer-stages.jsonl. `spend` reads the tenant's
 * total spend so each stage records what it cost.
 */
export async function answerStaged(input: {
  question: StagedQuestion
  paths: { stages: string; answers: string }
  stages: QuestionStages | undefined
  runEigen: () => Promise<EigenOutcome>
  runChooseEigen: (eigen: EigenStage) => Promise<OptionLetter>
  runChooseNoMemory: () => Promise<OptionLetter>
  spend: () => Promise<number>
}): Promise<AnswerRow[]> {
  const { question, paths } = input
  const { questionId } = question
  if (readJsonl(paths.answers).some((row) => row.questionId === questionId)) {
    throw new Error(
      `[personamem] ${questionId} is already answered in ${paths.answers}; not answering it twice`,
    )
  }
  const stages: QuestionStages = { ...input.stages }

  const timed = async <T>(
    work: () => Promise<T>,
  ): Promise<{ value: T; usd: number; ms: number }> => {
    const before = await input.spend()
    const started = Date.now()
    const value = await work()
    const ms = Date.now() - started
    const delta = round6((await input.spend()) - before)
    if (delta < 0) {
      throw new Error(
        `[personamem] spend went down while answering ${questionId} (${before} -> ${before + delta})`,
      )
    }
    return { value, usd: delta, ms }
  }

  if (nextStage(stages) === 'eigen') {
    const { value, usd, ms } = await timed(input.runEigen)
    appendStage(paths.stages, { type: 'eigen', questionId, ...value, usd, ms })
    stages.eigen = { type: 'eigen', at: '', questionId, ...value, usd, ms }
  }
  if (nextStage(stages) === 'choose-eigen') {
    const { value, usd, ms } = await timed(() => input.runChooseEigen(stages.eigen!))
    appendStage(paths.stages, { type: 'choose-eigen', questionId, letter: value, usd, ms })
    stages.chooseEigen = { type: 'choose-eigen', at: '', questionId, letter: value, usd, ms }
  }
  if (nextStage(stages) === 'choose-no-memory') {
    const { value, usd, ms } = await timed(input.runChooseNoMemory)
    appendStage(paths.stages, { type: 'choose-no-memory', questionId, letter: value, usd, ms })
    stages.chooseNoMemory = { type: 'choose-no-memory', at: '', questionId, letter: value, usd, ms }
  }

  const rows = finalRows(question, stages.eigen!, stages.chooseEigen!, stages.chooseNoMemory!)
  appendJsonlRows(paths.answers, rows)
  return rows
}

function finalRows(
  question: StagedQuestion,
  eigen: EigenStage,
  chooseEigen: ChooseEigenStage,
  chooseNoMemory: { letter: OptionLetter; usd: number; ms: number },
): AnswerRow[] {
  const common = {
    questionId: question.questionId,
    personaId: question.personaId,
    prefType: question.prefType,
    updated: question.updated,
    who: question.who,
    correctLetter: question.correctLetter,
  }
  return [
    answerRowSchema.parse({
      ...common,
      variant: 'eigen',
      letter: chooseEigen.letter,
      correct: chooseEigen.letter === question.correctLetter,
      eigenAnswer: eigen.answerText,
      retrieved: eigen.retrieved,
      citedIds: eigen.citedIds,
      belowFloor: eigen.belowFloor,
      ...(eigen.evidence ? { evidence: eigen.evidence } : {}),
      ...(eigen.askTools ? { askTools: eigen.askTools } : {}),
      ...(eigen.askAnsweredWithoutMemory !== undefined
        ? { askAnsweredWithoutMemory: eigen.askAnsweredWithoutMemory }
        : {}),
      usd: round6(eigen.usd + chooseEigen.usd),
      ms: eigen.ms + chooseEigen.ms,
    }),
    answerRowSchema.parse({
      ...common,
      variant: 'no-memory',
      letter: chooseNoMemory.letter,
      correct: chooseNoMemory.letter === question.correctLetter,
      usd: chooseNoMemory.usd,
      ms: chooseNoMemory.ms,
    }),
  ]
}

/**
 * Both variants of a question are written in one append, so a lone variant can only be the
 * remains of a torn write. When the question's three stages are complete the final rows are
 * derived from them: the lone row is dropped here and rewritten by `answerStaged`. A lone
 * variant without complete stages behind it is unexplained damage and fails loud.
 */
export function healLoneVariants(
  answersPath: string,
  completeStageQuestionIds: ReadonlySet<string>,
): string[] {
  const variants = new Map<string, Set<string>>()
  for (const row of readJsonl(answersPath)) {
    const id = row.questionId as string
    const set = variants.get(id) ?? new Set()
    set.add(row.variant as string)
    variants.set(id, set)
  }
  const lone = [...variants].filter(([, set]) => set.size === 1)
  for (const [id, set] of lone) {
    if (!completeStageQuestionIds.has(id)) {
      throw new Error(
        `[personamem] answers.jsonl has only [${[...set]}] for ${id} and no complete answer stages behind it; run is damaged`,
      )
    }
  }
  const loneIds = new Set(lone.map(([id]) => id))
  if (loneIds.size > 0) removeJsonlRows(answersPath, (row) => loneIds.has(row.questionId as string))
  return [...loneIds]
}
