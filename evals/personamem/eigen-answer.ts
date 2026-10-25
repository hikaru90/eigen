import type { OptionLetter, RetrievedItem } from './types'
import type { ComposedAnswer } from '$lib/server/qa/compose-answer'
import { chooseOption, type Complete } from './choose-option'
import { buildChooserMessages } from './mcq'

/**
 * The chooser sees `composed.context` (everything Eigen gave its answer model), not
 * `composed.retrieved` (only what the answer cited): an answer that says "not in memory" cites
 * nothing, and the memories it was shown are exactly what the benchmark measures.
 */
export async function chooseFromComposed(input: {
  composed: Pick<ComposedAnswer, 'context'>
  query: string
  options: Record<OptionLetter, string>
  complete: Complete
}): Promise<OptionLetter> {
  return chooseOption({
    messages: buildChooserMessages({
      query: input.query,
      options: input.options,
      memories: input.composed.context.map((item) => ({
        text: item.normalizedText,
        storedAt: item.createdAt,
      })),
    }),
    complete: input.complete,
  })
}

/** The context items as written to answers.jsonl: id, text, score, createdAt - never a vector. */
export function storedContextItems(composed: Pick<ComposedAnswer, 'context'>): RetrievedItem[] {
  return composed.context.map((item) => ({
    id: item.id,
    normalizedText: item.normalizedText,
    score: item.score,
    createdAt: item.createdAt.toISOString(),
  }))
}
