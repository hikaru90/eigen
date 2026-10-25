import type { ChatMessage } from '$lib/server/llm/llm-client'
import { seededShuffle } from '../public-bench/seeded'
import { OPTION_LETTERS, type OptionLetter, type PreparedRow } from './types'

export type McqOptions = {
  options: Record<OptionLetter, string>
  correctLetter: OptionLetter
}

/** Seeded per (persona, query): identical letters in every process and every run. */
export function buildOptions(
  row: Pick<PreparedRow, 'personaId' | 'query' | 'correctAnswer' | 'incorrectAnswers'>,
): McqOptions {
  const shuffled = seededShuffle(
    [row.correctAnswer, ...row.incorrectAnswers],
    `${row.personaId}:${row.query}`,
  )
  const options = {} as Record<OptionLetter, string>
  let correctLetter: OptionLetter | null = null
  OPTION_LETTERS.forEach((letter, i) => {
    options[letter] = shuffled[i]!
    if (shuffled[i] === row.correctAnswer) correctLetter = letter
  })
  if (!correctLetter) throw new Error('[personamem] correct answer missing after shuffle')
  return { options, correctLetter }
}

const SYSTEM_PROMPT = [
  'You answer a multiple-choice question about how an AI assistant should reply to a user.',
  'The user wrote the message below. Pick the one reply that best fits what is known about this user:',
  'their stated preferences, circumstances and any later changes or requests to forget something.',
  'Use only the memories provided. If they do not settle the question, pick the most plausible reply.',
  'Respond with JSON only, exactly: {"letter":"A"|"B"|"C"|"D"}',
].join('\n')

export type ChooserMemory = { text: string; storedAt: Date }

/** Same day granularity as composeAnswer's `stored=YYYY-MM-DD`. */
function memoryLine(memory: ChooserMemory, index: number): string {
  return `[${index + 1}] (stored ${memory.storedAt.toISOString().slice(0, 10)}) ${memory.text}`
}

function memoryBlock(memories: readonly ChooserMemory[] | null): string {
  if (memories === null) return 'You have no stored memories about this user.'
  if (memories.length === 0) return 'The memory system retrieved no memories for this message.'
  return ['Memories retrieved about this user:', ...memories.map(memoryLine)].join('\n')
}

/** `memories: null` is the no-memory variant; an array is what Eigen retrieved (in returned order). */
export function buildChooserMessages(input: {
  query: string
  options: Record<OptionLetter, string>
  memories: readonly ChooserMemory[] | null
}): ChatMessage[] {
  const optionLines = OPTION_LETTERS.map((letter) => `${letter}. ${input.options[letter]}`)
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        memoryBlock(input.memories),
        '',
        'User message:',
        input.query,
        '',
        'Possible replies:',
        ...optionLines,
      ].join('\n'),
    },
  ]
}
